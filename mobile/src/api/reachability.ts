/**
 * Whether the server can actually be reached — not whether the phone has a network.
 *
 * NetInfo's "connected" means a radio is up. In a village that is often true and useless: two
 * bars on a tower with no backhaul, a shop's Wi-Fi with no internet behind it, a captive
 * portal. The app took "connected" at its word, so it showed itself online, tried requests
 * that could only time out, and told a Mait nothing about why their work was not going.
 *
 * So "online" is asked of the server itself: a small GET of `/health/`, capped short. Only
 * when the radio says connected — with no radio there is nothing to ask — and the answer is
 * what the rest of the app treats as online.
 */

import { apiBaseUrl } from '@/config/env';

/** Long enough for a slow 2G round trip, short enough that a dead link is called quickly. */
export const REACH_CAP_MS = 6_000;

/** How often to ask again while the radio is up but the server is not answering. */
export const REACH_RETRY_MS = 30_000;

/** True when the server answered at all — any status. A 5xx is a reachable, unwell server. */
export async function serverReachable(capMs: number = REACH_CAP_MS): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), capMs);
  try {
    await fetch(`${apiBaseUrl()}/health/`, { method: 'GET', signal: controller.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** The radio's own answer, before asking the server: no connection, or Android saying no internet. */
export function radioSaysOffline(state: {
  isConnected?: boolean | null;
  isInternetReachable?: boolean | null;
}): boolean {
  return !state.isConnected || state.isInternetReachable === false;
}
