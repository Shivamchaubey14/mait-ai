/**
 * Raising an indent is a tab of its own.
 *
 * It was a button at the foot of Inventory — one screen deeper than the thing a Mait does every
 * few days. Now it sits on the bar beside Inventory, the button is gone from Inventory, and
 * Android's back from it goes Home, like every other tab.
 *
 * Driven through the real gate and navigator, as the other shell tests are.
 */

import React from 'react';
import { BackHandler } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { act, fireEvent, screen } from '@testing-library/react-native';

import Shell from '../Shell';
import { clearQueue } from '@api/queue';
import type { InventorySummary } from '@api/types';
import { loggedIn, loggedOut } from '@/features/auth/authSlice';
import type { AuthUser } from '@/features/auth/authSlice';
import i18n from '@/i18n';
import { jsonResponse, makeStore, renderWithStore } from '@/test-utils';

const SUMMARY: InventorySummary = {
  total_straws: 12,
  is_low_stock: false,
  by_breed: { Murrah: 12 },
  straws: [],
  consumables: [],
  assets: [],
};

const USER: AuthUser = {
  id: 4,
  fullName: 'Rohit Kumar',
  role: 'mait',
  mobileNo: '5500000054',
  maitId: 1,
  sahayakVendorCode: '5500000054',
};

beforeEach(async () => {
  await clearQueue();
  (global.fetch as jest.Mock) = jest.fn((input: string | Request) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.includes('/mait/inventory/')) {
      return Promise.resolve(jsonResponse(SUMMARY));
    }
    if (url.includes('/config/')) {
      return Promise.resolve(jsonResponse([]));
    }
    return Promise.resolve(jsonResponse({ count: 0, next: null, previous: null, results: [] }));
  });
  (NetInfo.addEventListener as jest.Mock).mockReturnValue(() => {});
});

afterEach(async () => {
  jest.restoreAllMocks();
  await i18n.changeLanguage('en');
});

async function signedIn() {
  const store = makeStore();
  act(() => {
    store.dispatch(loggedOut());
  });
  renderWithStore(<Shell fontsLoaded />, { store });
  act(() => {
    store.dispatch(
      loggedIn({ access: 'access-4', refresh: 'refresh-4', user: USER, assignedMppCodes: [] }),
    );
  });
  await screen.findByTestId('home-start-ai');
}

describe('the Indent tab', () => {
  it('sits on the bar beside Inventory, named in both languages', async () => {
    await signedIn();

    const tabs = screen.getAllByRole('tab').map(tab => tab.props.testID);
    expect(tabs).toEqual([
      'tab-home',
      'tab-stock',
      'tab-requestStock',
      'tab-history',
      'tab-settings',
    ]);
    expect(screen.getByTestId('tab-requestStock')).toHaveTextContent(/Indent$/);

    await act(async () => {
      await i18n.changeLanguage('hi');
    });
    expect(screen.getByTestId('tab-requestStock')).toHaveTextContent(/इंडेंट$/);
  });

  it('opens the form to raise an indent', async () => {
    await signedIn();

    fireEvent.press(screen.getByTestId('tab-requestStock'));

    expect(await screen.findByTestId('indent-count')).toBeTruthy();
    expect(screen.getByTestId('tab-requestStock')).toHaveProp('accessibilityState', {
      selected: true,
    });
  });

  it('is the only way to the form — Inventory no longer has a button for it', async () => {
    await signedIn();
    fireEvent.press(screen.getByTestId('tab-stock'));

    await screen.findByTestId('stock-tab-straws');
    expect(screen.queryByText('Raise an indent')).toBeNull();
  });

  it('goes Home on Android’s back, like every other tab', async () => {
    const handlers: (() => boolean | null | undefined)[] = [];
    jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_, handler) => {
      handlers.push(handler);
      return { remove: () => {} } as ReturnType<typeof BackHandler.addEventListener>;
    });
    await signedIn();
    fireEvent.press(screen.getByTestId('tab-requestStock'));
    await screen.findByTestId('indent-count');

    act(() => {
      handlers[handlers.length - 1]?.();
    });

    expect(await screen.findByTestId('home-start-ai')).toBeTruthy();
  });
});
