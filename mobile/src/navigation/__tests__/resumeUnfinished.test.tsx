/**
 * Picking a half-finished capture back up, at the step it actually stopped on (C13).
 *
 * A capture is six steps and four of them write to the server, so it can be abandoned in four
 * different places. The app used to admit to one — a straw verified today whose photo never
 * arrived — and every resume went to the camera regardless. For three of the four that is the
 * wrong screen: a Mait resumed at the camera for an event that already had its photo takes a
 * second one and still cannot close it, and the money steps were unreachable altogether.
 *
 * These tests drive the real navigator from Home into the Unfinished list and out the other
 * side, once per stopping point, because the failure this guards against is not in the mapping
 * — it is in the mapping and the list disagreeing about what a row means.
 */

import React from 'react';
import { BackHandler } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import RootNavigator from '../index';
import { clearQueue } from '@api/queue';
import { loggedIn } from '@/features/auth/authSlice';
import type { AuthUser } from '@/features/auth/authSlice';
import { jsonResponse, makeStore, renderWithStore } from '@/test-utils';

jest.mock('@/features/aiFlow/FlowCamera', () => {
  const Actual = jest.requireActual('react');
  const { Pressable, Text } = jest.requireActual('react-native');
  return {
    __esModule: true,
    default: ({ testIDPrefix }: { testIDPrefix: string }) =>
      Actual.createElement(
        Pressable,
        { testID: `${testIDPrefix}-stub` },
        Actual.createElement(Text, null, 'cam'),
      ),
  };
});

jest.mock('@/features/aiFlow/CapturePhotoScreen', () => {
  const Actual = jest.requireActual('react');
  const { Pressable, Text } = jest.requireActual('react-native');
  return {
    __esModule: true,
    default: () =>
      Actual.createElement(
        Pressable,
        { testID: 'stub-camera' },
        Actual.createElement(Text, null, 'shutter'),
      ),
  };
});

const USER: AuthUser = {
  id: 4,
  fullName: 'Rohit Kumar',
  role: 'mait',
  mobileNo: '5500000054',
  maitId: 1,
  sahayakVendorCode: '5500000054',
};

/** One abandoned capture, shaped the way the API sends it. */
function unfinished(over: Record<string, unknown> = {}) {
  return {
    id: 44,
    client_uuid: '11111111-1111-4111-8111-111111111111',
    status: 'straw_verified',
    status_display: 'Straw verified',
    mpp: 1,
    mpp_code: '001303',
    mpp_name: 'BAROLI',
    owner_type: 'non_member',
    member: null,
    member_code: '',
    non_member: 7,
    owner_name: 'Radha Singh',
    animal: 17,
    animal_type: 'BUFF',
    breed: 'MURRAH',
    ear_tag_no: null,
    semen_breed: 'MURRAH',
    amount_due: '300.00',
    straw_unique_no: 'MURRAH-0006',
    ai_photo_url: '',
    gps_lat: null,
    gps_lng: null,
    performed_at: null,
    completed_at: null,
    cancelled_reason: '',
    created_at: '2026-08-17T10:42:00+05:30',
    payment: null,
    ...over,
  };
}

let events: Record<string, unknown>[] = [];

function mockApi() {
  (global.fetch as jest.Mock) = jest.fn(async (input: string | Request) => {
    const url = typeof input === 'string' ? input : input.url;

    if (url.includes('/mait/inventory/')) {
      return jsonResponse({
        total_straws: 12,
        is_low_stock: false,
        by_breed: { MURRAH: 12 },
        consumables: [],
        assets: [],
      });
    }
    if (url.includes('/config/breeds/')) {
      return jsonResponse([
        { code: 'MURRAH', name: 'Murrah', name_hi: '', animal_type: 'BUFF', display_order: 1 },
      ]);
    }
    if (url.includes('/ai-events/')) {
      return jsonResponse({ count: events.length, next: null, previous: null, results: events });
    }
    if (url.includes('/members/') || url.includes('/non-members/')) {
      return jsonResponse({ id: 7, name: 'Radha Singh', animals: [] });
    }
    return jsonResponse({ count: 0, next: null, previous: null, results: [] });
  });
}

function renderApp() {
  const store = makeStore();
  store.dispatch(
    loggedIn({
      access: 'access-token',
      refresh: 'refresh-token',
      user: USER,
      assignedMppCodes: [],
    }),
  );
  return renderWithStore(<RootNavigator />, { store });
}

/** Home → the Unfinished list → the single row on it. */
async function openTheOnlyRow(id = 44) {
  renderApp();
  fireEvent.press(await screen.findByTestId('resume-unfinished'));
  fireEvent.press(await screen.findByTestId(`unfinished-${id}`));
}

describe('the unfinished list', () => {
  beforeEach(async () => {
    await clearQueue();
    events = [];
    mockApi();
    (NetInfo.addEventListener as jest.Mock).mockReturnValue(() => {});
    jest
      .spyOn(BackHandler, 'addEventListener')
      .mockImplementation(() => ({ remove: jest.fn() }) as never);
  });

  afterEach(() => jest.restoreAllMocks());

  it('says what each capture is actually waiting for', async () => {
    events = [
      unfinished({ id: 44, status: 'straw_verified' }),
      unfinished({ id: 45, status: 'photo_captured' }),
      unfinished({ id: 46, status: 'payment_pending' }),
    ];

    renderApp();
    fireEvent.press(await screen.findByTestId('resume-unfinished'));

    // Three different reasons, from one mapping — the same one the resume routes on.
    await screen.findByText('Photo not taken');
    expect(screen.getByText('Payment not taken')).toBeTruthy();
    expect(screen.getByText('Code not confirmed')).toBeTruthy();
  });

  it('resumes a missing photo at the camera', async () => {
    events = [unfinished({ status: 'straw_verified' })];
    await openTheOnlyRow();

    await waitFor(() => expect(screen.getByTestId('stub-camera')).toBeTruthy());
  });

  it('resumes a non-member with no payment at "How is she paying?"', async () => {
    // The step that was unreachable before: the animal is served, the photo is up, and
    // nothing has been recorded about the cash.
    events = [unfinished({ status: 'photo_captured', owner_type: 'non_member' })];
    await openTheOnlyRow();

    await waitFor(() => expect(screen.getByText('How is she paying?')).toBeTruthy());
  });

  it('resumes a member with no payment at her statement, not at a payment screen', async () => {
    // Same status, different farmer, different screen. A member owes nothing in the yard, and
    // being asked for money by an app is how she ends up paying for something twice.
    events = [
      unfinished({
        status: 'photo_captured',
        owner_type: 'member',
        member: 3,
        member_code: 'MEM00000412',
        non_member: null,
        owner_name: 'Kavita Devi',
      }),
    ];
    await openTheOnlyRow();

    // Her own screen: the one whose only action closes the capture, with no way to take
    // money on it at all.
    await waitFor(() => expect(screen.getByTestId('payment-finish')).toBeTruthy());
    expect(screen.queryByText('How is she paying?')).toBeNull();
    expect(screen.queryByTestId('payment-mode-COD')).toBeNull();
  });

  it('resumes a started payment at the code, and asks for one', async () => {
    events = [unfinished({ status: 'payment_pending' })];
    await openTheOnlyRow();

    await waitFor(() => expect(screen.getByTestId('payment-save')).toBeTruthy());

    // The box has to be there. It used to be hidden — the resume cleared the state that means
    // "a code went out", so the screen offered to save without one, the completion behind it
    // was refused because the payment is not verified, and the capture stayed exactly where it
    // was however many times a Mait tapped.
    expect(screen.getByTestId('payment-code-input')).toBeTruthy();
    expect(screen.getByTestId('payment-resend')).toBeTruthy();
  });

  it('resumes a UPI payment as UPI, not as cash', async () => {
    // A farmer who paid online must not be picked back up into a cash record.
    events = [
      unfinished({
        status: 'payment_pending',
        payment: {
          amount: '300.00',
          mode: 'ONLINE',
          mode_display: 'Online',
          status: 'pending',
          is_verified: false,
        },
      }),
    ];
    await openTheOnlyRow();

    await waitFor(() => expect(screen.getByTestId('payment-save')).toBeTruthy());
    expect(screen.getByText(/paid online/i)).toBeTruthy();
  });

  it('says so plainly when nothing is outstanding', async () => {
    events = [unfinished({ status: 'completed' })];
    renderApp();

    // Home does not offer the list at all when there is nothing in it.
    await screen.findByTestId('home-start-ai');
    expect(screen.queryByTestId('resume-unfinished')).toBeNull();
  });
});
