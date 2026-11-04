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

// The second set, for the one glyph Ionicons does not have — a straw's syringe
// (components/glyph.tsx). Same stand-in, for the same reason.
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => {
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
      // Used by the queue and the offline read cache, both of which clear several keys at
      // once — the queue and its event-id map, the cache and everything its index names.
      multiRemove: keys => {
        keys.forEach(key => store.delete(key));
        return Promise.resolve();
      },
      // The queue holds and restores a signed-out Mait's work as one read and one write.
      multiGet: keys =>
        Promise.resolve(keys.map(key => [key, store.has(key) ? store.get(key) : null])),
      multiSet: pairs => {
        pairs.forEach(([key, value]) => store.set(key, String(value)));
        return Promise.resolve();
      },
      getAllKeys: () => Promise.resolve([...store.keys()]),
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
      }),
    ),
  };
  return {
    __esModule: true,
    SaveFormat: { JPEG: 'jpeg' },
    ImageManipulator: { manipulate: jest.fn(() => context) },
  };
});

// The SAP upload screen picks a file and hands a downloaded master to the share sheet. Both
// are native; a test says which file was picked.
jest.mock('expo-document-picker', () => ({
  __esModule: true,
  getDocumentAsync: jest.fn(() => Promise.resolve({ canceled: true, assets: null })),
}));

jest.mock('expo-sharing', () => ({
  __esModule: true,
  isAvailableAsync: jest.fn(() => Promise.resolve(true)),
  shareAsync: jest.fn(() => Promise.resolve()),
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

// The web view carrying the map has no JS implementation under Jest. Rendered as a plain
// view that keeps its testID, so a test can assert the map was reached — what is inside it is
// a document, and `routeMapHtml` is tested directly as one.
jest.mock('react-native-webview', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { __esModule: true, WebView: props => React.createElement(View, props) };
});

// The Lottie player is native; under Jest it is a plain view carrying its props, so a test can
// see that an animation is there without a renderer to play it.
jest.mock('lottie-react-native', () => {
  const React = require('react');
  const { View } = require('react-native');
  const LottieView = props => React.createElement(View, { testID: props.testID });
  return { __esModule: true, default: LottieView };
});

// The offline pack's files. expo-file-system has no JS implementation under Jest; an in-memory
// map keeps the four calls `offlinePack.ts` makes, and a test can reach it to seed or inspect.
jest.mock('@/api/packFiles', () => {
  const files = new Map();
  return {
    __files: files,
    readPackFile: name => Promise.resolve(files.has(name) ? files.get(name) : null),
    writePackFile: (name, text) => {
      files.set(name, text);
      return Promise.resolve();
    },
    removePackFile: name => {
      files.delete(name);
      return Promise.resolve();
    },
    listPackFiles: prefix =>
      Promise.resolve([...files.keys()].filter(name => name.startsWith(prefix))),
  };
});
