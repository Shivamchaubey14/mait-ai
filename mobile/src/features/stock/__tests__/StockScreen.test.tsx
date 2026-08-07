/**
 * Stock insight tests (SRS §6.5).
 *
 * The card answers "can I work" and "what am I carrying" in one glance, and both answers are
 * arithmetic over three lists. The risk is a total that quietly counts the wrong things —
 * a Mait who trusts a number that includes equipment will set out with too few straws.
 */

import React from 'react';
import { screen, waitFor } from '@testing-library/react-native';

import StockScreen from '../StockScreen';
import type { InventorySummary } from '@api/types';
import { jsonResponse, renderWithStore } from '@/test-utils';

const SUMMARY: InventorySummary = {
  total_straws: 24,
  is_low_stock: false,
  by_breed: { MURRAH: 18, SAHIWAL: 6, GIR: 0 },
  consumables: [
    { code: 'SHEATH', name: 'Sheaths', unit: 'piece', qty: 40 },
    { code: 'GLOVES', name: 'Gloves', unit: 'pair', qty: 6 },
  ],
  assets: [{ code: 'AI_GUN', name: 'AI gun', unit: 'piece', qty: 1 }],
};

/**
 * Every screen query answers from the same mock. Only the inventory summary carries the
 * numbers under test; the rest answer empty. The config endpoints return a bare array rather
 * than a page — handing those a paginated envelope makes the screen call `.find` on an object
 * and throw, which surfaces as a missing element rather than as the type error it is.
 */
function mockApi(summary: InventorySummary) {
  (global.fetch as jest.Mock).mockImplementation((input: string | Request) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.includes('/mait/inventory/')) {
      return Promise.resolve(jsonResponse(summary));
    }
    if (url.includes('/config/')) {
      return Promise.resolve(jsonResponse([]));
    }
    return Promise.resolve(jsonResponse({ count: 0, next: null, previous: null, results: [] }));
  });
}

describe('StockScreen insight', () => {
  const onOpenIndents = jest.fn();

  beforeEach(() => {
    global.fetch = jest.fn() as jest.Mock;
  });

  afterEach(() => jest.resetAllMocks());

  const renderScreen = () => renderWithStore(<StockScreen onOpenIndents={onOpenIndents} />);

  it('sums straws, consumable units and equipment into one total', async () => {
    mockApi(SUMMARY);
    renderScreen();

    // 24 straws + 46 consumable units + 1 gun.
    await waitFor(() => expect(screen.getByText('71 things with you')).toBeTruthy());
  });

  it('keeps the semen count separate from the other products', async () => {
    mockApi(SUMMARY);
    renderScreen();

    await waitFor(() => screen.getByTestId('stat-semen'));

    expect(screen.getByTestId('stat-semen')).toHaveTextContent(/24/);
    expect(screen.getByTestId('stat-consumables')).toHaveTextContent(/46/);
    expect(screen.getByTestId('stat-assets')).toHaveTextContent(/1/);
  });

  it('counts only the breeds actually held', async () => {
    mockApi(SUMMARY);
    renderScreen();

    // GIR sits at zero in the summary and must not be counted as a breed in hand.
    await waitFor(() => expect(screen.getByTestId('stat-semen')).toHaveTextContent(/2 breeds/));
  });

  it('says the round can go on when there is enough', async () => {
    mockApi(SUMMARY);
    renderScreen();

    await waitFor(() => expect(screen.getByText('Enough for now')).toBeTruthy());
  });

  it('leads with the blocker when the flask is empty', async () => {
    mockApi({ ...SUMMARY, total_straws: 0, by_breed: {}, is_low_stock: true });
    renderScreen();

    // Consumables are still carried, so the total is not zero — the verdict has to come from
    // the straw count alone, or an empty flask reads as a stocked one.
    await waitFor(() => expect(screen.getByText('You cannot record an AI')).toBeTruthy());
    expect(screen.getByTestId('stat-semen')).toHaveTextContent(/0/);
  });

  it('states plainly when nothing has been issued at all', async () => {
    mockApi({ total_straws: 0, is_low_stock: true, by_breed: {}, consumables: [], assets: [] });
    renderScreen();

    await waitFor(() => expect(screen.getByText('Nothing issued to you yet')).toBeTruthy());
  });
});
