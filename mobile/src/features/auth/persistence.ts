/**
 * Mirrors the auth slice into secure storage.
 *
 * Middleware rather than a call at each site: tokens change in three places — signing in, the
 * silent refresh on a 401, and signing out — and the one that gets forgotten is the refresh,
 * which is also the one that matters most. It fires every fifteen minutes, and a stored token
 * that stops being updated is a Mait signed out overnight for no reason they can see.
 */

import type { Middleware } from '@reduxjs/toolkit';

import { clearCache } from '@api/offlineCache';
import { clearPack } from '@api/offlinePack';
import { clearQueue, holdQueue, restoreHeldQueue } from '@api/queue';

import { loggedIn, loggedOut, profileRefreshed, tokensRefreshed } from './authSlice';
import { clearSession, saveSession } from './session';

/** Actions that change what should be on disk. */
const WRITES: string[] = [loggedIn.type, tokensRefreshed.type, profileRefreshed.type];

export const sessionPersistence: Middleware = store => next => action => {
  // Read before the reducer runs: a sign-out empties the session, and the held queue has to
  // be filed under whoever it belonged to.
  const owner = (store.getState() as { auth?: { user?: { id?: number } | null } }).auth?.user?.id;
  const result = next(action);
  const type = (action as { type?: string })?.type;

  if (type === loggedIn.type) {
    // Whatever the server's last sign-out held for this Mait goes back in the queue, and the
    // next drain sends it.
    const id = (store.getState() as { auth: { user: { id: number } | null } }).auth.user?.id;
    if (id !== undefined) {
      restoreHeldQueue(id);
    }
  }

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

    const deliberate = !!(action as { payload?: { deliberate?: boolean } }).payload?.deliberate;
    if (!deliberate) {
      /**
       * The server ended the session, not the Mait. Their unsent work is held under their id
       * rather than cleared (`holdQueue`), and the stored rosters stay — they are keyed by
       * owner, so nobody else can be answered with them, and the same Mait signing back in
       * in a village with no signal still has a round to work.
       */
      if (owner !== undefined) {
        holdQueue(owner);
      }
      return result;
    }

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

    /**
     * And the farmers, animals and stock stored to make the round work without a signal.
     *
     * Same reason as the queue, one step further: those rosters are the members and
     * non-members at this Mait's own collection points, read under this Mait's token. A
     * handset passed to somebody else must not still be able to answer with them, and the
     * cache is a fallback for a read the next signed-in Mait would not be allowed to make.
     */
    clearCache();

    // And the whole working set the offline pack keeps — every farmer at every MPP they cover.
    if (owner !== undefined) {
      clearPack(owner);
    }
  }

  return result;
};
