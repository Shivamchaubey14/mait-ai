/**
 * Whether the server can be reached (`api/reachability`) — not whether a radio is up.
 */

import { radioSaysOffline, serverReachable } from '../reachability';

describe('serverReachable', () => {
  afterEach(() => jest.resetAllMocks());

  it('is yes when the server answers, whatever it says', async () => {
    global.fetch = jest.fn(async () => new Response('', { status: 503 })) as jest.Mock;
    expect(await serverReachable()).toBe(true);
    expect((global.fetch as jest.Mock).mock.calls[0][0]).toMatch(/\/health\/$/);
  });

  it('is no when nothing comes back', async () => {
    global.fetch = jest.fn(() =>
      Promise.reject(new TypeError('Network request failed')),
    ) as jest.Mock;
    expect(await serverReachable()).toBe(false);
  });

  it('is no when the answer takes longer than the cap', async () => {
    global.fetch = jest.fn(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) =>
          init.signal?.addEventListener('abort', () => reject(new Error('aborted'))),
        ),
    ) as jest.Mock;
    expect(await serverReachable(20)).toBe(false);
  });
});

describe('radioSaysOffline', () => {
  it('takes no connection, and Android’s own "no internet", as offline', () => {
    expect(radioSaysOffline({ isConnected: false })).toBe(true);
    expect(radioSaysOffline({ isConnected: true, isInternetReachable: false })).toBe(true);
  });

  it('leaves "connected, not yet known" to the server to answer', () => {
    expect(radioSaysOffline({ isConnected: true, isInternetReachable: null })).toBe(false);
    expect(radioSaysOffline({ isConnected: true, isInternetReachable: true })).toBe(false);
  });
});
