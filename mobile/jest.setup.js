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
