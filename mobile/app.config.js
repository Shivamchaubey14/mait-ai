/**
 * Build-time configuration, layered over `app.json`.
 *
 * `app.json` stays the source of truth for everything that does not change between builds —
 * icons, permissions, the package name, the EAS project id. This file exists for the one
 * thing that does: where the API lives.
 *
 * **Why the API URL is not just written into `app.json`.** `src/config/env.ts` prefers a
 * configured non-loopback URL over the Expo packager's address, so a real IP in `app.json`
 * would win everywhere — including in Expo Go, where deriving the host from the packager is
 * exactly what lets the app follow the laptop onto a different network without anybody
 * editing a file. Leaving the default at loopback keeps that; a build that needs a real
 * address is handed one through the environment.
 *
 */

const appJson = require('./app.json');

module.exports = () => ({
  ...appJson.expo,
  extra: {
    ...appJson.expo.extra,
    // An APK cannot discover this at runtime; whatever is set at build time is what it will
    // talk to for the life of the binary.
    apiUrl: process.env.EXPO_PUBLIC_API_URL || appJson.expo.extra.apiUrl,
  },
});
