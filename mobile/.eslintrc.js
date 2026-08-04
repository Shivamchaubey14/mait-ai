module.exports = {
  root: true,
  extends: '@react-native',
  rules: {
    // Every user-facing string goes through i18n — the app ships with a Hindi toggle
    // (SRS §7 Usability), and a hardcoded English label silently defeats it.
    'react-native/no-raw-text': ['error', { skip: ['Trans'] }],
    // `any` erases the contract the backend guarantees. Justify it in a comment or type it.
    '@typescript-eslint/no-explicit-any': 'error',
    'no-console': ['warn', { allow: ['warn', 'error'] }],
  },
  ignorePatterns: ['android/', 'ios/', 'node_modules/', 'coverage/'],
};
