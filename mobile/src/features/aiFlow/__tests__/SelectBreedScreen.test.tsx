/**
 * Straw-breed selection tests (SRS §6.3 step 4, C7).
 *
 * The screen exists to ask up front what the server would otherwise refuse the straw number
 * for, so the cases that matter are the ones about stock: a breed the flask is empty of
 * cannot be chosen, and it cannot be hidden either.
 */

import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import SelectBreedScreen from '../SelectBreedScreen';
import { jsonResponse, renderWithStore } from '@/test-utils';

const BREEDS = [
  { code: 'HF_CROSS', name: 'HF Cross', name_hi: '', animal_type: 'COW', display_order: 1 },
  { code: 'SAHIWAL', name: 'Sahiwal', name_hi: '', animal_type: 'COW', display_order: 2 },
  { code: 'GIR', name: 'Gir', name_hi: '', animal_type: 'COW', display_order: 3 },
];

function mockApi(byBreed: Record<string, number>) {
  (global.fetch as jest.Mock).mockImplementation(async (input: string | Request) => {
    const href = typeof input === 'string' ? input : input.url;
    if (href.includes('/config/breeds/')) {
      return jsonResponse(BREEDS);
    }
    return jsonResponse({
      total_straws: Object.values(byBreed).reduce((sum, n) => sum + n, 0),
      is_low_stock: false,
      by_breed: byBreed,
      consumables: [],
      assets: [],
    });
  });
}

describe('SelectBreedScreen', () => {
  const onSelect = jest.fn();
  const onBack = jest.fn();

  beforeEach(() => {
    global.fetch = jest.fn() as jest.Mock;
  });

  afterEach(() => jest.resetAllMocks());

  function renderScreen() {
    return renderWithStore(
      <SelectBreedScreen animalType="COW" onSelect={onSelect} onBack={onBack} />,
    );
  }

  it('says how many straws of each breed the Mait is carrying', async () => {
    mockApi({ HF_CROSS: 18, SAHIWAL: 12 });
    renderScreen();

    await waitFor(() => expect(screen.getByText('18 straws with you')).toBeTruthy());
    expect(screen.getByText('12 straws with you')).toBeTruthy();
  });

  it('warns on a breed that is nearly out rather than only when it is gone', async () => {
    mockApi({ HF_CROSS: 18, SAHIWAL: 2 });
    renderScreen();

    await waitFor(() => expect(screen.getByText('2 straws with you')).toBeTruthy());
    expect(screen.getByText('Low')).toBeTruthy();
  });

  it('shows a breed with no straws, blocked, instead of hiding it', async () => {
    mockApi({ HF_CROSS: 18, SAHIWAL: 12 });
    renderScreen();

    await waitFor(() => expect(screen.getByText('Gir')).toBeTruthy());
    expect(screen.getByText('None in your stock')).toBeTruthy();
    expect(screen.getByText('Blocked')).toBeTruthy();

    fireEvent.press(screen.getByTestId('breed-GIR'));
    fireEvent.press(screen.getByTestId('breed-continue'));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('carries the chosen breed forward', async () => {
    mockApi({ HF_CROSS: 18, SAHIWAL: 12 });
    renderScreen();

    await waitFor(() => expect(screen.getByTestId('breed-SAHIWAL')).toBeTruthy());
    fireEvent.press(screen.getByTestId('breed-SAHIWAL'));
    fireEvent.press(screen.getByTestId('breed-continue'));

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ code: 'SAHIWAL' }));
  });

  it('puts what the Mait has most of first, whatever order the catalogue is in', async () => {
    mockApi({ HF_CROSS: 4, SAHIWAL: 20 });
    renderScreen();

    await waitFor(() => expect(screen.getByText('Sahiwal')).toBeTruthy());
    const order = screen.getAllByText(/HF Cross|Sahiwal|Gir/).map(node => node.props.children);

    expect(order).toEqual(['Sahiwal', 'HF Cross', 'Gir']);
  });

  it('says the round cannot go ahead when the flask is empty', async () => {
    mockApi({});
    renderScreen();

    await waitFor(() => expect(screen.getByTestId('breed-no-stock')).toBeTruthy());
    fireEvent.press(screen.getByTestId('breed-continue'));
    expect(onSelect).not.toHaveBeenCalled();
  });
});
