/**
 * Home tests (M0).
 *
 * This screen is read at the start of a round and trusted for the rest of it. The cases that
 * matter are the ones where a wrong reading costs a Mait the morning: setting out believing
 * they hold straws they do not, or leaving an insemination half recorded because nothing on
 * the screen said so.
 */

import React from 'react';
import { ScrollView } from 'react-native';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import HomeScreen from '../HomeScreen';
import type { AIEvent, InventorySummary } from '@api/types';
import { loggedIn } from '@/features/auth/authSlice';
import type { AuthUser } from '@/features/auth/authSlice';
import { jsonResponse, makeStore, renderWithStore } from '@/test-utils';

const SUMMARY: InventorySummary = {
  total_straws: 32,
  is_low_stock: false,
  by_breed: { 'HF Cross': 18, Sahiwal: 12, Murrah: 2 },
  straws: [],
  consumables: [],
  assets: [],
};

function event(overrides: Partial<AIEvent> = {}): AIEvent {
  return {
    id: 1,
    client_uuid: 'uuid-1',
    status: 'completed',
    status_display: 'Completed',
    mpp: 1,
    mpp_code: '001303',
    mpp_name: 'Barsana',
    owner_name: 'Kavita Devi',
    animal: 5,
    animal_type: 'BUFF',
    breed: 'Murrah',
    ear_tag_no: null,
    straw_unique_no: 'STRAW-1',
    ai_photo_url: '',
    created_at: new Date().toISOString(),
    ...overrides,
  } as AIEvent;
}

function mockApi(summary: InventorySummary, events: AIEvent[]) {
  (global.fetch as jest.Mock).mockImplementation((input: string | Request) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.includes('/mait/inventory/')) {
      return Promise.resolve(jsonResponse(summary));
    }
    if (url.includes('/ai-events/')) {
      return Promise.resolve(
        jsonResponse({ count: events.length, next: null, previous: null, results: events }),
      );
    }
    return Promise.resolve(jsonResponse({ count: 0, next: null, previous: null, results: [] }));
  });
}

const props = {
  onOpenStock: jest.fn(),
  onStartCapture: jest.fn(),
  onOpenUnfinished: jest.fn(),
  online: true,
  pending: 0,
  onSync: jest.fn(),
  onOpenQueue: jest.fn(),
  lastSyncAt: null,
};

/** Signed in, because the hero reads its name and MPP count off the session. */
function signedInStore(user: Partial<AuthUser> = {}) {
  const store = makeStore();
  store.dispatch(
    loggedIn({
      access: 'a',
      refresh: 'r',
      user: {
        id: 1,
        fullName: 'Sunil Kumar',
        role: 'mait',
        mobileNo: '9876543210',
        maitId: 341,
        sahayakVendorCode: '5500000054',
        ...user,
      },
      assignedMppCodes: ['001303', '001305', '001307'],
    }),
  );
  return store;
}

function render(
  overrides: Partial<React.ComponentProps<typeof HomeScreen>> = {},
  user: Partial<AuthUser> = {},
) {
  return renderWithStore(<HomeScreen {...props} {...overrides} />, {
    store: signedInStore(user),
  });
}

describe('HomeScreen', () => {
  beforeEach(() => {
    global.fetch = jest.fn() as jest.Mock;
  });

  afterEach(() => jest.resetAllMocks());

  it('names the Mait and the scope they work in', () => {
    mockApi(SUMMARY, []);
    render();

    expect(screen.getByText('Sunil Kumar')).toBeTruthy();
    // The identity and the scope, not a greeting — this line is what a Mait checks when
    // handed a phone that may not be theirs.
    //
    // The Sahayak vendor code, which is what they are known by on their paperwork, in the
    // portal and in SAP. It used to print `maitId` — a row id meaning nothing outside this
    // database — under the same "MAIT" label, so a Mait reading it out to the office would
    // be read back a blank look.
    expect(screen.getByText(/MAIT 5500000054/)).toBeTruthy();
    expect(screen.queryByText(/MAIT 341/)).toBeNull();
    expect(screen.getByText(/3 MPPs/)).toBeTruthy();
  });

  it('says nothing rather than a row id when the code is missing', () => {
    // An account with no Sahayak code behind it. Showing the row id as a fallback would be
    // worse than showing nothing — it looks like an answer.
    mockApi(SUMMARY, []);
    render({}, { sahayakVendorCode: null });

    // `MAIT` followed by digits is a code; the bare word is the brand mark in the hero.
    expect(screen.queryByText(/MAIT \d/)).toBeNull();
    expect(screen.getByText(/3 MPPs/)).toBeTruthy();
  });

  it('carries the brand mark, the same one the portal pins to its sidebar', () => {
    // A Mait hands this phone to a farmer to read a code off it, so the app has to say whose
    // app it is. It was a bare wordmark that read as a heading rather than a mark.
    mockApi(SUMMARY, []);
    render();

    expect(screen.getByText('MAIT AI')).toBeTruthy();
    expect(screen.getByText('FIELD CAPTURE')).toBeTruthy();
  });

  it('flags the breeds that are nearly out, not just the flask total', async () => {
    // 32 straws is a comfortable day unless the two Murrah left are the ones the next
    // buffalo-keeping farmers need.
    mockApi(SUMMARY, []);
    render();

    await waitFor(() => expect(screen.getByTestId('breed-Murrah')).toBeTruthy());
    expect(screen.getByText('Low')).toBeTruthy();
    expect(screen.getByText('32 total')).toBeTruthy();
  });

  it('names the one unfinished capture, and opens the list', async () => {
    const unfinished = event({ id: 9, status: 'straw_verified', client_uuid: 'uuid-9' });
    const onOpenUnfinished = jest.fn();
    mockApi(SUMMARY, [unfinished]);
    render({ onOpenUnfinished });

    await waitFor(() => expect(screen.getByTestId('resume-unfinished')).toBeTruthy());
    // One is named. A Mait with a single thing outstanding should not have to open a list to
    // find out whose it is.
    expect(screen.getByText(/Kavita Devi/)).toBeTruthy();

    fireEvent.press(screen.getByTestId('resume-unfinished'));
    expect(onOpenUnfinished).toHaveBeenCalled();
  });

  it('counts them once there is more than one', async () => {
    // Home used to surface exactly one — a straw verified today whose photo never arrived —
    // and every other abandoned capture was invisible. For work already done, that is the
    // worst kind of missing record.
    mockApi(SUMMARY, [
      event({ id: 9, status: 'straw_verified', client_uuid: 'uuid-9' }),
      event({ id: 10, status: 'photo_captured', client_uuid: 'uuid-10' }),
      event({ id: 11, status: 'payment_pending', client_uuid: 'uuid-11' }),
    ]);
    render();

    await waitFor(() => expect(screen.getByTestId('resume-unfinished')).toBeTruthy());
    expect(screen.getByText('3 unfinished captures')).toBeTruthy();
  });

  it('says nothing about resuming when today is finished work', async () => {
    mockApi(SUMMARY, [event({ status: 'completed' })]);
    render();

    await waitFor(() => expect(screen.getByTestId('breed-Murrah')).toBeTruthy());
    expect(screen.queryByTestId('resume-unfinished')).toBeNull();
  });

  it('sends a Mait with no straws to stock rather than into a capture', async () => {
    // The flow would stop dead at the scan step, with an animal already served.
    const onStartCapture = jest.fn();
    const onOpenStock = jest.fn();
    mockApi({ ...SUMMARY, total_straws: 0, by_breed: {} }, []);
    render({ onStartCapture, onOpenStock });

    await waitFor(() => expect(screen.getByText('See stock')).toBeTruthy());
    fireEvent.press(screen.getByTestId('home-start-ai'));

    expect(onOpenStock).toHaveBeenCalled();
    expect(onStartCapture).not.toHaveBeenCalled();
  });

  it('says the work is held on this phone while offline', () => {
    mockApi(SUMMARY, []);
    render({ online: false });
    expect(screen.getByTestId('sync-offline')).toBeTruthy();
  });

  it('opens the waiting list from the tile, and only from the tile', async () => {
    const onOpenQueue = jest.fn();
    const onSync = jest.fn();
    mockApi(SUMMARY, []);
    render({ pending: 3, onOpenQueue, onSync });

    fireEvent.press(screen.getByTestId('tile-waiting'));

    expect(onOpenQueue).toHaveBeenCalled();
  });

  it('stays on Home when the page is pulled down to refresh', async () => {
    // The two shared a prop, so the gesture that everywhere else means "show me this screen
    // again" was the one way to leave it.
    const onOpenQueue = jest.fn();
    const onSync = jest.fn();
    mockApi(SUMMARY, []);
    render({ pending: 3, onOpenQueue, onSync });

    const scroll = screen.UNSAFE_getByType(ScrollView);
    await act(async () => {
      scroll.props.refreshControl.props.onRefresh();
    });

    expect(onSync).toHaveBeenCalled();
    expect(onOpenQueue).not.toHaveBeenCalled();
  });
});
