/**
 * Runtime configuration.
 *
 * The API base URL is overridable over the air (SRS §15) so a pilot build can be pointed at
 * staging without a Play Store release.
 */

export const API_BASE_URL = __DEV__
  ? 'http://10.0.2.2:8000/api/v1' // 10.0.2.2 is the host machine from the Android emulator
  : 'https://api.maitai.internal/api/v1';

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
