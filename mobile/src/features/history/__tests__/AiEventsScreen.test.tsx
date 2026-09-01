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
import i18n from '@/i18n';
import { formatRange, isoDate } from '@/components/dateRange';
import { jsonResponse, renderWithStore } from '@/test-utils';

/**
 * The clock these tests run against.
 *
 * Pinned, because every date here is picked relative to "today" and the calendar only draws
 * the current month. Left on the real clock the suite passed for twenty-odd days a month and
 * then failed on the first few, when `daysBack(6)` lands in a month the grid is not showing —
 * which is exactly how it broke, on the 1st, with nothing having changed.
 *
 * Mid-month so that a week either side of it stays inside the same grid.
 */
const TODAY = new Date('2026-08-14T09:00:00.000Z');

/** A day the calendar will actually offer — the grid refuses anything after today. */
function daysBack(days: number): Date {
  const d = new Date(TODAY);
  d.setDate(d.getDate() - days);
  return d;
}

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
  const d = new Date(TODAY);
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
    stock_deducted: true,
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
    // The screen reads the clock to build the calendar and to label "today", so it has to see
    // the same date the fixtures were built from.
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    jest.setSystemTime(TODAY);
    global.fetch = jest.fn() as jest.Mock;
    await clearQueue();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.resetAllMocks();
  });

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

  it('gives the three chips equal width, so they read as one control', async () => {
    // They were content-width, which made "Today" narrower than "This week" and left a ragged
    // gap after "All" — three answers to one question drawn at three different sizes.
    mockApi([event()]);
    renderWithStore(<AiEventsScreen onOpen={onOpen} />);

    await waitFor(() => screen.getByTestId('ai-events-range-today'));
    const widths = ['today', 'week', 'all'].map(key => {
      const style = screen.getByTestId(`ai-events-range-${key}`).props.style;
      return (Array.isArray(style) ? style : [style])
        .filter(Boolean)
        .reduce((acc, layer) => ({ ...acc, ...layer }), {}).flex;
    });
    expect(widths).toEqual([1, 1, 1]);
  });

  it('asks the server for a chosen range rather than filtering the page it holds', async () => {
    // A Mait asking for last March is asking for rows this handset has never downloaded, so
    // the range has to reach the API. Filtering the cached page would answer "nothing".
    mockApi([event()]);
    renderWithStore(<AiEventsScreen onOpen={onOpen} />);

    await waitFor(() => screen.getByTestId('ai-events-range-dates'));
    fireEvent.press(screen.getByTestId('ai-events-range-dates'));

    const first = isoDate(daysBack(6));
    const last = isoDate(daysBack(2));
    fireEvent.press(screen.getByTestId(`date-range-day-${first}`));
    fireEvent.press(screen.getByTestId(`date-range-day-${last}`));
    fireEvent.press(screen.getByTestId('date-range-apply'));

    await waitFor(() => {
      const asked = (global.fetch as jest.Mock).mock.calls
        .map(([input]) => (typeof input === 'string' ? input : input.url))
        .filter((url: string) => url.includes('date_from'));
      expect(asked.some((url: string) => url.includes(`date_from=${first}`))).toBe(true);
      expect(asked.some((url: string) => url.includes(`date_to=${last}`))).toBe(true);
    });
  });

  it('names the chosen range on the chip, since nothing else on the screen says it', async () => {
    mockApi([event()]);
    renderWithStore(<AiEventsScreen onOpen={onOpen} />);

    await waitFor(() => screen.getByTestId('ai-events-range-dates'));
    fireEvent.press(screen.getByTestId('ai-events-range-dates'));

    const day = daysBack(3);
    fireEvent.press(screen.getByTestId(`date-range-day-${isoDate(day)}`));
    fireEvent.press(screen.getByTestId('date-range-apply'));

    // Asserted through the same formatter the chip uses, so the test says "the chip names the
    // range" rather than pinning the exact wording of the label.
    const months = i18n.t('calendar.months', { returnObjects: true }) as string[];
    await waitFor(() =>
      expect(screen.getByText(formatRange(isoDate(day), isoDate(day), months))).toBeTruthy(),
    );
  });

  it('puts all three chips out while a range of dates is in force', async () => {
    // Two filters both claiming to say what the list is showing is a list nobody can read.
    mockApi([event()]);
    renderWithStore(<AiEventsScreen onOpen={onOpen} />);

    await waitFor(() => screen.getByTestId('ai-events-range-today'));
    expect(screen.getByTestId('ai-events-range-today').props.accessibilityState.selected).toBe(
      true,
    );

    fireEvent.press(screen.getByTestId('ai-events-range-dates'));
    fireEvent.press(screen.getByTestId(`date-range-day-${isoDate(daysBack(3))}`));
    fireEvent.press(screen.getByTestId('date-range-apply'));

    await waitFor(() =>
      expect(screen.getByTestId('ai-events-range-today').props.accessibilityState.selected).toBe(
        false,
      ),
    );
    expect(screen.getByTestId('ai-events-range-dates').props.accessibilityState.selected).toBe(
      true,
    );
  });

  it('drops the range when a chip is tapped again', async () => {
    mockApi([event()]);
    renderWithStore(<AiEventsScreen onOpen={onOpen} />);

    await waitFor(() => screen.getByTestId('ai-events-range-dates'));
    fireEvent.press(screen.getByTestId('ai-events-range-dates'));
    fireEvent.press(screen.getByTestId(`date-range-day-${isoDate(daysBack(3))}`));
    fireEvent.press(screen.getByTestId('date-range-apply'));

    await waitFor(() =>
      expect(screen.getByTestId('ai-events-range-dates').props.accessibilityState.selected).toBe(
        true,
      ),
    );

    fireEvent.press(screen.getByTestId('ai-events-range-all'));

    expect(screen.getByTestId('ai-events-range-dates').props.accessibilityState.selected).toBe(
      false,
    );
    expect(screen.getByTestId('ai-events-range-all').props.accessibilityState.selected).toBe(true);
  });

  it('still counts the headline off the whole list while a range is in force', async () => {
    // The two numbers at the top are what a Mait checks before anything else, and they mean
    // "how is the day going" — not "how did the days I happen to be looking at go".
    mockApi([
      event(),
      event({ id: 31, owner_name: 'Radha Singh', status: 'payment_pending', payment: UNCONFIRMED }),
    ]);
    renderWithStore(<AiEventsScreen onOpen={onOpen} />);

    await waitFor(() => screen.getByTestId('ai-events-range-dates'));
    fireEvent.press(screen.getByTestId('ai-events-range-dates'));
    fireEvent.press(screen.getByTestId(`date-range-day-${isoDate(daysBack(1))}`));
    fireEvent.press(screen.getByTestId('date-range-apply'));

    await waitFor(() =>
      expect(screen.getByTestId('ai-events-headline')).toHaveTextContent(/2 today, 1 waiting/),
    );
  });

  it('opens the event that was tapped', async () => {
    mockApi([event()]);
    renderWithStore(<AiEventsScreen onOpen={onOpen} />);

    await waitFor(() => screen.getByTestId('ai-event-30'));
    fireEvent.press(screen.getByTestId('ai-event-30'));

    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 30 }));
  });
});
