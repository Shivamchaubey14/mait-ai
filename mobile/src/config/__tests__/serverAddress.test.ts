/**
 * A built APK finding its server again after the tunnel's address changes.
 *
 * The rules under test are the ones that keep a whole round of handsets from being pointed at
 * nothing: an address is only taken once it answers, the last good one survives a restart,
 * Expo Go never asks, and a server going away sends one lookup, not one per request.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { apiUrl: 'http://127.0.0.1:8000/api/v1' }, hostUri: null } },
}));

const OLD = 'https://apolonia-unvouchsafed-joy.ngrok-free.dev/api/v1';
const NEW = 'https://diary-flattery-hurray.ngrok-free.dev/api/v1';

type Modules = {
  env: typeof import('../env');
  address: typeof import('../serverAddress');
};

/** Load both modules fresh, as a build carrying `fromBuild` would start. */
function load(fromBuild: string | undefined): Modules {
  if (fromBuild === undefined) {
    delete process.env.EXPO_PUBLIC_API_URL;
  } else {
    process.env.EXPO_PUBLIC_API_URL = fromBuild;
  }
  let modules = {} as Modules;
  jest.isolateModules(() => {
    modules = {
      env: require('../env'),
      address: require('../serverAddress'),
    };
  });
  return modules;
}

function respond(routes: Record<string, { status: number; body?: unknown }>) {
  global.fetch = jest.fn(async (input: string) => {
    const url = String(input);
    const hit = Object.keys(routes).find(prefix => url.startsWith(prefix));
    if (!hit) {
      throw new Error(`offline: ${url}`);
    }
    const { status, body } = routes[hit] as { status: number; body?: unknown };
    return { ok: status < 400, status, json: async () => body } as Response;
  }) as jest.Mock;
}

const CONFIG =
  'https://raw.githubusercontent.com/Shivamchaubey14/mait-ai/develop/mobile/server.json';

afterEach(async () => {
  delete process.env.EXPO_PUBLIC_API_URL;
  await AsyncStorage.clear();
});

describe('finding the server again', () => {
  it('moves to the address in the file once it answers', async () => {
    const { env, address } = load(OLD);
    respond({
      [CONFIG]: { status: 200, body: { api_url: NEW } },
      [`${NEW}/health/`]: { status: 200 },
    });

    expect(await address.discoverServerAddress({ force: true })).toBe(true);
    expect(env.apiBaseUrl()).toBe(NEW);
  });

  it('stays put when the new address does not answer', async () => {
    const { env, address } = load(OLD);
    respond({
      [CONFIG]: { status: 200, body: { api_url: NEW } },
      [`${NEW}/health/`]: { status: 502 },
    });

    expect(await address.discoverServerAddress({ force: true })).toBe(false);
    expect(env.apiBaseUrl()).toBe(OLD);
  });

  it('takes the bare tunnel address as written', async () => {
    const { env, address } = load(OLD);
    respond({
      [CONFIG]: { status: 200, body: { api_url: 'https://diary-flattery-hurray.ngrok-free.dev/' } },
      [`${NEW}/health/`]: { status: 200 },
    });

    await address.discoverServerAddress({ force: true });
    expect(env.apiBaseUrl()).toBe(NEW);
  });

  it('remembers the address across a restart, even with GitHub unreachable', async () => {
    const first = load(OLD);
    respond({
      [CONFIG]: { status: 200, body: { api_url: NEW } },
      [`${NEW}/health/`]: { status: 200 },
    });
    await first.address.discoverServerAddress({ force: true });

    const second = load(OLD);
    respond({});
    await second.address.restoreServerAddress();
    expect(second.env.apiBaseUrl()).toBe(NEW);
  });

  it('never asks in Expo Go, which follows the laptop instead', async () => {
    const { env, address } = load(undefined);
    respond({
      [CONFIG]: { status: 200, body: { api_url: NEW } },
      [`${NEW}/health/`]: { status: 200 },
    });

    expect(await address.discoverServerAddress({ force: true })).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(env.apiBaseUrl()).not.toBe(NEW);
  });

  it('asks once, however many requests fail at the same moment', async () => {
    const { address } = load(OLD);
    respond({ [CONFIG]: { status: 200, body: { api_url: OLD } } });

    await Promise.all([
      address.discoverServerAddress(),
      address.discoverServerAddress(),
      address.discoverServerAddress(),
    ]);
    await address.discoverServerAddress();
    expect((global.fetch as jest.Mock).mock.calls).toHaveLength(1);
  });

  it('refuses an address that is not one', () => {
    const { address } = load(OLD);
    expect(address.normaliseAddress('not a url')).toBeNull();
    expect(address.normaliseAddress('http://127.0.0.1:8000')).toBeNull();
    expect(address.normaliseAddress(42)).toBeNull();
    expect(address.normaliseAddress(`${NEW}/`)).toBe(NEW);
  });
});
