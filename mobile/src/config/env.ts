/**
 * Runtime configuration.
 *
 * The API base URL is derived from wherever the Expo packager is being served, not
 * hardcoded. A phone cannot reach `127.0.0.1` — that address is the phone itself — so a
 * device build needs the host machine's LAN address. Expo already knows that address, and
 * reading it from there means nobody has to remember to update an IP that changes whenever
 * the laptop joins a different network.
 *
 * A configured non-loopback URL in `app.json` wins, so a staging or production build points
 * where it is told (SRS §15).
 *
 * Nothing secret belongs in this file. A mobile bundle is a public binary.
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

function resolveApiBaseUrl(): string {
  const configured = Constants.expoConfig?.extra?.apiUrl as string | undefined;

  // A configured non-loopback URL is a real deployment and wins outright.
  if (configured && !configured.includes('127.0.0.1') && !configured.includes('localhost')) {
    return configured;
  }

  const host = packagerHost();
  if (host) {
    return `http://${host}:${API_PORT}${API_PATH}`;
  }

  return configured ?? `http://127.0.0.1:${API_PORT}${API_PATH}`;
}

export const API_BASE_URL = resolveApiBaseUrl();

/** How long a queued offline event stays replayable. Mirrors the server TTL (ADR 0003). */
export const IDEMPOTENCY_TTL_HOURS = 24;

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
 * The six are the questions with an answer to choose. The proof photo comes after them and is
 * shown as a named screen rather than a seventh number — it is not something a Mait picks, it
 * is something they do, and the screens past it (payment, done) are named for the same reason.
 *
 * `collectPayment` is not in this list. It is Phase 4 and does not exist yet, and counting a
 * screen that never arrives made the bar promise a step that was really the last.
 */
export const AI_FLOW_STEPS = [
  'ownerType',
  'selectMpp',
  'selectFarmer',
  'selectAnimal',
  'selectBreed',
  'scanStraw',
] as const;

/**
 * When a breed stops reading as "in stock" and starts reading as "about to run out".
 *
 * Per breed, not per flask: a Mait with forty straws has plenty until the only Sahiwal left is
 * the one in their hand, and the farmer in front of them keeps Sahiwal.
 */
export const LOW_STRAWS_PER_BREED = 5;

/**
 * What a non-member pays on the spot, in rupees.
 *
 * Set it in `app.json` under `extra.nonMemberFee`. Null means the fork says a payment is
 * collected without naming a figure — quoting a price the system cannot charge is worse than
 * saying "you collect payment today", because the farmer hears the number as final.
 */
export const NON_MEMBER_FEE =
  (Constants.expoConfig?.extra?.nonMemberFee as number | undefined) ?? null;

export type AIFlowStep = (typeof AI_FLOW_STEPS)[number];
