/* Test environment shims for native modules that have no JS implementation. */

jest.mock('react-native-mmkv', () => ({
  MMKV: jest.fn().mockImplementation(() => ({
    set: jest.fn(),
    getString: jest.fn(),
    delete: jest.fn(),
  })),
}));

jest.mock('@react-native-community/netinfo', () => ({
  addEventListener: jest.fn(),
  // Tests default to "online". Offline behaviour is opt-in per test so a suite never
  // accidentally exercises the queue when it meant to exercise the request.
  fetch: jest.fn(() => Promise.resolve({ isConnected: true })),
}));
