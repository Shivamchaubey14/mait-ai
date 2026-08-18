/**
 * The Android back gesture (SRS §10.3).
 *
 * There is no react-navigation in this shell — it is a state machine of `if`s — so nothing
 * claimed the press and Android did what it does with an unhandled one: it backgrounded the
 * app. A Mait swiping back off the waiting list, expecting Home, got their whole round thrown
 * off screen instead.
 *
 * These tests drive the real navigator and press the real handler, because the risk is not in
 * the map of steps but in which of the shell's overlapping states claims the press first. The
 * capture flow, the waiting list and an open indent are all layered over the tabs, and an
 * order that reads fine in isolation is what sends a half-finished capture somewhere it cannot
 * come back from.
 */

import React from 'react';
import { BackHandler } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import RootNavigator from '../index';
import { clearQueue } from '@api/queue';
import type { InventorySummary } from '@api/types';
import { loggedIn } from '@/features/auth/authSlice';
import type { AuthUser } from '@/features/auth/authSlice';
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

/**
 * The handler the navigator has registered, read at press time rather than captured once.
 *
 * It re-registers on every state change — `goBack` closes over the state it routes on — so a
 * reference kept from the first render would route from the screen the test started on.
 */
let handler: (() => boolean) | null = null;

/** Press Android's back. Returns what the app told the OS: `false` means "close me". */
function pressBack(): boolean {
  let handled = false;
  act(() => {
    handled = handler?.() ?? false;
  });
  return handled;
}

function mockApi() {
  (global.fetch as jest.Mock) = jest.fn((input: string | Request) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.includes('/mait/inventory/')) {
      return Promise.resolve(jsonResponse(SUMMARY));
    }
    // The config endpoints answer with a bare array. Handing them a paginated envelope makes
    // the screen call `.find` on an object and throw, which unmounts the tree and surfaces
    // here as back going nowhere rather than as the type error it is.
    if (url.includes('/config/')) {
      return Promise.resolve(jsonResponse([]));
    }
    // Everything else on these screens is a list: events, MPPs, indents. An empty page renders
    // the screen without inventing data that would only distract from where back goes.
    return Promise.resolve(jsonResponse({ count: 0, next: null, previous: null, results: [] }));
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

beforeEach(async () => {
  await clearQueue();
  mockApi();

  // The navigator unsubscribes on unmount, and the shared NetInfo mock returns nothing to
  // unsubscribe with — which fails teardown rather than the test.
  (NetInfo.addEventListener as jest.Mock).mockReturnValue(() => {});

  handler = null;
  jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, listener) => {
    handler = listener as () => boolean;
    return { remove: jest.fn() };
  });
});

afterEach(() => jest.restoreAllMocks());

describe('back from the tabs', () => {
  it('leaves Home to Android, so back still closes the app', async () => {
    renderApp();
    await screen.findByTestId('home-start-ai');

    // Registered, so `false` below is the navigator declining the press rather than the
    // navigator never having listened for it — which is the bug all of this exists to fix.
    expect(handler).not.toBeNull();

    // Home is the bottom of the stack. Claiming the press here would trap a Mait in an app
    // they cannot back out of, which is worse than the bug this handler fixes.
    expect(pressBack()).toBe(false);
  });

  it('returns to Home from another tab rather than closing the app', async () => {
    renderApp();
    await screen.findByTestId('home-start-ai');

    fireEvent.press(screen.getByTestId('tab-stock'));
    await screen.findByTestId('stock-cta');

    expect(pressBack()).toBe(true);
    await screen.findByTestId('home-start-ai');
  });
});

describe('back from the waiting list', () => {
  it('goes to Home, the screen it was opened from', async () => {
    renderApp();
    fireEvent.press(await screen.findByTestId('tile-waiting'));
    await screen.findByText('Nothing here is lost');

    expect(pressBack()).toBe(true);

    // Home, not merely "the queue closed" — the list is layered over the tabs, and leaving it
    // on whichever tab was last lit is how a Mait ends up somewhere they never asked for.
    await screen.findByTestId('home-start-ai');
  });
});

describe('back inside the capture flow', () => {
  it('steps back one screen instead of abandoning the capture', async () => {
    renderApp();
    fireEvent.press(await screen.findByTestId('home-start-ai'));
    await screen.findByText('Is she a member?');

    fireEvent.press(screen.getByTestId('owner-type-continue'));
    await screen.findByText('Which collection point?');

    expect(pressBack()).toBe(true);

    // Back to the fork, still in the flow. A gesture that dropped the whole capture here
    // would cost a Mait every answer they had given.
    await screen.findByText('Is she a member?');
    expect(screen.queryByText('Which collection point?')).toBeNull();
  });

  it('leaves the flow for Home at the first step, where nothing is committed yet', async () => {
    renderApp();
    fireEvent.press(await screen.findByTestId('home-start-ai'));
    await screen.findByText('Is she a member?');

    expect(pressBack()).toBe(true);

    await screen.findByTestId('home-start-ai');
    expect(screen.queryByText('Is she a member?')).toBeNull();
  });
});

describe('back from the stock screens layered over Inventory', () => {
  it('closes the indent list to Inventory, then Inventory to Home', async () => {
    renderApp();
    await screen.findByTestId('home-start-ai');

    fireEvent.press(screen.getByTestId('tab-stock'));
    fireEvent.press(await screen.findByTestId('stock-open-indents'));
    await screen.findByText('Your requests');

    // One press, one screen. The list and the tab under it are two separate places, and
    // collapsing both at once skips a screen the Mait was on a moment ago.
    expect(pressBack()).toBe(true);
    await screen.findByTestId('stock-cta');

    expect(pressBack()).toBe(true);
    await screen.findByTestId('home-start-ai');
  });

  it('closes the stock request form without leaving Inventory', async () => {
    renderApp();
    await screen.findByTestId('home-start-ai');

    fireEvent.press(screen.getByTestId('tab-stock'));
    fireEvent.press(await screen.findByTestId('stock-cta'));
    await screen.findByText('Request stock');

    expect(pressBack()).toBe(true);

    await waitFor(() => expect(screen.getByTestId('stock-cta')).toBeTruthy());
  });
});
