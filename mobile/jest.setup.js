/* Test environment shims for native modules that have no JS implementation. */

// The element matchers (toBeDisabled, toBeVisible, ...) are built into React Native
// Testing Library from v12.4 onward; the separate extend-expect entry was removed in v13
// and requiring it now fails module resolution.

// The icon set loads its font asynchronously and calls setState when it lands, after the
// assertion has run — an "update not wrapped in act(...)" warning per icon on screen.
// Rendering the glyph name as text keeps the tree searchable without the async work.
jest.mock('@expo/vector-icons/Ionicons', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return ({ name, ...props }) => React.createElement(Text, props, name);
});

// AsyncStorage is a native module with no JS implementation under Jest. This in-memory stand
// -in keeps the semantics the offline queue actually depends on: values come back as the
// strings they went in as, and a missing key resolves to null rather than throwing.
jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map();
  return {
    __esModule: true,
    default: {
      getItem: key => Promise.resolve(store.has(key) ? store.get(key) : null),
      setItem: (key, value) => {
        store.set(key, String(value));
        return Promise.resolve();
      },
      removeItem: key => {
        store.delete(key);
        return Promise.resolve();
      },
      clear: () => {
        store.clear();
        return Promise.resolve();
      },
    },
  };
});

// The Keystore has no JS implementation under Jest. An in-memory stand-in keeps the one
// behaviour the session code depends on: a missing key resolves to null rather than throwing.
jest.mock('expo-secure-store', () => {
  const store = new Map();
  return {
    setItemAsync: jest.fn((key, value) => {
      store.set(key, String(value));
      return Promise.resolve();
    }),
    getItemAsync: jest.fn(key => Promise.resolve(store.has(key) ? store.get(key) : null)),
    deleteItemAsync: jest.fn(key => {
      store.delete(key);
      return Promise.resolve();
    }),
  };
});

// The resize every captured photograph goes through (FlowCamera). Native, so it has to be
// stubbed — and stubbed as a pass-through that returns a *different* uri, so a test can tell
// the resized file from the one the camera handed back.
jest.mock('expo-image-manipulator', () => {
  const context = {
    resize: jest.fn(() => context),
    renderAsync: jest.fn(() =>
      Promise.resolve({
        saveAsync: jest.fn(() => Promise.resolve({ uri: 'file:///resized.jpg' })),
      })
    ),
  };
  return {
    __esModule: true,
    SaveFormat: { JPEG: 'jpeg' },
    ImageManipulator: { manipulate: jest.fn(() => context) },
  };
});

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
