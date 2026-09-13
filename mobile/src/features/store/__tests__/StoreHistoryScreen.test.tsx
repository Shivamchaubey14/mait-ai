/**
 * The keeper's History tab: every handover under the day it happened.
 */

import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import type { StoreHandover } from '@api/types';
import i18n from '@/i18n';
import { jsonResponse, renderWithStore } from '@/test-utils';

import StoreHistoryScreen, {
  dayHeading,
  localIso,
  totalsByItem,
  windowStart,
} from '../StoreHistoryScreen';

const NOW = new Date();
const at = (daysAgo: number, hour: number) => {
  const d = new Date(NOW);
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, 20, 0, 0);
  return d.toISOString();
};

function handover(overrides: Partial<StoreHandover> = {}): StoreHandover {
  return {
    id: 1,
    indent_id: 13,
    mait_name: 'Sunil Kumar',
    product_type: 'straw',
    breed: 'MURRAH',
    item_name: 'Murrah',
    item_name_hi: '',
    qty: 18,
    qty_requested: 25,
    qty_open: 7,
    collection_code: '4729',
    flask_checked: true,
    issued_at: at(0, 11),
    collected_at: at(0, 11),
    cancelled_at: null,
    state: 'collected',
    locked: false,
    ...overrides,
  };
}

const ROWS = [
  handover(),
  handover({
    id: 2,
    indent_id: 14,
    mait_name: 'Ramesh Yadav',
    qty: 2,
    state: 'waiting',
    collected_at: null,
    issued_at: at(0, 9),
  }),
  handover({
    id: 3,
    indent_id: 11,
    mait_name: 'Devi Prasad',
    qty: 5,
    issued_at: at(1, 16),
    collected_at: at(1, 16),
  }),
  handover({
    id: 4,
    indent_id: 12,
    mait_name: 'Devi Prasad',
    qty: 4,
    state: 'cancelled',
    collected_at: null,
    cancelled_at: at(2, 10),
    issued_at: at(2, 10),
  }),
];

beforeEach(() => {
  global.fetch = jest.fn(async () => jsonResponse(ROWS)) as jest.Mock;
});

afterEach(() => jest.resetAllMocks());

const render = (onOpenHandover = jest.fn()) =>
  renderWithStore(
    <StoreHistoryScreen storeName="Akbarpur depot" onOpenHandover={onOpenHandover} />,
  );

describe('StoreHistoryScreen', () => {
  it('puts each handover under the day it happened, with what it became', async () => {
    render();

    await waitFor(() => screen.getByTestId('history-row-1'));
    expect(screen.getByTestId(`history-day-${localIso(NOW)}`)).toHaveTextContent(/Today/);
    expect(screen.getByTestId('history-row-1')).toHaveTextContent(/IND-13 · Sunil Kumar/);
    expect(screen.getByTestId('history-row-1')).toHaveTextContent(/18 Murrah/);
    expect(screen.getByTestId('history-row-1')).toHaveTextContent(/Collected 11:20/);
    expect(screen.getByTestId('history-row-2')).toHaveTextContent(/Waiting for code/);
    expect(screen.getByTestId('history-row-4')).toHaveTextContent(/Put back/);
  });

  it('adds up what was handed over, leaving out what was put back', async () => {
    render();

    await waitFor(() => screen.getByTestId('history-totals'));
    // 18 + 2 + 5 — the 4 that went back on the shelf never left the store.
    expect(screen.getByTestId('history-totals')).toHaveTextContent(/25 Murrah/);
    expect(screen.getByTestId('history-totals')).toHaveTextContent(/1 still waiting/);
    expect(screen.getByText('3 handed over')).toBeTruthy();
  });

  it('asks the server for the window chosen', async () => {
    render();
    await waitFor(() => screen.getByTestId('history-row-1'));

    fireEvent.press(screen.getByTestId('history-window-today'));

    await waitFor(() => {
      const urls = (global.fetch as jest.Mock).mock.calls.map(([input]) => (input as Request).url);
      const today = localIso(NOW);
      expect(urls.some(url => url.includes(`from=${today}`) && url.includes(`to=${today}`))).toBe(
        true,
      );
    });
  });

  it('finds a Mait by name', async () => {
    render();
    await waitFor(() => screen.getByTestId('history-row-1'));

    fireEvent.changeText(screen.getByTestId('history-find'), 'devi');
    expect(screen.queryByTestId('history-row-1')).toBeNull();
    expect(screen.getByTestId('history-row-3')).toBeTruthy();
  });

  it('opens a handover to read it again', async () => {
    const open = jest.fn();
    render(open);
    await waitFor(() => screen.getByTestId('history-row-2'));

    fireEvent.press(screen.getByTestId('history-row-2'));
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }));
  });

  it("works out its dates in the handset's own day", () => {
    const today = new Date(2026, 8, 11, 10);
    expect(windowStart('today', today)).toBe('2026-09-11');
    expect(windowStart('week', today)).toBe('2026-09-05');
    expect(windowStart('month', today)).toBe('2026-08-13');
    const t = i18n.t.bind(i18n);
    expect(dayHeading(new Date(2026, 8, 10, 9).toISOString(), t, today)).toBe('Yesterday');
    expect(totalsByItem(ROWS, 'en')).toEqual([{ item: 'Murrah', qty: 25 }]);
  });
});
