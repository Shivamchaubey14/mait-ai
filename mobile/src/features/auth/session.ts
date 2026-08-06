/**
 * Keeping a Mait signed in across restarts (SRS §16).
 *
 * Without this the session lives in memory only, so closing the app — or Android killing it
 * to reclaim memory, which happens constantly on the handsets this runs on — signs the Mait
 * out mid-round. They then have to wait for an SMS in a village with one bar to get back to
 * work they were halfway through.
 *
 * Stored in expo-secure-store, not AsyncStorage: on Android that is the Keystore-backed
 * store, so the tokens are encrypted at rest and are not readable from a backup or by another
 * app. A field phone is shared, lost and handed around, which is exactly the threat model the
 * refresh token has to survive.
 *
 * Only the session goes here. The offline queue holds no credentials, and nothing in it is
 * worth encrypting.
 */

import * as SecureStore from 'expo-secure-store';

import type { AuthUser } from './authSlice';

const KEY = 'maitai.session.v1';

export interface StoredSession {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
  assignedMppCodes: string[];
}

export async function saveSession(session: StoredSession): Promise<void> {
  try {
    await SecureStore.setItemAsync(KEY, JSON.stringify(session));
  } catch {
    // A device with no secure hardware, or storage that is full. The session still works for
    // this run; failing the write must not fail the sign-in that just succeeded.
  }
}

/**
 * Read the session back, or null if there is none.
 *
 * Never throws. A corrupt or unreadable entry means "signed out" — the login screen is a
 * recoverable state, an app that crashes on launch is not.
 */
export async function loadSession(): Promise<StoredSession | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as StoredSession;
    if (!parsed.accessToken || !parsed.refreshToken) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function clearSession(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(KEY);
  } catch {
    // Nothing useful to do. The store is cleared in Redux either way, so the app is signed
    // out for this run regardless.
  }
}
