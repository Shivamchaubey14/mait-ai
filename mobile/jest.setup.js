/* Test environment shims for native modules that have no JS implementation. */

// Adds the element matchers (toBeDisabled, toBeVisible, toHaveTextContent...). Without this
// they exist as autocomplete suggestions and fail at runtime with "not a function".
require('@testing-library/react-native/extend-expect');

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

// Known noise: React Native's own Jest setup schedules a timer that can outlive teardown,
// which surfaces as "a worker process has failed to exit gracefully". Every suite passes;
// the RTK Query cache timers that used to compound this are cancelled in test-utils.
// Left unmocked deliberately — switching the whole suite to fake timers to silence a
// warning would make every `waitFor` need manual clock advancement.
