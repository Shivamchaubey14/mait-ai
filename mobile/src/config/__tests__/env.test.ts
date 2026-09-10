/**
 * Where a build decides the API lives (SRS §15).
 *
 * Worth a test of its own because getting it wrong is invisible until somebody is holding the
 * handset. A build pointed at `127.0.0.1` is pointed at the phone itself, and now that the app
 * works offline that failure no longer looks like a failure — every screen is simply empty on a
 * fresh install and every write goes quietly onto the queue, exactly as it would in a village.
 * The APK looks like it is working and reaches nothing, forever.
 *
 * `env.ts` reads its answers at import time, so each case re-imports it inside `isolateModules`
 * with the environment it is about.
 */

const CONFIG: { extra?: Record<string, unknown>; hostUri?: string | null } = {};

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    get expoConfig() {
      return CONFIG;
    },
  },
}));

/** Load `env.ts` fresh, with the build-time variable set to whatever this case is about. */
function apiUrlWith(fromBuild: string | undefined): string {
  let url = '';
  const previous = process.env.EXPO_PUBLIC_API_URL;
  if (fromBuild === undefined) {
    delete process.env.EXPO_PUBLIC_API_URL;
  } else {
    process.env.EXPO_PUBLIC_API_URL = fromBuild;
  }
  jest.isolateModules(() => {
    url = (require('../env') as { API_BASE_URL: string }).API_BASE_URL;
  });
  if (previous === undefined) {
    delete process.env.EXPO_PUBLIC_API_URL;
  } else {
    process.env.EXPO_PUBLIC_API_URL = previous;
  }
  return url;
}

beforeEach(() => {
  CONFIG.extra = { apiUrl: 'http://127.0.0.1:8000/api/v1' };
  CONFIG.hostUri = null;
});

describe('a built APK', () => {
  it('uses the address its build profile was given', () => {
    // `eas.json` sets this per profile and nothing read it, so every preview build fell
    // through to the loopback address in `app.json` and could reach no server at all.
    expect(apiUrlWith('https://apolonia-unvouchsafed-joy.ngrok-free.dev/api/v1')).toBe(
      'https://apolonia-unvouchsafed-joy.ngrok-free.dev/api/v1',
    );
  });

  it('ignores a build address that points at the handset itself', () => {
    // Nobody ever means this. It is the shape of a profile somebody half-filled in, and
    // honouring it would ship a build that quietly talks to nothing.
    CONFIG.extra = { apiUrl: 'https://api.example.test/api/v1' };
    expect(apiUrlWith('http://localhost:8000/api/v1')).toBe('https://api.example.test/api/v1');
  });

  it('falls back to a real address configured in app.json', () => {
    CONFIG.extra = { apiUrl: 'https://api.example.test/api/v1' };
    expect(apiUrlWith(undefined)).toBe('https://api.example.test/api/v1');
  });
});

describe('development', () => {
  it('follows the packager, so a phone reaches the laptop and not itself', () => {
    // The address changes whenever the laptop joins a different network, and Expo already
    // knows it — which is why nobody has to keep a value in a file up to date.
    CONFIG.hostUri = '192.168.71.160:8081';
    expect(apiUrlWith(undefined)).toBe('http://192.168.71.160:8000/api/v1');
  });

  it('lets a build address win over the packager', () => {
    // A preview build opened through the dev packager still talks to the deployment it was
    // built for. Otherwise testing a build would silently test a different server.
    CONFIG.hostUri = '192.168.71.160:8081';
    expect(apiUrlWith('https://api.example.test/api/v1')).toBe('https://api.example.test/api/v1');
  });

  it('has a loopback answer of last resort, for a simulator on the host', () => {
    expect(apiUrlWith(undefined)).toBe('http://127.0.0.1:8000/api/v1');
  });
});
