/**
 * Babel configuration.
 *
 * The module-resolver aliases must mirror the `paths` in tsconfig.json. TypeScript resolves
 * `@/…` at compile time, but Metro and Jest resolve at runtime and know nothing about
 * tsconfig — without this the app typechecks cleanly and then fails to find its own modules.
 */

module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      [
        'module-resolver',
        {
          root: ['./'],
          extensions: ['.ios.js', '.android.js', '.js', '.jsx', '.ts', '.tsx', '.json'],
          alias: {
            '@': './src',
            '@theme': './src/theme',
            '@api': './src/api',
          },
        },
      ],
    ],
  };
};
