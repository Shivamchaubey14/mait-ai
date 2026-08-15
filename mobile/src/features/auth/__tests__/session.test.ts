/**
 * Session persistence (SRS §16).
 *
 * A Mait stays signed in until they sign out. Getting this wrong is not a cosmetic bug: the
 * app restarting mid-round would send them back to the login screen, waiting on an SMS in a
 * village with one bar, halfway through work they have already done.
 */

import { configureStore } from '@reduxjs/toolkit';
import * as SecureStore from 'expo-secure-store';

import { clearQueue, enqueue, pendingCount } from '@api/queue';

import authReducer, { loggedIn, loggedOut, sessionRestored, tokensRefreshed } from '../authSlice';
import { sessionPersistence } from '../persistence';
import { clearSession, loadSession, saveSession } from '../session';

const USER = {
  id: 7,
  fullName: 'ROHIT KUMAR',
  role: 'mait' as const,
  mobileNo: '9999999999',
  maitId: 60,
};

const SESSION = {
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  user: USER,
  assignedMppCodes: ['001371'],
};

beforeEach(async () => {
  // The mocked store is module-level, so it outlives a test unless it is emptied.
  await clearSession();
  await clearQueue();
  jest.clearAllMocks();
});

describe('secure storage', () => {
  it('round-trips a session', async () => {
    await saveSession(SESSION);
    expect(await loadSession()).toEqual(SESSION);
  });

  it('reports no session when nothing is stored', async () => {
    expect(await loadSession()).toBeNull();
  });

  it('treats a corrupt entry as signed out rather than crashing on launch', async () => {
    // The login screen is a recoverable state; an app that dies at startup is not.
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce('{ not json');
    expect(await loadSession()).toBeNull();
  });

  it('ignores a stored entry with no refresh token', async () => {
    // Nothing could be done with it: the access token expires in fifteen minutes.
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(
      JSON.stringify({ accessToken: 'a', user: USER }),
    );
    expect(await loadSession()).toBeNull();
  });

  it('does not fail a sign-in when the write fails', async () => {
    // A device with no secure hardware still has to be able to work today.
    (SecureStore.setItemAsync as jest.Mock).mockRejectedValueOnce(new Error('no keystore'));
    await expect(saveSession(SESSION)).resolves.toBeUndefined();
  });

  it('clears without throwing when there is nothing to clear', async () => {
    (SecureStore.deleteItemAsync as jest.Mock).mockRejectedValueOnce(new Error('missing'));
    await expect(clearSession()).resolves.toBeUndefined();
  });
});

describe('the auth slice', () => {
  it('starts unrestored, so the app waits rather than flashing the login screen', () => {
    const state = authReducer(undefined, { type: 'init' });
    expect(state.restored).toBe(false);
    expect(state.accessToken).toBeNull();
  });

  it('restores a stored session', () => {
    const state = authReducer(
      undefined,
      sessionRestored({
        access: 'access-1',
        refresh: 'refresh-1',
        user: USER,
        assignedMppCodes: ['001371'],
      }),
    );

    expect(state.accessToken).toBe('access-1');
    expect(state.user?.fullName).toBe('ROHIT KUMAR');
    expect(state.restored).toBe(true);
  });

  it('counts "nothing stored" as a completed restore', () => {
    const state = authReducer(undefined, sessionRestored(null));
    expect(state.restored).toBe(true);
    expect(state.accessToken).toBeNull();
  });

  it('keeps the refresh token when a refresh does not rotate it', () => {
    const signedIn = authReducer(
      undefined,
      loggedIn({ access: 'a1', refresh: 'r1', user: USER, assignedMppCodes: [] }),
    );
    const refreshed = authReducer(signedIn, tokensRefreshed({ access: 'a2' }));

    expect(refreshed.accessToken).toBe('a2');
    expect(refreshed.refreshToken).toBe('r1');
  });

  it('stays restored after signing out, so the login screen shows immediately', () => {
    const signedIn = authReducer(
      undefined,
      loggedIn({ access: 'a1', refresh: 'r1', user: USER, assignedMppCodes: [] }),
    );
    const out = authReducer(signedIn, loggedOut());

    expect(out.accessToken).toBeNull();
    expect(out.restored).toBe(true);
  });
});

describe('signing out', () => {
  function storeWithPersistence() {
    return configureStore({
      reducer: { auth: authReducer },
      middleware: getDefault => getDefault().concat(sessionPersistence),
    });
  }

  /**
   * The queue belongs to the Mait, not to the handset.
   *
   * Left behind, those jobs would drain under whoever signs in next — and until then they sat
   * on a waiting list their owner had no way to empty, because nothing in the app cleared it.
   */
  it('takes the unsent queue with the session', async () => {
    await enqueue('completeEvent', 'uuid-1', { eventId: 5 });
    expect(await pendingCount()).toBe(1);

    storeWithPersistence().dispatch(loggedOut());

    // The middleware fires the clear without awaiting it, as it does for the session itself.
    await new Promise(resolve => setImmediate(resolve));
    expect(await pendingCount()).toBe(0);
  });

  it('leaves the queue alone on a token refresh, which is not a sign-out', async () => {
    const store = storeWithPersistence();
    store.dispatch(loggedIn({ access: 'a1', refresh: 'r1', user: USER, assignedMppCodes: [] }));
    await enqueue('completeEvent', 'uuid-2', { eventId: 6 });

    store.dispatch(tokensRefreshed({ access: 'a2' }));

    await new Promise(resolve => setImmediate(resolve));
    expect(await pendingCount()).toBe(1);
  });
});
