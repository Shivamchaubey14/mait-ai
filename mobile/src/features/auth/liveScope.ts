/**
 * Keeping the app's idea of who a Mait is, and what they may work on, actually current.
 *
 * The scope — `assigned_mpp_codes` — was read once at sign-in and never again. Everything on
 * the handset hangs off it: which collection points the capture flow offers, whose members
 * appear, what Home says under the name. So an admin assigning a new MPP changed nothing on
 * the phone until the Mait signed out and back in, and signing back in needs an OTP over SMS
 * in a village with one bar. `persistence.ts` exists precisely so a Mait never has to do that.
 *
 * The reducer for this was already written — `profileRefreshed` in `authSlice`, wired into
 * the persistence middleware — and nothing in the app had ever dispatched it.
 *
 * ---
 *
 * **Polled rather than pushed**, deliberately. A socket held open on a village 2G link spends
 * most of its life reconnecting, and a push notification would cost the Expo Go workflow and
 * an FCM project. What actually matters to a Mait is that the phone is right *when they look
 * at it*, and the three moments they look are: opening the app, pulling a screen down, and
 * sitting on a screen waiting for the office to do something. This covers all three.
 *
 * **Foreground only.** The interval is cleared the moment the app goes to the background —
 * a handset in a pocket polling an API over a metered village connection is somebody's money.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { maitaiApi } from '@api/endpoints';
import type { CurrentUser } from '@api/types';
import { useAppDispatch, useAppSelector } from '@/store';

import { profileRefreshed } from './authSlice';
import type { AuthUser } from './authSlice';

/**
 * How often to re-read while a Mait is actually looking at the screen.
 *
 * A minute, not a few seconds. The changes this catches — an MPP assigned, an indent
 * approved, stock credited — happen at office pace, and the cost of asking is paid by
 * somebody on a metered connection.
 */
const POLL_MS = 60_000;

/**
 * Everything an admin can change out from under a Mait.
 *
 * The whole tag list rather than a chosen few: the scope decides what every one of these
 * queries is even allowed to return, so a scope that has changed invalidates all of them by
 * definition. Getting this wrong is a screen showing another Mait's collection point.
 */
const ADMIN_OWNED = [
  'Inventory',
  'AIEvent',
  'Indent',
  'Member',
  'MPP',
  'Animal',
  'Payment',
] as const;

/** The shape the store keeps, from the shape the server sends. One copy, used by both callers. */
export function toAuthUser(user: CurrentUser): AuthUser {
  return {
    id: user.id,
    fullName: user.full_name,
    role: user.role,
    mobileNo: user.mobile_no,
    maitId: user.mait_id,
    sahayakVendorCode: user.sahayak_vendor_code,
  };
}

export interface ScopeChange {
  added: string[];
  removed: string[];
}

/** What changed, or null if nothing did. Order-insensitive — the server does not promise one. */
export function diffScope(before: string[], after: string[]): ScopeChange | null {
  const had = new Set(before);
  const has = new Set(after);
  const added = after.filter(code => !had.has(code));
  const removed = before.filter(code => !has.has(code));
  return added.length || removed.length ? { added, removed } : null;
}

export interface LiveScope {
  /**
   * Re-read the profile now. Returns what changed so the caller can say so out loud.
   *
   * Safe to call from anywhere and at any time: with no session it does nothing, and a failed
   * request is not an error — a Mait out of signal keeps the scope they already had, which is
   * the right one until they are told otherwise.
   */
  refresh: () => Promise<ScopeChange | null>;
  /** The last change, held until the caller clears it. What Home shows a notice about. */
  change: ScopeChange | null;
  clear: () => void;
}

export function useLiveScope(): LiveScope {
  const dispatch = useAppDispatch();
  const accessToken = useAppSelector(state => state.auth.accessToken);
  const assigned = useAppSelector(state => state.auth.assignedMppCodes);
  const [change, setChange] = useState<ScopeChange | null>(null);

  // Read through a ref inside the callback so the polling effect does not tear down and
  // restart every time the scope changes — which is the one moment it must not.
  const assignedRef = useRef(assigned);
  assignedRef.current = assigned;

  const refresh = useCallback(async (): Promise<ScopeChange | null> => {
    if (!accessToken) {
      return null;
    }

    try {
      const user = await dispatch(
        // `subscribe: false` matters. Without it every poll registers another cache
        // subscriber that is never released, so the entry can never expire and the
        // subscriber list grows for as long as the app is open — a slow leak that shows up
        // as the app getting busier the longer a Mait works.
        maitaiApi.endpoints.getCurrentUser.initiate(undefined, {
          forceRefetch: true,
          subscribe: false,
        }),
      ).unwrap();

      const next = user.assigned_mpp_codes ?? [];
      const difference = diffScope(assignedRef.current, next);

      dispatch(profileRefreshed({ user: toAuthUser(user), assignedMppCodes: next }));

      // Always, not only when the scope moved. An admin crediting stock or approving an
      // indent changes nothing about the scope and is exactly the kind of thing a Mait is
      // sitting there waiting for.
      dispatch(maitaiApi.util.invalidateTags([...ADMIN_OWNED]));

      if (difference) {
        setChange(difference);
      }
      return difference;
    } catch {
      // No signal, or a token mid-refresh. Keeping the scope already in hand is correct until
      // the server says otherwise, and a Mait who cannot reach the network has nothing to do
      // about it — so this stays silent rather than becoming a second offline warning.
      return null;
    }
  }, [accessToken, dispatch]);

  useEffect(() => {
    if (!accessToken) {
      return;
    }

    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer === null) {
        timer = setInterval(refresh, POLL_MS);
      }
    };
    const stop = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };

    // Coming back to the app is the moment a Mait is most likely to be looking at something
    // stale — the phone has been in a pocket while the office did whatever it did.
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') {
        refresh();
        start();
      } else {
        stop();
      }
    });

    refresh();
    start();

    return () => {
      stop();
      // Optional: on older React Native — and under the test renderer — `addEventListener`
      // returns nothing rather than a subscription, and an unguarded `.remove()` throws
      // inside a cleanup, which React reports as a failure of whatever unmounted.
      subscription?.remove?.();
    };
  }, [accessToken, refresh]);

  const clear = useCallback(() => setChange(null), []);

  /**
   * Memoised, and it has to be.
   *
   * A fresh object on every render makes every `useCallback` that depends on this hook fresh
   * too, and any effect depending on *those* re-runs on every render. The shell's netinfo
   * effect does exactly that — it re-subscribes and drains on each run — so an unstable
   * return here became a render loop that called this refresh continuously and left the
   * scope-change notice flickering on and off.
   */
  return useMemo(() => ({ refresh, change, clear }), [refresh, change, clear]);
}
