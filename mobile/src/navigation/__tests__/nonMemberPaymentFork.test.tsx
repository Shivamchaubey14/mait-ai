/**
 * Where a capture goes once the proof photo is taken (SRS §6.5, C10a/C10b).
 *
 * Two farmers, two endings, and the app decides between them with no help from the Mait. A
 * member owes nothing in the yard — the dairy deducts the charge from her milk payment — so
 * she gets a statement and the capture closes. A non-member has no payout to settle against,
 * so she pays on the spot, and the flow forks into *How is she paying?* and the authorisation
 * code behind it.
 *
 * The individual screens are covered in `aiFlow/__tests__/PaymentScreens.test.tsx`. What is
 * tested here is the choice between them, driven through the real navigator from Home — the
 * screens can be perfect and still never appear, and that is the failure a Mait actually meets.
 *
 * The camera is stubbed. The fork hangs off the photo step's completion, not off the shutter,
 * and a real `expo-camera` in the way would be testing the lens rather than the routing.
 */

import React from 'react';
import { BackHandler } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import RootNavigator from '../index';
import { clearQueue } from '@api/queue';
import { loggedIn } from '@/features/auth/authSlice';
import type { AuthUser } from '@/features/auth/authSlice';
import { jsonResponse, makeStore, problemResponse, renderWithStore } from '@/test-utils';

/** Both cameras in the flow, reduced to "a photo came back". */
jest.mock('@/features/aiFlow/FlowCamera', () => {
  const Actual = jest.requireActual('react');
  const { Pressable: P, Text: T } = jest.requireActual('react-native');
  return {
    __esModule: true,
    default: ({
      testIDPrefix,
      onCaptured,
    }: {
      testIDPrefix: string;
      onCaptured: (uri: string) => void;
    }) =>
      Actual.createElement(
        P,
        {
          testID: `${testIDPrefix}-stub`,
          onPress: () => onCaptured(`file:///${testIDPrefix}.jpg`),
        },
        Actual.createElement(T, null, 'capture'),
      ),
  };
});

jest.mock('@/features/aiFlow/CapturePhotoScreen', () => {
  const { Pressable: P, Text: T } = jest.requireActual('react-native');
  const Actual = jest.requireActual('react');
  return {
    __esModule: true,
    default: ({ onCaptured }: { onCaptured: (photo: unknown) => void }) =>
      Actual.createElement(
        P,
        {
          testID: 'stub-shutter',
          onPress: () => onCaptured({ uri: 'file:///proof.jpg', lat: 26.85, lng: 80.94 }),
        },
        Actual.createElement(T, null, 'shutter'),
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

const MPP = {
  id: 1,
  mpp_code: '001303',
  mpp_name: 'BAROLI',
  district_code: '048',
  tehsil_code: '04803',
  village_code: '06081400',
  mobile_no: '9795402473',
  is_active: true,
  mait: 1,
  mait_name: 'Rohit Kumar',
  member_count: 12,
};

const ANIMAL = {
  id: 17,
  animal_type: 'BUFF',
  breed: 'MURRAH',
  ear_tag_no: null,
  owner_type: 'non_member',
  last_ai_date: null,
  last_ai_breed: null,
};

/** Every call the payment endpoints saw, so a test can read what was actually sent. */
let paymentCalls: { url: string; body: string }[] = [];

/** What the non-member picker lists. Set per test; empty means "register a new one". */
let nonMemberRoster: Record<string, unknown>[] = [];

/** ₹300 — a non-member's own rate, which is not the member one. */
const EVENT = {
  id: 20,
  client_uuid: '11111111-1111-4111-8111-111111111111',
  status: 'straw_verified',
  owner_type: 'non_member',
  owner_name: 'Radha Singh',
  semen_breed: 'MURRAH',
  amount_due: '300.00',
};

/**
 * Every call the walk makes, answered as the server answers it.
 *
 * Routed on the URL rather than on call order: the navigator refetches inventory and the
 * farmer's record at moments that are none of this test's business, and an ordered queue of
 * responses would make an extra refetch look like a routing bug.
 */
function mockApi() {
  (global.fetch as jest.Mock) = jest.fn(async (input: string | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.url;
    const method = (init?.method ?? (typeof input === 'string' ? 'GET' : input.method)) || 'GET';

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
    if (url.includes('/mpp/')) {
      return jsonResponse({ count: 1, next: null, previous: null, results: [MPP] });
    }
    if (url.includes('/non-members/') && method === 'POST') {
      return jsonResponse({ id: 7, name: 'Radha Singh', mobile_no: '9876543210' }, 201);
    }
    if (url.includes('/aadhaar/')) {
      return jsonResponse({ id: 7, aadhar_front_captured: true, aadhar_back_captured: true });
    }
    // The picker's roster. Empty by default, so the walk goes on to register somebody — the
    // path this test has always taken.
    if (url.includes('/non-members/?') || url.endsWith('/non-members/')) {
      return jsonResponse({ count: 0, next: null, previous: null, results: nonMemberRoster });
    }
    if (url.includes('/non-members/')) {
      return jsonResponse({
        id: 7,
        name: 'Radha Singh',
        father_husband_name: 'Ram Singh',
        mobile_no: '9876543210',
        address: 'Baroli',
        masked_aadhar: 'XXXXXXXX9012',
        mpp: 1,
        animals: [ANIMAL],
      });
    }
    if (url.includes('/farmers/otp/send/')) {
      // Masked, and named `mobile_no` — enough to read out to her, not enough to copy off a
      // screen being passed around a yard.
      return jsonResponse({ detail: 'sent', mobile_no: '••••• 43210', expires_in_seconds: 300 });
    }
    if (url.includes('/farmers/otp/verify/')) {
      return jsonResponse({ detail: 'verified' });
    }
    if (url.includes('/ai-events/') && url.includes('/photo/')) {
      return jsonResponse({ ...EVENT, status: 'photo_captured' });
    }
    if (url.includes('/ai-events/')) {
      return jsonResponse(EVENT, 201);
    }
    if (url.includes('/payments/')) {
      // RTK Query calls fetch with a Request, so the body is on the request rather than on
      // `init` — read from whichever carries it, or the test sees every call as empty.
      const body =
        init?.body !== undefined && init?.body !== null
          ? String(init.body)
          : typeof input === 'string'
            ? ''
            : await input.clone().text();
      paymentCalls.push({ url, body });

      // The server refuses a non-member payment with no mode — "Say how she is paying" —
      // which is exactly the refusal the completion used to walk into.
      if (url.includes('/initiate/') && !body.includes('mode')) {
        return problemResponse(400, 'validation-error', 'Say how she is paying: COD or ONLINE.');
      }
      return jsonResponse({ id: 12, ai_event: 20, mode: 'COD', status: 'pending' });
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

/** Home to the proof photo, as a non-member. Every answer the six steps ask for. */
async function walkToThePhoto() {
  renderApp();

  fireEvent.press(await screen.findByTestId('home-start-ai'));
  await screen.findByText('Is she a member?');

  // The fork that decides the whole ending, answered at step 1.
  fireEvent.press(screen.getByTestId('owner-non-member'));
  fireEvent.press(screen.getByTestId('owner-type-continue'));

  // No MPP to pick between — this Mait covers one, and the picker skips itself rather than
  // asking a question with a single answer.

  // Step 3 opens on who is already registered here. Nobody is, so the way on is the dashed
  // card at the end of the list.
  fireEvent.press(await screen.findByTestId('non-member-add-card'));

  // Step 3, the form — the screen where Save & continue used to do nothing at all.
  fireEvent.changeText(await screen.findByTestId('non-member-name'), 'Radha Singh');
  fireEvent.changeText(screen.getByTestId('non-member-mobile'), '9876543210');
  fireEvent.changeText(screen.getByTestId('non-member-aadhaar'), '123456789012');
  fireEvent.press(screen.getByTestId('non-member-relation-husband'));
  for (const face of ['front', 'back'] as const) {
    fireEvent.press(screen.getByTestId(`non-member-aadhaar-${face}`));
    fireEvent.press(screen.getByTestId(`aadhaar-camera-${face}-stub`));
  }
  fireEvent.press(screen.getByTestId('non-member-consent'));
  fireEvent.press(screen.getByTestId('non-member-save'));

  // Her number is proved before the flow acts on it — a Mait typed it a moment ago.
  fireEvent.press(await screen.findByTestId('farmer-verify'));
  fireEvent.changeText(await screen.findByTestId('farmer-otp-input'), '123456');
  fireEvent.press(screen.getByTestId('farmer-check-code'));
  fireEvent.press(await screen.findByTestId('farmer-confirm'));

  fireEvent.press(await screen.findByTestId('animal-17'));
  fireEvent.press(screen.getByTestId('animal-continue'));

  fireEvent.press(await screen.findByTestId('breed-MURRAH'));
  fireEvent.press(screen.getByTestId('breed-continue'));

  return screen.findByTestId('stub-shutter');
}

describe('a non-member reaches the payment screens', () => {
  beforeEach(async () => {
    await clearQueue();
    nonMemberRoster = [];
    paymentCalls = [];
    mockApi();
    (NetInfo.addEventListener as jest.Mock).mockReturnValue(() => {});
    jest
      .spyOn(BackHandler, 'addEventListener')
      .mockImplementation(() => ({ remove: jest.fn() }) as never);
  });

  afterEach(() => jest.restoreAllMocks());

  it('offers the farmers already registered here, before offering a form', async () => {
    // The gap this screen closes. A farmer without membership is served again next season,
    // and until now the second visit had no way to reach the record from the first — it went
    // straight into the registration form, which now refuses her Aadhaar as a duplicate and
    // leaves the Mait unable to serve the woman in front of them.
    nonMemberRoster = [
      {
        id: 7,
        name: 'Radha Singh',
        father_husband_name: 'Ram Singh',
        relation: 'husband',
        relation_display: 'Husband',
        mobile_no: '9876543210',
        animal_count: 1,
        ai_event_count: 0,
        last_ai_at: null,
        created_at: '2026-03-14T10:00:00+05:30',
      },
    ];

    renderApp();
    fireEvent.press(await screen.findByTestId('home-start-ai'));
    await screen.findByText('Is she a member?');
    fireEvent.press(screen.getByTestId('owner-non-member'));
    fireEvent.press(screen.getByTestId('owner-type-continue'));

    // Her row, told apart from every other Radha Singh by whose household she is from.
    await screen.findByText('Which farmer?');
    expect(screen.getByText('Husband: Ram Singh · 98765 43210')).toBeTruthy();
    // Nobody has inseminated her yet, which is the state a Mait is usually looking for.
    expect(screen.getByText('Never served')).toBeTruthy();

    fireEvent.press(screen.getByTestId('non-member-7'));
    fireEvent.press(screen.getByTestId('non-member-continue'));

    // Straight to the confirmation, with no registration form in between.
    await screen.findByText('Is this her?');
    expect(screen.queryByTestId('non-member-name')).toBeNull();
  });

  it('asks how she is paying once the photo is taken', async () => {
    fireEvent.press(await walkToThePhoto());

    // C10b. The member ending must not appear here — she has no milk payout to deduct from,
    // and a non-member told there is nothing to collect is a service given away.
    await waitFor(() => expect(screen.getByText('How is she paying?')).toBeTruthy());
    expect(screen.queryByTestId('member-nothing-to-collect')).toBeNull();
  });

  it('shows what to collect, at her own rate', async () => {
    fireEvent.press(await walkToThePhoto());

    await screen.findByText('How is she paying?');
    expect(screen.getByText('₹ 300')).toBeTruthy();
    expect(screen.getByText('To collect from Radha Singh')).toBeTruthy();
  });

  it('keeps the tab bar on the money steps, so a Mait is not trapped there', async () => {
    // The bar used to disappear from the straw scan onward, on the reasoning that one under a
    // half-captured insemination invites a Mait to strand it. That depended on a stranded
    // capture being unrecoverable, which it no longer is — anything half-done shows up in
    // Unfinished and resumes where it stopped. These are the screens a Mait lingers on.
    fireEvent.press(await walkToThePhoto());

    await screen.findByText('How is she paying?');
    expect(screen.getByTestId('tab-stock')).toBeTruthy();

    fireEvent.press(screen.getByTestId('payment-continue'));
    await screen.findByTestId('payment-save');
    expect(screen.getByTestId('tab-stock')).toBeTruthy();
  });

  it('closes the capture with the mode it collected, not with nothing', async () => {
    // The bug behind "That code is not right". After the code verified, the completion
    // re-opened the payment with no mode at all, which the server refuses for a non-member —
    // so a correct code was followed by a capture that would not close, and the Mait's next
    // tap reported the already-spent code as wrong.
    fireEvent.press(await walkToThePhoto());

    await screen.findByText('How is she paying?');
    fireEvent.press(screen.getByTestId('payment-continue'));

    const code = await screen.findByTestId('payment-code-input');
    fireEvent.changeText(code, '123456');
    fireEvent.press(screen.getByTestId('payment-save'));

    await waitFor(() => expect(screen.getByTestId('done-start-another')).toBeTruthy());

    // Every initiate names the mode. One without it is the refusal this test exists for.
    const initiates = paymentCalls.filter(call => call.url.includes('/initiate/'));
    expect(initiates.length).toBeGreaterThan(0);
    initiates.forEach(call => expect(call.body).toContain('COD'));
  });

  it('goes on to the authorisation code for the cash that was taken', async () => {
    fireEvent.press(await walkToThePhoto());

    await screen.findByText('How is she paying?');
    // Cash leads and is already chosen, because that is what happens in a yard.
    fireEvent.press(screen.getByTestId('payment-continue'));

    // C11 — the only thing that turns cash in a pocket into a record anyone can stand behind.
    await waitFor(() => expect(screen.getByTestId('payment-save')).toBeTruthy());
  });
});
