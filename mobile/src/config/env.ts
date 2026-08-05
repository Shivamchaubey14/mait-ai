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

/** The six capture steps (SRS §6.3), used by the progress indicator. */
export const AI_FLOW_STEPS = [
  'selectMpp',
  'selectFarmer',
  'selectAnimal',
  'scanStraw',
  'capturePhoto',
  'collectPayment',
] as const;

export type AIFlowStep = (typeof AI_FLOW_STEPS)[number];
