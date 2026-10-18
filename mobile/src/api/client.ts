/**
 * RTK Query base client (SRS §9).
 *
 * All server access goes through this — ESLint forbids a bare `fetch` in a component. That
 * matters more than usual here, because every write needs the same three things and none of
 * them are optional: a bearer token, an idempotency key, and a retry path that is safe when
 * the network drops mid-request.
 */

import { BaseQueryFn, createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import type { FetchArgs, FetchBaseQueryError } from '@reduxjs/toolkit/query';

import { apiBaseUrl } from '@/config/env';
import { discoverServerAddress } from '@/config/serverAddress';
import type { RootState } from '@/store';

import { cacheKeyFor, readCached, writeCached } from './offlineCache';

/** RFC 7807 problem details, the shape every API error takes (SRS §9.11). */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  errors?: Record<string, string[]>;
  request_id?: string;
}

/**
 * Machine-readable error codes the UI branches on.
 *
 * Matched against the tail of `problem.type`, never against `detail` — the message is
 * user-facing prose and is translated, so string-matching it would break the moment the
 * app is switched to Hindi.
 */
export const ErrorCode = {
  INSUFFICIENT_STOCK: 'insufficient-stock',
  STRAW_ALREADY_CONSUMED: 'straw-already-consumed',
  BREED_REQUIRED: 'breed-required',
  INVALID_STATE_TRANSITION: 'invalid-state-transition',
  PAYMENT_NOT_VERIFIED: 'payment-not-verified',
  OTP_INVALID: 'otp-invalid',
  OTP_EXPIRED: 'otp-expired',
  OTP_ATTEMPTS_EXCEEDED: 'otp-attempts-exceeded',
  MPP_NOT_ASSIGNED: 'mpp-not-assigned',
  COLLECTION_CODE_INVALID: 'collection-code-invalid',
  COLLECTION_CODE_LOCKED: 'collection-code-locked',
  STORE_STOCK_SHORT: 'store-stock-short',
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

export function errorCodeOf(error: unknown): string | null {
  const problem = (error as { data?: ProblemDetails })?.data;
  if (!problem?.type) {
    return null;
  }
  const parts = problem.type.split('/');
  return parts[parts.length - 1] ?? null;
}

const queryOptions: Omit<Parameters<typeof fetchBaseQuery>[0] & object, 'baseUrl'> = {
  timeout: 30_000,
  prepareHeaders: (headers, { getState }) => {
    const token = (getState() as RootState).auth?.accessToken;
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    headers.set('Accept', 'application/json');
    // Harmless everywhere, and the difference between working and not when the API is
    // reached through an ngrok tunnel — which is how a handset on mobile data talks to a
    // laptop. Without it ngrok's free tier answers a browser-ish client with an HTML
    // interstitial, which arrives here as a JSON parse failure and reads as a server fault.
    headers.set('ngrok-skip-browser-warning', 'true');
    return headers;
  },
};

/**
 * The fetch, against wherever the server is right now.
 *
 * Rebuilt only when the address has moved (`serverAddress.ts`), so every request after a move
 * goes to the new tunnel without any endpoint or screen knowing there was one.
 */
let queryBase = '';
let queryFor: ReturnType<typeof fetchBaseQuery> | null = null;

const rawBaseQuery: BaseQueryFn<string | FetchArgs, unknown, FetchBaseQueryError> = (
  args,
  api,
  extraOptions,
) => {
  const base = apiBaseUrl();
  if (!queryFor || base !== queryBase) {
    queryBase = base;
    queryFor = fetchBaseQuery({ ...queryOptions, baseUrl: base });
  }
  return queryFor(args, api, extraOptions);
};

/**
 * Whether an answer means the server is not where we are calling.
 *
 * Unreachable, or answered by something that is not this API at all — a dead ngrok address
 * replies with its own HTML page, which arrives here as a parse failure rather than as JSON.
 */
function serverGone(error: FetchBaseQueryError | undefined): boolean {
  return unreachable(error) || error?.status === 'PARSING_ERROR';
}

/**
 * Wraps the base query with a single refresh-and-retry on 401.
 *
 * Access tokens live ~15 minutes (SRS §16), so expiry mid-session is routine rather than
 * exceptional. Retrying exactly once avoids a refresh loop when the refresh token itself
 * has expired — at that point the only correct answer is to send the user back to login.
 */
export const baseQueryWithReauth: BaseQueryFn<
  string | FetchArgs,
  unknown,
  FetchBaseQueryError
> = async (args, api, extraOptions) => {
  let result = await rawBaseQuery(args, api, extraOptions);

  // The server may have moved to a new tunnel. Ask where it is now, and if the answer is a new
  // address that answers, send this request again there — once.
  if (serverGone(result.error) && (await discoverServerAddress())) {
    result = await rawBaseQuery(args, api, extraOptions);
  }

  if (result.error?.status === 401) {
    const state = api.getState() as RootState;
    const refreshToken = state.auth?.refreshToken;

    if (refreshToken) {
      const refresh = await rawBaseQuery(
        { url: '/auth/refresh/', method: 'POST', body: { refresh: refreshToken } },
        api,
        extraOptions,
      );

      if (refresh.data) {
        api.dispatch({ type: 'auth/tokensRefreshed', payload: refresh.data });
        result = await rawBaseQuery(args, api, extraOptions);
      } else {
        api.dispatch({ type: 'auth/loggedOut' });
      }
    } else {
      api.dispatch({ type: 'auth/loggedOut' });
    }
  }

  return result;
};

/**
 * Whether a failure means "the server could not be reached" rather than "the server said no".
 *
 * The distinction decides whether a stored answer may stand in. A refusal is the server's
 * considered reply and must reach the screen that asked — answering a 403 out of the cache
 * would show a Mait a roster the office has just taken off them. Only a request that never
 * got an answer, or that got one no server meant to give, falls back.
 */
function unreachable(error: FetchBaseQueryError | undefined): boolean {
  if (!error) {
    return false;
  }
  if (error.status === 'FETCH_ERROR' || error.status === 'TIMEOUT_ERROR') {
    return true;
  }
  return typeof error.status === 'number' && error.status >= 500;
}

/**
 * How long a cached read waits for the network before it is served from disk instead.
 *
 * The difference between a picker that opens instantly and one a Mait watches spin. A weak
 * signal is not no signal: the request will land, in eight seconds or in twenty, and until it
 * does the old behaviour showed a spinner over a screen whose answer was already on the handset
 * from this morning's round. Past this grace the stored answer is shown at once and the network
 * keeps going in the background to refresh it for next time — stale-while-revalidate (SRS §6.9).
 *
 * Short enough to feel immediate, long enough that a healthy connection still returns the fresh
 * answer rather than the stored one: on good signal the fetch beats the timer and nothing is
 * stale. It only ever applies to a read that has a stored copy to fall back on — a first-ever
 * visit to an MPP has nothing to show and waits for the network as before.
 */
const STALE_REVALIDATE_GRACE_MS = 1_000;

/** A sentinel for "the grace period won the race", distinct from any base-query result. */
const GRACE_ELAPSED = Symbol('grace-elapsed');

/**
 * A promise that resolves to {@link GRACE_ELAPSED} after `ms`, with the timer it can be told to
 * drop.
 *
 * Cancelled when the network wins the race, so a read answered quickly leaves no timer ticking
 * behind it — on a handset a stray timer per read is battery, and under the test runner it is an
 * open handle the suite is right to complain about.
 */
function grace(ms: number): { promise: Promise<typeof GRACE_ELAPSED>; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<typeof GRACE_ELAPSED>(resolve => {
    timer = setTimeout(() => resolve(GRACE_ELAPSED), ms);
  });
  return { promise, cancel: () => clearTimeout(timer) };
}

/**
 * The same base query, with the last good answer behind it (see `offlineCache.ts`).
 *
 * Wrapped rather than rewritten: the token, the silent refresh and the tunnel header all
 * still happen exactly once, in `baseQueryWithReauth`, and this only decides what to do with
 * what comes back. Every endpoint in the app is unchanged and unaware.
 *
 * Two jobs, in order of how often they matter:
 *
 * 1. **Serve a stored read instantly when the network is slow, not only when it is dead.** A
 *    weak signal used to be the worst case — too alive to fall back, too slow to use — and it
 *    is the case a Mait is in all day. So an allowlisted read with a stored copy races the
 *    network against a short grace window: whichever is first wins, and a network that is
 *    merely slow loses to the copy already on disk while it keeps going to refresh it.
 * 2. **Fall back to the stored read when the network is gone.** The original job, unchanged:
 *    an unreachable server is answered from disk where there is a copy, and a refusal — the
 *    server's considered "no" — is passed straight through, never masked by a stale yes.
 *
 * Reads that are not on the allowlist, and every write, pass through untouched.
 */
export const baseQueryWithOfflineReads: BaseQueryFn<
  string | FetchArgs,
  unknown,
  FetchBaseQueryError
> = async (args, api, extraOptions) => {
  const key = cacheKeyFor(args);

  // Keyed by the signed-in user, so a shared handset never serves one Mait's farmers to the
  // next one to sign in. With nobody signed in there is nothing to key on and nothing worth
  // storing.
  const owner = (api.getState() as RootState).auth?.user?.id ?? null;

  // Not a read we keep, or nobody to key it to: the plain query, with none of the below.
  if (!key || owner === null) {
    return baseQueryWithReauth(args, api, extraOptions);
  }

  // Start the network immediately and keep the fresh answer on disk when it lands — whether or
  // not anybody is still waiting on it. Never awaited for its write: a read must not wait on a
  // disk write, and the request resolves to a result object rather than throwing, so this
  // promise is always safe to leave running in the background.
  const networking = baseQueryWithReauth(args, api, extraOptions).then(result => {
    if (!result.error && result.data !== undefined) {
      writeCached(owner, key, result.data);
    }
    return result;
  });

  const fromCache = (stored: { data: unknown; savedAt: number }) => ({
    data: stored.data,
    meta: { fromCache: true, savedAt: stored.savedAt },
  });

  const stored = await readCached(owner, key);

  // Nothing stored yet. Wait for the network as before, and fall back only if it turns out to
  // be unreachable and a copy has appeared since (it has not, but the check is cheap and true).
  if (!stored) {
    const result = await networking;
    if (!result.error && result.data !== undefined) {
      return result;
    }
    if (unreachable(result.error)) {
      const late = await readCached(owner, key);
      if (late) {
        return fromCache(late);
      }
    }
    return result;
  }

  // A stored copy exists: give the network a short head start, then serve the copy if it has
  // not answered. The losing network request keeps running and refreshes the cache above.
  const graced = grace(STALE_REVALIDATE_GRACE_MS);
  const raced = await Promise.race([networking, graced.promise]);
  graced.cancel();
  if (raced === GRACE_ELAPSED) {
    return fromCache(stored);
  }

  // The network beat the grace window. A fresh answer is returned as itself; a server that was
  // unreachable falls back to the copy; a refusal is passed through so the screen that asked
  // hears the server's "no" rather than a stale "yes".
  if (!raced.error && raced.data !== undefined) {
    return raced;
  }
  if (unreachable(raced.error)) {
    return fromCache(stored);
  }
  return raced;
};

export const api = createApi({
  reducerPath: 'api',
  baseQuery: baseQueryWithOfflineReads,
  tagTypes: [
    'Inventory',
    'AIEvent',
    'Indent',
    'Member',
    'MPP',
    'Animal',
    'Payment',
    'Pregnancy',
    'Store',
    'Zonal',
  ],
  // Endpoints are injected per feature slice so this module never becomes a dumping ground.
  endpoints: () => ({}),
});

/**
 * Build the headers for a retryable write (SRS §9.11, ADR 0003).
 *
 * The key is the event's client-generated UUID, created when the draft is first saved on
 * the device — before any network attempt. That ordering is the whole point: a key minted
 * at send time would be regenerated on retry and defeat the deduplication.
 */
export function idempotencyHeaders(clientUuid: string): Record<string, string> {
  // The queued writes go out as plain `fetch` and never pass through `prepareHeaders`, so
  // the tunnel header has to be repeated here or a capture sent through ngrok comes back as
  // an HTML page. See the note in `prepareHeaders` above.
  return { 'Idempotency-Key': clientUuid, 'ngrok-skip-browser-warning': 'true' };
}

/**
 * Mint the identity for one capture, at the moment the Mait starts it.
 *
 * Hermes has no `crypto.randomUUID`, so this builds a v4 by hand. `Math.random` is fine
 * here and only here: the value is an identity, not a secret — it authorises nothing, and
 * every request carrying it is already scoped to the Mait's own token server-side. What it
 * has to be is *stable*, which is why it is generated once at the start of the flow rather
 * than at send time. A key minted per attempt would be new on every retry and defeat the
 * deduplication it exists for.
 */
export function newClientUuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => {
    const random = Math.floor(Math.random() * 16);
    // The "y" nibble carries the RFC 4122 variant, which must be one of 8, 9, a or b.
    const value = char === 'x' ? random : 8 + (random % 4);
    return value.toString(16);
  });
}
