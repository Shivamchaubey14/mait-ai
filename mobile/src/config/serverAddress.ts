/**
 * Finding the server again after its address changes.
 *
 * A built APK is handed one API address at build time (`EXPO_PUBLIC_API_URL`) and, until this
 * existed, kept it for the life of the binary. The development server is reached through an
 * ngrok tunnel, and a tunnel's address belongs to the ngrok account: when the account changed
 * on 2026-09-11 every installed APK went on calling an address nobody answers, and the only
 * cure was a new build and a reinstall on every handset.
 *
 * So a standalone build now asks where the server is, from a place that does not move:
 * `mobile/server.json` in the repository, read raw from GitHub. Editing that one line and
 * pushing it is the whole of moving every installed app to a new tunnel.
 *
 * Three rules keep it safe:
 *
 * - **Nothing is believed until it answers.** A new address is used only after its own
 *   `/health/` has said 200, so a typo in the file cannot point a round's worth of handsets at
 *   nothing.
 * - **The last good address is kept on the handset**, so a phone that learned the new address
 *   yesterday starts on it today even with GitHub unreachable.
 * - **It asks rarely**: at launch, and when a request finds the server gone — never more than
 *   once in `MIN_ASK_INTERVAL_MS`.
 *
 * Expo Go and a development build never ask. They follow the packager (`env.ts`), which already
 * finds the laptop on whatever network it is on, and a file in the repository pointing
 * somewhere else would only drag them away from it.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { apiBaseUrl, discoversServer, serverConfigUrl, setApiBaseUrl } from './env';

const KEY = 'maitai.serverAddress.v1';

/** The shortest gap between two lookups. A dead server fails every request; this is not per request. */
export const MIN_ASK_INTERVAL_MS = 30_000;

/** How long either lookup — the file, or a candidate's health — may take before it is abandoned. */
const TIMEOUT_MS = 6_000;

const API_PATH = '/api/v1';

let lastAsked = 0;
let inFlight: Promise<boolean> | null = null;

/**
 * An address as the app uses it, from however it was written in the file.
 *
 * Accepts the tunnel's bare origin (`https://x.ngrok-free.dev`) as readily as the full API
 * path, because the person editing the file will paste whichever they have. Anything that is
 * not http(s), or that points at the handset itself, is refused.
 */
export function normaliseAddress(raw: unknown): string | null {
  if (typeof raw !== 'string') {
    return null;
  }
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^\s/]+/i.test(trimmed)) {
    return null;
  }
  if (/\/\/(127\.0\.0\.1|localhost)(:|\/|$)/i.test(trimmed)) {
    return null;
  }
  return trimmed.endsWith(API_PATH) ? trimmed : `${trimmed}${API_PATH}`;
}

async function fetchWithin(url: string, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { 'ngrok-skip-browser-warning': 'true', 'Cache-Control': 'no-cache' },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function answers(base: string): Promise<boolean> {
  try {
    const response = await fetchWithin(`${base}/health/`, TIMEOUT_MS);
    return response.ok;
  } catch {
    return false;
  }
}

/** Put back the address this handset last found working. Called once, before the first request. */
export async function restoreServerAddress(): Promise<void> {
  if (!discoversServer()) {
    return;
  }
  try {
    const stored = normaliseAddress(await AsyncStorage.getItem(KEY));
    if (stored) {
      setApiBaseUrl(stored);
    }
  } catch {
    // Unreadable storage leaves the build's own address in place, which is where it started.
  }
}

/**
 * Ask the repository where the server is, and move there if it answers.
 *
 * Resolves true only when the address actually changed, so a caller can retry the request
 * that failed. Concurrent callers share one lookup: a server going away fails every request on
 * screen at once, and they should not each go to GitHub.
 */
export function discoverServerAddress({
  force = false,
}: { force?: boolean } = {}): Promise<boolean> {
  if (!discoversServer()) {
    return Promise.resolve(false);
  }
  if (inFlight) {
    return inFlight;
  }
  if (!force && Date.now() - lastAsked < MIN_ASK_INTERVAL_MS) {
    return Promise.resolve(false);
  }
  lastAsked = Date.now();

  inFlight = (async () => {
    try {
      const response = await fetchWithin(`${serverConfigUrl()}?t=${Date.now()}`, TIMEOUT_MS);
      if (!response.ok) {
        return false;
      }
      const body = (await response.json()) as { api_url?: unknown };
      const candidate = normaliseAddress(body?.api_url);
      if (!candidate || candidate === apiBaseUrl()) {
        return false;
      }
      if (!(await answers(candidate))) {
        return false;
      }
      setApiBaseUrl(candidate);
      await AsyncStorage.setItem(KEY, candidate).catch(() => undefined);
      return true;
    } catch {
      // No signal, GitHub unreachable, or a file that is not JSON: stay where we are.
      return false;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** For tests: forget when we last asked. */
export function resetDiscoveryClock(): void {
  lastAsked = 0;
  inFlight = null;
}
