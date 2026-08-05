module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@theme/(.*)$': '<rootDir>/src/theme/$1',
    '^@api/(.*)$': '<rootDir>/src/api/$1',
    // Redux Toolkit's package exports resolve to its TypeScript sources under Jest, which
    // then fail on ESM syntax before any transform runs. Point at the built CJS bundles
    // instead — this is a test-environment concern only; Metro resolves it correctly.
    '^@reduxjs/toolkit/query/react$':
      '<rootDir>/node_modules/@reduxjs/toolkit/dist/query/react/cjs/index.js',
    '^@reduxjs/toolkit/query$': '<rootDir>/node_modules/@reduxjs/toolkit/dist/query/cjs/index.js',
    '^@reduxjs/toolkit$': '<rootDir>/node_modules/@reduxjs/toolkit/dist/cjs/index.js',
    '^react-redux$': '<rootDir>/node_modules/react-redux/dist/cjs/index.js',
  },
  // Extends jest-expo's pattern rather than replacing it. The preset's list covers
  // expo-modules-core and the rest of the Expo runtime; a hand-written replacement drops
  // those and every suite fails to parse before it starts. The additions are the ESM-only
  // packages Redux Toolkit pulls in.
  transformIgnorePatterns: [
    '/node_modules/(?!(.pnpm|react-native|@react-native|@react-native-community|expo|@expo' +
      '|@expo-google-fonts|react-navigation|@react-navigation|@sentry/react-native|native-base' +
      '|@reduxjs|redux|reselect|immer|redux-thunk|i18next|react-i18next))',
    '/node_modules/react-native-reanimated/plugin/',
  ],
  collectCoverageFrom: ['src/**/*.{ts,tsx}', '!src/**/*.d.ts', '!src/test-utils.tsx'],
  // Rendering a React Native tree is slow, and a CI runner is slower still — these suites
  // take ~11s there against ~3s locally. The default 5s timeout fails on the runner for
  // tests that pass everywhere else.
  testTimeout: 20000,
};
