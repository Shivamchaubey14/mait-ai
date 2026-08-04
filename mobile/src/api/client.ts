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

import { API_BASE_URL } from '@/config/env';
import type { RootState } from '@/store';

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
  INVALID_STATE_TRANSITION: 'invalid-state-transition',
  PAYMENT_NOT_VERIFIED: 'payment-not-verified',
  OTP_INVALID: 'otp-invalid',
  OTP_EXPIRED: 'otp-expired',
  OTP_ATTEMPTS_EXCEEDED: 'otp-attempts-exceeded',
  MPP_NOT_ASSIGNED: 'mpp-not-assigned',
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

const rawBaseQuery = fetchBaseQuery({
  baseUrl: API_BASE_URL,
  timeout: 30_000,
  prepareHeaders: (headers, { getState }) => {
    const token = (getState() as RootState).auth?.accessToken;
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    headers.set('Accept', 'application/json');
    return headers;
  },
});

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

export const api = createApi({
  reducerPath: 'api',
  baseQuery: baseQueryWithReauth,
  tagTypes: ['Inventory', 'AIEvent', 'Indent', 'Member', 'MPP', 'Animal', 'Payment'],
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
  return { 'Idempotency-Key': clientUuid };
}
