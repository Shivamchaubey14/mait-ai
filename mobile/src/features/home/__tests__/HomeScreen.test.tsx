/**
 * Home tests (M0).
 *
 * This screen is read at the start of a round and trusted for the rest of it. The cases that
 * matter are the ones where a wrong reading costs a Mait the morning: setting out believing
 * they hold straws they do not, or leaving an insemination half recorded because nothing on
 * the screen said so.
 */

import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import HomeScreen from '../HomeScreen';
import type { AIEvent, InventorySummary } from '@api/types';
import { loggedIn } from '@/features/auth/authSlice';
import { jsonResponse, makeStore, renderWithStore } from '@/test-utils';

const SUMMARY: InventorySummary = {
  total_straws: 32,
  is_low_stock: false,
  by_breed: { 'HF Cross': 18, Sahiwal: 12, Murrah: 2 },
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
  onResume: jest.fn(),
  online: true,
  pending: 0,
  onSync: jest.fn(),
  lastSyncAt: null,
};

/** Signed in, because the hero reads its name and MPP count off the session. */
function signedInStore() {
  const store = makeStore();
  store.dispatch(
    loggedIn({
      access: 'a',
      refresh: 'r',
      user: { id: 1, fullName: 'Sunil Kumar', role: 'mait', mobileNo: '9876543210', maitId: 341 },
      assignedMppCodes: ['001303', '001305', '001307'],
    }),
  );
  return store;
}

function render(overrides: Partial<React.ComponentProps<typeof HomeScreen>> = {}) {
  return renderWithStore(<HomeScreen {...props} {...overrides} />, { store: signedInStore() });
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
    expect(screen.getByText(/MAIT 341/)).toBeTruthy();
    expect(screen.getByText(/3 MPPs/)).toBeTruthy();
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

  it('offers to resume an insemination whose photo never arrived', async () => {
    const unfinished = event({ id: 9, status: 'straw_verified', client_uuid: 'uuid-9' });
    const onResume = jest.fn();
    mockApi(SUMMARY, [unfinished]);
    render({ onResume });

    await waitFor(() => expect(screen.getByTestId('resume-unfinished')).toBeTruthy());
    expect(screen.getByText(/Kavita Devi/)).toBeTruthy();

    fireEvent.press(screen.getByTestId('resume-unfinished'));
    // The whole event goes back, so the flow can restore its client_uuid — a new one would
    // record the insemination twice (ADR 0003).
    expect(onResume).toHaveBeenCalledWith(expect.objectContaining({ client_uuid: 'uuid-9' }));
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
});
