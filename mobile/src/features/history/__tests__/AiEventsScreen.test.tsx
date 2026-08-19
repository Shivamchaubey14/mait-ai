/**
 * AI events list (M19).
 *
 * What this screen exists to stop is a Mait going back to a yard they have already finished
 * with. Every assertion here is about that: a capture the phone is still holding must read as
 * queued rather than as work, a capture the server has and that stopped short must say what is
 * missing on the row itself, and the headline must count both from the whole list rather than
 * from whichever chip happens to be on.
 *
 * The rupee figure gets its own test because it is the one number a farmer can dispute. A
 * member hands over nothing in the yard — her rate is taken off her milk payment by the dairy
 * — so a figure on her row would be cash somebody could be accused of pocketing.
 */

import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import AiEventsScreen from '../AiEventsScreen';
import { clearQueue, enqueue } from '@api/queue';
import type { AIEvent } from '@api/types';
import { jsonResponse, renderWithStore } from '@/test-utils';

/** A payment started and never confirmed — the state a capture waiting on her code is in. */
const UNCONFIRMED = {
  amount: '300.00',
  mode: 'COD' as const,
  mode_display: 'Cash',
  status: 'pending',
  status_display: 'Pending',
  is_verified: false,
};

const BREEDS = [
  {
    code: 'HF_CROSS',
    name: 'HF Cross',
    name_hi: 'एचएफ क्रॉस',
    animal_type: 'COW',
    display_order: 1,
  },
];

function at(hour: number, daysAgo = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, 42, 0, 0);
  return d.toISOString();
}

function event(over: Partial<AIEvent> = {}): AIEvent {
  return {
    id: 30,
    client_uuid: 'uuid-30',
    status: 'completed',
    status_display: 'Completed',
    mpp: 1,
    mpp_code: '001302',
    mpp_name: 'Barsana MPP',
    owner_type: 'member',
    member: 4,
    member_code: 'MEM00000412',
    non_member: null,
    owner_name: 'Kavita Devi',
    animal: 7,
    animal_type: 'COW',
    breed: 'HF_CROSS',
    ear_tag_no: '4821',
    semen_breed: 'HF_CROSS',
    amount_due: '50.00',
    payment: {
      amount: '50.00',
      mode: 'DEDUCTION',
      mode_display: 'Deducted from milk',
      status: 'verified',
      status_display: 'Verified',
      is_verified: true,
    },
    straw_unique_no: '',
    ai_photo_url: '/media/ai-photos/30.jpg',
    gps_lat: '26.7524000',
    gps_lng: '82.1408000',
    performed_at: at(10),
    completed_at: at(10),
    cancelled_reason: '',
    created_at: at(10),
    ...over,
  } as AIEvent;
}

function mockApi(events: AIEvent[]) {
  (global.fetch as jest.Mock).mockImplementation(async (input: string | Request) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.includes('/config/breeds/')) {
      return jsonResponse(BREEDS);
    }
    return jsonResponse({ count: events.length, next: null, previous: null, results: events });
  });
}

describe('AiEventsScreen', () => {
  const onOpen = jest.fn();

  beforeEach(async () => {
    global.fetch = jest.fn() as jest.Mock;
    await clearQueue();
  });

  afterEach(() => jest.resetAllMocks());

  it('names what is missing on a capture the server has and that stopped short', async () => {
    mockApi([
      event({ id: 31, owner_name: 'Radha Singh', status: 'payment_pending', payment: UNCONFIRMED }),
    ]);
    renderWithStore(<AiEventsScreen onOpen={onOpen} />);

    await waitFor(() => expect(screen.getByText('Radha Singh')).toBeTruthy());
    expect(screen.getByText('Needs attention')).toBeTruthy();
    expect(screen.getByText(/payment code missing/)).toBeTruthy();
  });

  it('reads a capture still on this phone as queued rather than as work', async () => {
    // The same unfinished status as above. The difference is that the handset is still
    // holding it — telling the Mait it needs them would send them back to a finished yard.
    await enqueue(
      'completeEvent',
      'uuid-31',
      { eventId: 31 },
      {
        farmer: 'Radha Singh',
        kind: 'nonMember',
        at: '9:20',
        eventId: 31,
      },
    );
    mockApi([
      event({ id: 31, owner_name: 'Radha Singh', status: 'payment_pending', payment: UNCONFIRMED }),
    ]);
    renderWithStore(<AiEventsScreen onOpen={onOpen} />);

    await waitFor(() => expect(screen.getByText('Queued')).toBeTruthy());
    expect(screen.queryByText('Needs attention')).toBeNull();
  });

  it('counts what is waiting across the whole list, not the filter in force', async () => {
    mockApi([
      event(),
      event({
        id: 31,
        owner_name: 'Radha Singh',
        status: 'payment_pending',
        payment: UNCONFIRMED,
        created_at: at(9, 4),
      }),
    ]);
    renderWithStore(<AiEventsScreen onOpen={onOpen} />);

    // One event today, and the one waiting is four days back — still counted, because a Mait
    // reading "1 today" with nothing else said would think the week was clear.
    await waitFor(() =>
      expect(screen.getByTestId('ai-events-headline')).toHaveTextContent(/1 today, 1 waiting/),
    );
  });

  it('keeps older events out of Today and shows them under All', async () => {
    mockApi([event({ id: 31, owner_name: 'Radha Singh', created_at: at(9, 4) })]);
    renderWithStore(<AiEventsScreen onOpen={onOpen} />);

    await waitFor(() => expect(screen.getByTestId('empty-state')).toBeTruthy());
    expect(screen.queryByText('Radha Singh')).toBeNull();

    fireEvent.press(screen.getByTestId('ai-events-range-all'));
    expect(screen.getByText('Radha Singh')).toBeTruthy();
  });

  it('shows a member as having handed over nothing', async () => {
    mockApi([event()]);
    renderWithStore(<AiEventsScreen onOpen={onOpen} />);

    // Her ₹50 is deducted from her milk payment by the dairy; it never passes through the
    // Mait's hands, and a row claiming it did is the beginning of an accusation.
    await waitFor(() => expect(screen.getByText(/HF Cross · ₹ 0/)).toBeTruthy());
    expect(screen.queryByText(/₹ 50/)).toBeNull();
  });

  it('opens the event that was tapped', async () => {
    mockApi([event()]);
    renderWithStore(<AiEventsScreen onOpen={onOpen} />);

    await waitFor(() => screen.getByTestId('ai-event-30'));
    fireEvent.press(screen.getByTestId('ai-event-30'));

    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 30 }));
  });
});
