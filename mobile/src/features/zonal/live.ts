/**
 * The zonal app's beat — the handset's version of the portal's `live.js`.
 *
 * The portal dashboard re-reads itself every half minute and stops while its tab is hidden, so
 * a figure on it is never more than a beat old and a tab left open overnight costs nothing.
 * The manager's screens do the same, in a phone's terms:
 *
 * - **every 30 seconds while the app is on screen**, through RTK Query's own polling, so a
 *   screen that is not mounted is not polled;
 * - **not at all in the background** — a phone in a pocket has nobody to read it, and a
 *   radio woken twice a minute for nobody is a battery a manager notices by afternoon;
 * - **at once on coming back**, which is the navigator's job (`useRefreshOnForeground`): the
 *   commonest shape of a manager's day is the phone out of a pocket at the next yard, and the
 *   figures should be right the moment it is.
 */

import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { AppStateStatus } from 'react-native';

import { api } from '@/api/client';
import { useAppDispatch } from '@/store';

/** The beat, and the portal's: often enough that a figure is never a minute old. */
export const LIVE_MS = 30_000;

/**
 * Whether the app is on screen right now.
 *
 * Anything but `background` counts: at launch the state can read `unknown` for a moment, and
 * a first screen that waited for `active` before starting its beat would sit on its first
 * answer for half a minute.
 */
export function useForeground(): boolean {
  const [state, setState] = useState<AppStateStatus>(AppState.currentState);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', setState);
    return () => subscription.remove();
  }, []);
  return state !== 'background';
}

/**
 * What every zonal query is asked with: polled while the app is on screen, and fetched fresh
 * each time the screen holding it is opened rather than drawn from a cache a tab-switch old.
 */
export function useLive(): { pollingInterval: number; refetchOnMountOrArgChange: true } {
  const foreground = useForeground();
  return { pollingInterval: foreground ? LIVE_MS : 0, refetchOnMountOrArgChange: true };
}

/**
 * Everything the zonal app holds, marked stale the moment the app comes back to the front.
 *
 * Mounted once, in the navigator. Invalidating the tags refetches whatever is on screen now
 * and leaves the rest to fetch when opened, which is exactly the set somebody can see.
 */
export function useRefreshOnForeground(): void {
  const dispatch = useAppDispatch();
  const last = useRef<AppStateStatus>(AppState.currentState);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', next => {
      if (next === 'active' && last.current === 'background') {
        dispatch(api.util.invalidateTags(['Zonal', 'AIEvent']));
      }
      last.current = next;
    });
    return () => subscription.remove();
  }, [dispatch]);
}
