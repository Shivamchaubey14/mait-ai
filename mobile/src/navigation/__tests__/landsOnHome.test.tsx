/**
 * Signing back in starts on Home.
 *
 * A Mait signs out from Profile — it is the only screen with a sign-out on it, so it is the
 * screen every sign-out happens from. Signing back in used to land them straight back on
 * Profile: the navigator rendered the login screen itself, so signing out changed only what
 * it returned and never unmounted it, and the tab it was holding was still `settings`.
 *
 * These drive the real gate and the real navigator rather than asserting on state, because
 * the bug was never in the state — it was in what stayed mounted.
 */

import React from 'react';
import { BackHandler } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import Shell from '../Shell';
import { clearQueue } from '@api/queue';
import type { InventorySummary } from '@api/types';
import { loggedIn, loggedOut } from '@/features/auth/authSlice';
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

const SECOND_USER: AuthUser = {
  ...USER,
  id: 9,
  fullName: 'Suresh Yadav',
  mobileNo: '5500000099',
  sahayakVendorCode: '5500000099',
};

function mockApi() {
  (global.fetch as jest.Mock) = jest.fn((input: string | Request) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.includes('/mait/inventory/')) {
      return Promise.resolve(jsonResponse(SUMMARY));
    }
    // The config endpoints answer with a bare array; handing them a page makes the screen
    // call `.find` on an object and throw, which unmounts the tree.
    if (url.includes('/config/')) {
      return Promise.resolve(jsonResponse([]));
    }
    return Promise.resolve(jsonResponse({ count: 0, next: null, previous: null, results: [] }));
  });
}

function signIn(store: ReturnType<typeof makeStore>, user: AuthUser = USER) {
  act(() => {
    store.dispatch(
      loggedIn({
        access: `access-${user.id}`,
        refresh: `refresh-${user.id}`,
        user,
        assignedMppCodes: [],
      }),
    );
  });
}

beforeEach(async () => {
  await clearQueue();
  mockApi();
  // The navigator unsubscribes on unmount, and the shared mock returns nothing to
  // unsubscribe with — which fails teardown rather than the test.
  (NetInfo.addEventListener as jest.Mock).mockReturnValue(() => {});
});

afterEach(() => jest.restoreAllMocks());

/** A signed-out store that has finished reading storage, which is what the gate waits on. */
function renderShell() {
  const store = makeStore();
  act(() => {
    store.dispatch(loggedOut());
  });
  return renderWithStore(<Shell fontsLoaded />, { store });
}

describe('where a session starts', () => {
  it('shows login when there is no session', async () => {
    renderShell();
    await screen.findByTestId('login-mobile');
  });

  it('starts on Home when a Mait signs in', async () => {
    const { store } = renderShell();
    signIn(store);
    await screen.findByTestId('home-start-ai');
  });

  it('starts on Home again after a sign-out from Profile', async () => {
    const { store } = renderShell();
    signIn(store);
    await screen.findByTestId('home-start-ai');

    // Profile is where the sign-out lives, so it is the tab every sign-out happens from.
    fireEvent.press(screen.getByTestId('tab-settings'));
    await screen.findByTestId('sign-out');

    act(() => {
      store.dispatch(loggedOut());
    });
    await screen.findByTestId('login-mobile');

    signIn(store);
    // Home, not the Profile screen they left from.
    await screen.findByTestId('home-start-ai');
    expect(screen.queryByTestId('sign-out')).toBeNull();
  });

  it('does not hand the next Mait the last one screen', async () => {
    const { store } = renderShell();
    signIn(store);
    await screen.findByTestId('home-start-ai');

    fireEvent.press(screen.getByTestId('tab-stock'));
    await screen.findByTestId('stock-cta');

    act(() => {
      store.dispatch(loggedOut());
    });
    await screen.findByTestId('login-mobile');

    // A shared handset, which is the normal case in the field.
    signIn(store, SECOND_USER);
    await screen.findByTestId('home-start-ai');
  });

  it('unmounts the navigator on sign-out rather than hiding it', async () => {
    /**
     * The mechanism, not the symptom.
     *
     * Asserting on what is drawn cannot tell the two structures apart: the old one returned
     * the login screen *from inside* the navigator, so the tabs were off screen either way
     * while the state behind them stayed alive. The back handler is the difference — it is
     * registered in an effect and torn down only by an actual unmount.
     */
    const remove = jest.fn();
    const add = jest.spyOn(BackHandler, 'addEventListener').mockReturnValue({ remove } as never);

    const { store } = renderShell();
    signIn(store);
    await screen.findByTestId('home-start-ai');

    // It re-subscribes on every state change — `goBack` closes over what it routes on — so
    // the count is never zero. What says "mounted" is one subscription outstanding.
    const outstanding = () => add.mock.calls.length - remove.mock.calls.length;
    expect(outstanding()).toBe(1);

    act(() => {
      store.dispatch(loggedOut());
    });

    // Nothing outstanding: the last teardown ran with no re-subscribe after it, which only
    // happens when the component itself goes.
    await waitFor(() => expect(outstanding()).toBe(0));
    await screen.findByTestId('login-mobile');
  });
});
