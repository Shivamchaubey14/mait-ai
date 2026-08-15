/**
 * Mirrors the auth slice into secure storage.
 *
 * Middleware rather than a call at each site: tokens change in three places — signing in, the
 * silent refresh on a 401, and signing out — and the one that gets forgotten is the refresh,
 * which is also the one that matters most. It fires every fifteen minutes, and a stored token
 * that stops being updated is a Mait signed out overnight for no reason they can see.
 */

import type { Middleware } from '@reduxjs/toolkit';

import { clearQueue } from '@api/queue';

import { loggedIn, loggedOut, tokensRefreshed } from './authSlice';
import { clearSession, saveSession } from './session';

/** Actions that change what should be on disk. */
const WRITES: string[] = [loggedIn.type, tokensRefreshed.type];

export const sessionPersistence: Middleware = store => next => action => {
  const result = next(action);
  const type = (action as { type?: string })?.type;

  if (type && WRITES.includes(type)) {
    const { auth } = store.getState() as {
      auth: {
        accessToken: string | null;
        refreshToken: string | null;
        user: Parameters<typeof loggedIn>[0]['user'] | null;
        assignedMppCodes: string[];
      };
    };

    // Written after the reducer, so what lands on disk is the state the app is actually in
    // rather than the payload the action carried.
    if (auth.accessToken && auth.refreshToken && auth.user) {
      saveSession({
        accessToken: auth.accessToken,
        refreshToken: auth.refreshToken,
        user: auth.user,
        assignedMppCodes: auth.assignedMppCodes,
      });
    }
  }

  if (type === loggedOut.type) {
    // Signing out is the only thing that clears it. Every other failure leaves the session
    // in place, so a dropped connection never costs a Mait their login.
    clearSession();

    /**
     * The queue goes with the session, which it never used to.
     *
     * Those jobs are one Mait's captures, signed with their token and their `client_uuid`s.
     * Left behind on a handset that is about to be handed to somebody else, they would drain
     * under whoever signs in next — and until then they sat on the waiting list of a Mait who
     * had no way to be rid of them, because nothing in the app could clear it.
     *
     * Safe here and nowhere else: Settings already refuses to sign out with unsent work until
     * it has been confirmed a second time, and that warning says plainly that these records
     * can only be sent by this Mait on this handset.
     */
    clearQueue();
  }

  return result;
};
