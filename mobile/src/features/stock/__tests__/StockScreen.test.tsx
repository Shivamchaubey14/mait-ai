/**
 * Inventory (M15).
 *
 * Three tabs because a Mait acts on the three kinds differently, and the tests follow that
 * split. What is defended here is the reading rather than the layout: a straw count is what
 * decides whether the day can start, `issued 10 · used 8` is what turns a low balance into a
 * day's work accounted for, and a piece of equipment is a thing held rather than a quantity —
 * putting a number on it invites reading it as something that can run out.
 */

import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import StockScreen from '../StockScreen';
import type { InventorySummary } from '@api/types';
import { jsonResponse, renderWithStore } from '@/test-utils';

const BREEDS = [
  { code: 'HF', name: 'HF Cross', name_hi: '', animal_type: 'COW', display_order: 1 },
  { code: 'SAHIWAL', name: 'Sahiwal', name_hi: '', animal_type: 'COW', display_order: 2 },
  { code: 'MURRAH', name: 'Murrah', name_hi: '', animal_type: 'BUFF', display_order: 3 },
];

const SUMMARY: InventorySummary = {
  total_straws: 32,
  is_low_stock: false,
  by_breed: { HF: 18, SAHIWAL: 12, MURRAH: 2 },
  straws: [
    { breed: 'HF', animal_type: 'COW', qty: 18, issued: 20, used: 2 },
    { breed: 'SAHIWAL', animal_type: 'COW', qty: 12, issued: 12, used: 0 },
    { breed: 'MURRAH', animal_type: 'BUFF', qty: 2, issued: 10, used: 8 },
  ],
  consumables: [
    {
      code: 'SHEATH',
      name: 'AI sheaths',
      unit: '',
      qty: 46,
      issued: 50,
      used: 4,
      issued_at: '2026-03-14T09:00:00Z',
    },
    {
      code: 'GLOVES',
      name: 'Gloves',
      unit: 'pair',
      qty: 38,
      issued: 40,
      used: 2,
      issued_at: '2026-03-14T09:00:00Z',
    },
    {
      code: 'LN2',
      name: 'Liquid nitrogen',
      unit: 'litre',
      qty: 2,
      issued: 10,
      used: 8,
      issued_at: '2026-03-14T09:00:00Z',
    },
  ],
  assets: [
    {
      code: 'AI_GUN',
      name: 'AI gun',
      unit: 'piece',
      qty: 1,
      issued: 1,
      used: 0,
      issued_at: '2026-03-14T09:00:00Z',
    },
    {
      code: 'THAWING_TRAY',
      name: 'Thawing tray',
      unit: 'piece',
      qty: 1,
      issued: 1,
      used: 0,
      issued_at: null,
    },
  ],
};

const INDENT = {
  id: 2318,
  breed: 'MURRAH',
  item: 'Murrah',
  qty_requested: 20,
  qty_issued: 0,
  status: 'approved',
  status_display: 'Approved',
  sync_status: 'synced',
  sync_status_display: 'Synced',
  requested_at: '2026-08-14T09:00:00Z',
  issued_at: null,
  received_at: null,
  note: '',
};

function mockApi(summary: InventorySummary = SUMMARY, indents: unknown[] = []) {
  (global.fetch as jest.Mock).mockImplementation(async (input: string | Request) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.includes('/config/breeds/')) {
      return jsonResponse(BREEDS);
    }
    if (url.includes('/indents/')) {
      return jsonResponse({ count: indents.length, next: null, previous: null, results: indents });
    }
    return jsonResponse(summary);
  });
}

function render() {
  return renderWithStore(<StockScreen onRequestStock={jest.fn()} />);
}

describe('StockScreen', () => {
  beforeEach(() => {
    global.fetch = jest.fn() as jest.Mock;
  });

  afterEach(() => jest.resetAllMocks());

  it('opens on straws, which is what decides whether the day can start', async () => {
    mockApi();
    render();

    await waitFor(() => expect(screen.getByText('32 straws held')).toBeTruthy());
    // Split by species, because that is how the flask is packed.
    expect(screen.getByText(/Cow 30/)).toBeTruthy();
    expect(screen.getByText(/Buffalo 2/)).toBeTruthy();
  });

  it('carries the mark, so a phone handed to a farmer says whose app it is', async () => {
    mockApi();
    render();

    await waitFor(() => expect(screen.getByText('MAIT AI')).toBeTruthy());
  });

  it('says what became of a breed, not just what is left', async () => {
    // Two straws with eight of ten used is a day accounted for. A bare 2 is a number to
    // worry about, and the ledger has always known the difference.
    mockApi();
    render();

    await waitFor(() => expect(screen.getByText('MURRAH · issued 10 · used 8')).toBeTruthy());
    expect(screen.getByText('HF · issued 20 · used 2')).toBeTruthy();
  });

  it('flags a breed that is nearly out on its own row', async () => {
    mockApi();
    render();

    await waitFor(() => expect(screen.getByTestId('stock-straw-MURRAH')).toBeTruthy());
    expect(screen.getByText('Low')).toBeTruthy();
  });

  it('lists only what is in the flask, never what is still on its way', async () => {
    // An indent is by definition stock that is not in the Mait's hands. Listed among the
    // straws it reads as stock, and a round started on straws still sitting at the depot is
    // an animal served against a count that was never real. They live on Profile, which can
    // say what is outstanding on each of them.
    mockApi(SUMMARY, [INDENT]);
    render();

    await waitFor(() => expect(screen.getByTestId('stock-straw-HF')).toBeTruthy());
    expect(screen.queryByTestId('stock-incoming-2318')).toBeNull();
    expect(screen.queryByText(/IND-2318/)).toBeNull();
    expect(screen.queryByText(/not issued/i)).toBeNull();
  });

  it('counts consumables in their own units', async () => {
    mockApi();
    render();

    fireEvent.press(await screen.findByTestId('stock-tab-consumables'));

    await waitFor(() => expect(screen.getByText('3 consumables')).toBeTruthy());
    expect(screen.getByText('GLOVES · per pair')).toBeTruthy();
    expect(screen.getByTestId('stock-consumable-LN2')).toBeTruthy();
  });

  it('warns about nitrogen, which spoils the flask rather than one insemination', async () => {
    mockApi();
    render();

    fireEvent.press(await screen.findByTestId('stock-tab-consumables'));

    await waitFor(() => expect(screen.getByTestId('stock-warning')).toBeTruthy());
    expect(screen.getByText('Nitrogen runs the flask, not the round')).toBeTruthy();
  });

  it('describes equipment by when it was issued, and never as a quantity', async () => {
    mockApi();
    render();

    fireEvent.press(await screen.findByTestId('stock-tab-equipment'));

    await waitFor(() => expect(screen.getByText('2 items with you')).toBeTruthy());
    expect(screen.getByText('AI_GUN · issued 14 Mar 2026')).toBeTruthy();
    // Held, not counted. A number here reads as something that can run out.
    expect(screen.getAllByText('In use').length).toBe(2);
    expect(screen.queryByText('1 piece')).toBeNull();
  });

  it('admits when an issue date was never recorded', async () => {
    mockApi();
    render();

    fireEvent.press(await screen.findByTestId('stock-tab-equipment'));

    await waitFor(() =>
      expect(screen.getByText('THAWING_TRAY · issue date not recorded')).toBeTruthy(),
    );
  });

  it('offers no action at all on equipment', async () => {
    mockApi();
    render();

    await waitFor(() => expect(screen.getByTestId('stock-cta')).toBeTruthy());
    expect(screen.getByText('Raise an indent')).toBeTruthy();

    fireEvent.press(screen.getByTestId('stock-tab-equipment'));

    // Equipment is issued once and held until the dairy asks for it back: nothing to order,
    // nothing to correct. The button here used to say "Report lost or broken" and open the
    // indent list, which is neither.
    await waitFor(() => expect(screen.queryByTestId('stock-cta')).toBeNull());
  });

  it('says the flask is empty rather than showing a zero', async () => {
    mockApi({
      total_straws: 0,
      is_low_stock: true,
      by_breed: {},
      straws: [],
      consumables: [],
      assets: [],
    });
    render();

    await waitFor(() => expect(screen.getByText('Nothing in your flask')).toBeTruthy());
  });
});
