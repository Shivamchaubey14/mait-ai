/**
 * Runtime configuration.
 *
 * The API base URL is answered in three ways, in this order.
 *
 * 1. **`EXPO_PUBLIC_API_URL`**, set per build profile in `eas.json`. This is what a built APK
 *    uses, and it is the only one of the three that works in one: a standalone build has no
 *    packager to ask and `app.json` carries a loopback address for local work.
 * 2. **A non-loopback `extra.apiUrl`** in `app.json`, for a build that is told where to point.
 * 3. **Wherever the Expo packager is being served**, for development. A phone cannot reach
 *    `127.0.0.1` — that address is the phone itself — so a device needs the host machine's LAN
 *    address, and Expo already knows it. Reading it from there means nobody has to update an
 *    IP that changes whenever the laptop joins a different network.
 *
 * The first two are the same variable by two routes: `app.config.js` already copies
 * `EXPO_PUBLIC_API_URL` into `extra.apiUrl` at build time, and Metro inlines it into the bundle
 * as well. Reading it directly costs nothing and means the app is still pointed correctly if
 * that mapping is ever changed or the dynamic config removed — but they cannot disagree,
 * because there is only one value.
 *
 * Getting this wrong is worth guarding against because it is invisible now that the app works
 * offline: a build pointed at itself looks exactly like a handset with no signal — every screen
 * empty on a fresh install, every write queued and never sent.
 *
 * Nothing secret belongs in this file. A mobile bundle is a public binary, and `EXPO_PUBLIC_*`
 * is inlined into it at build time (SRS §15).
 */

import Constants from 'expo-constants';

const API_PORT = 8000;
const API_PATH = '/api/v1';

/** The host running `expo start`, e.g. "192.168.71.160" from "192.168.71.160:8081". */
function packagerHost(): string | null {
  const hostUri = Constants.expoConfig?.hostUri ?? null;
  if (!hostUri) {
    return null;
  }
  return String(hostUri).split(':')[0] || null;
}

/** Whether an address is the handset talking to itself, which is never what anybody meant. */
function isLoopback(url: string): boolean {
  return url.includes('127.0.0.1') || url.includes('localhost');
}

function resolveApiBaseUrl(): string {
  // Inlined at build time by Expo from the profile's `env` block in `eas.json`. Read first
  // because it is the only answer a standalone build has: there is no packager to ask, and
  // `app.json` holds a loopback address so that local development works.
  const fromBuild = (process.env.EXPO_PUBLIC_API_URL ?? '').trim();
  if (fromBuild && !isLoopback(fromBuild)) {
    return fromBuild;
  }

  const configured = Constants.expoConfig?.extra?.apiUrl as string | undefined;

  // A configured non-loopback URL is a real deployment and wins over the packager.
  if (configured && !isLoopback(configured)) {
    return configured;
  }

  const host = packagerHost();
  if (host) {
    return `http://${host}:${API_PORT}${API_PATH}`;
  }

  return configured ?? `http://127.0.0.1:${API_PORT}${API_PATH}`;
}

export const API_BASE_URL = resolveApiBaseUrl();

/**
 * Turn a stored file path into something a handset can fetch.
 *
 * The API returns media as a root-relative path — `/media/animal-photos/...` — because in
 * production the portal and the API share an origin and a relative path is correct there. A
 * phone has no such origin: `/media/...` resolves against nothing, and the image silently
 * never loads. In production `STORAGES` is S3 and the same field comes back absolute, which
 * is why an already-absolute URL is handed straight back.
 */
export function mediaUrl(path: string | null | undefined): string | undefined {
  if (!path) {
    return undefined;
  }
  if (/^https?:\/\//i.test(path)) {
    return path;
  }
  const origin = API_BASE_URL.replace(API_PATH, '');
  return `${origin}${path.startsWith('/') ? '' : '/'}${path}`;
}

/** How long a queued offline event stays replayable. Mirrors the server TTL (ADR 0003). */
export const IDEMPOTENCY_TTL_HOURS = 24;

/**
 * How often the app asks the queue again while something is still waiting.
 *
 * Not the retry schedule — each job carries its own backoff, and a tick with nothing due
 * sends no requests at all. This is only how often the question gets asked, and it exists
 * because the connection changing is not the only way a network becomes usable: a tower with
 * no backhaul, a captive portal and a server answering 502 all leave the handset "connected"
 * and unable to send, and none of them fire a connectivity event when they clear.
 *
 * A minute is short enough that a Mait riding past a village does not miss the window, and
 * long enough to be invisible on a battery. The timer stops entirely once the queue is empty.
 */
export const RETRY_TICK_MS = 60_000;

/** SRS §6.5.1 */
export const OTP_LENGTH = 6;
export const OTP_EXPIRY_SECONDS = 300;
export const OTP_MAX_ATTEMPTS = 3;

/**
 * How long the app stops offering a retry after the attempts run out.
 *
 * Advisory only — the authority is server-side, where the code is dead after three attempts
 * and the endpoint is rate limited. It is a constant so the countdown and the sentence that
 * tells the user how long to wait cannot drift apart.
 */
export const OTP_LOCK_MINUTES = 15;

/**
 * The number the "Call IT Department" link dials when a Mait is locked out.
 *
 * Set it in `app.json` under `extra.itSupportPhone`. Empty means the link is not rendered at
 * all — a call button that dials nothing is worse than no call button, and worse still is one
 * that dials a number nobody answers.
 */
export const IT_SUPPORT_PHONE =
  ((Constants.expoConfig?.extra?.itSupportPhone as string | undefined) ?? '').trim() || null;

/**
 * The six counted capture steps (SRS §6.3), used by the progress indicator.
 *
 * Owner type leads, because it forks everything after it: a member is found in the MPP's
 * roster and pays nothing today, a non-member is typed in from scratch and pays on the spot.
 * Asking it last would mean walking a Mait through five screens built on an assumption.
 *
 * **Six steps, eight screens.** A step is a question, not a screen, and two of these are asked
 * over two screens: the farmer is found and then read back to her own phone, and the animal
 * step can open a sheet to register one. Both halves carry the same number, because the bar
 * measures how far through the work a Mait is rather than how many screens they have touched
 * — and a bar that advanced on a confirmation would promise progress that had not happened.
 *
 * Step 5 is the straw, and it asks only for its **breed**. The number printed on a straw can
 * only be read by lifting the goblet out of the liquid nitrogen, which warms every straw in
 * it: the app was asking a Mait to damage the semen in order to record it.
 *
 * The photo is the sixth and last: it is the act the whole flow exists to evidence. The
 * screens past it — payment, done — are named rather than numbered. `collectPayment` is not
 * in this list because it is Phase 4 and does not exist yet, and counting a screen that never
 * arrives made the bar promise a step that was really the last.
 */
export const AI_FLOW_STEPS = [
  'ownerType',
  'selectMpp',
  'selectFarmer',
  'selectAnimal',
  'straw',
  'proofPhoto',
] as const;

/**
 * When a breed stops reading as "in stock" and starts reading as "about to run out".
 *
 * Per breed, not per flask: a Mait with forty straws has plenty until the only Sahiwal left is
 * the one in their hand, and the farmer in front of them keeps Sahiwal.
 */
export const LOW_STRAWS_PER_BREED = 5;

export type AIFlowStep = (typeof AI_FLOW_STEPS)[number];
