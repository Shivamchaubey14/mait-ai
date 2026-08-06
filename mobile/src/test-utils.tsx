/**
 * Test helpers.
 *
 * Every screen reads from the Redux store and RTK Query, so rendering one bare throws. This
 * builds a fresh store per test — sharing one would let a login in one test leak into the
 * next and quietly mask an auth bug.
 */

import React from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { render, RenderOptions } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Provider } from 'react-redux';

import { api } from '@api/client';
import authReducer from '@/features/auth/authSlice';

// English is the app's default, so nothing needs forcing here. Tests that exercise Hindi
// switch to it themselves and switch back.
import '@/i18n';

/** A mid-range Android handset: a status bar at the top, gesture bar at the bottom. */
const TEST_SAFE_AREA_METRICS = {
  frame: { x: 0, y: 0, width: 360, height: 780 },
  insets: { top: 24, left: 0, right: 0, bottom: 16 },
};

export function makeStore() {
  return configureStore({
    reducer: { auth: authReducer, [api.reducerPath]: api.reducer },
    middleware: getDefault => getDefault().concat(api.middleware),
    // RTK Query's auto-batching defers notifications to a timer callback. In a test that
    // lands after the assertion has already run, which shows up as an "update not wrapped
    // in act(...)" warning and makes waitFor spin until it times out on a slow runner.
    // Batching is a rendering optimisation, so switching it off changes no behaviour under
    // test — the app keeps it.
    enhancers: getDefault => getDefault({ autoBatch: false }),
  });
}

// RTK Query keeps unused cache entries alive on a timer (60s by default). Those timers
// outlive the test and fire after the environment is torn down, which Jest reports as a
// leaked worker — noise that would hide a real leak. Resetting the API state cancels them.
let activeStore: ReturnType<typeof makeStore> | null = null;

afterEach(() => {
  activeStore?.dispatch(api.util.resetApiState());
  activeStore = null;
});

export function renderWithStore(
  ui: React.ReactElement,
  {
    store = makeStore(),
    ...options
  }: { store?: ReturnType<typeof makeStore> } & RenderOptions = {},
) {
  activeStore = store;

  function Wrapper({ children }: { children: React.ReactNode }): React.JSX.Element {
    return (
      <Provider store={store}>
        {/* Screens read the status-bar and home-indicator insets directly. There is no
            native window to measure under Jest, so the metrics are supplied here — without
            them the hook throws and every screen test fails on render rather than on
            behaviour. */}
        <SafeAreaProvider initialMetrics={TEST_SAFE_AREA_METRICS}>{children}</SafeAreaProvider>
      </Provider>
    );
  }
  return { store, ...render(ui, { wrapper: Wrapper, ...options }) };
}

/**
 * Build a stand-in for a fetch Response.
 *
 * `clone()` is not optional — `fetchBaseQuery` clones every response before reading it, so a
 * mock without it rejects and every request looks like a network failure.
 */
function fakeResponse(body: unknown, status: number, contentType: string): Response {
  const response = {
    ok: status < 400,
    status,
    statusText: String(status),
    headers: new Headers({ 'content-type': contentType }),
    json: async () => body,
    text: async () => JSON.stringify(body),
    clone: () => response,
  };
  return response as unknown as Response;
}

/** A response shaped like the API's RFC 7807 problem details (SRS §9.11). */
export function problemResponse(status: number, type: string, detail = 'error'): Response {
  return fakeResponse(
    { type: `https://api.maitai.in/errors/${type}`, title: 'Error', status, detail },
    status,
    'application/problem+json',
  );
}

export function jsonResponse(body: unknown, status = 200): Response {
  return fakeResponse(body, status, 'application/json');
}
