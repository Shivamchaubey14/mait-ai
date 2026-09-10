/**
 * Build-time configuration, layered over `app.json`.
 *
 * `app.json` stays the source of truth for everything that does not change between builds —
 * icons, permissions, the package name, the EAS project id. This file exists for the two
 * things that do: where the API lives, and whether the build is allowed to talk to it over
 * plain HTTP.
 *
 * **Why the API URL is not just written into `app.json`.** `src/config/env.ts` prefers a
 * configured non-loopback URL over the Expo packager's address, so a real IP in `app.json`
 * would win everywhere — including in Expo Go, where deriving the host from the packager is
 * exactly what lets the app follow the laptop onto a different network without anybody
 * editing a file. Leaving the default at loopback keeps that; a build that needs a real
 * address is handed one through the environment.
 *
 * Everything it sets is merged into what `app.json` already declares rather than added
 * alongside it — see `buildProperties` below for why that distinction costs real megabytes.
 *
 * **Why cleartext is a switch rather than a setting.** Android has blocked plain HTTP by
 * default since API 28. Expo Go allows it, which is why the app works over the QR code and
 * then fails in a release APK with nothing but "Something went wrong" — the request never
 * leaves the handset. A LAN build pointed at `http://192.168.x.x:8000` therefore has to opt
 * in. Production must not: it is served over HTTPS, and shipping a binary that will happily
 * talk plaintext to anything is how a session token ends up readable on a shared village
 * Wi-Fi. So the plugin is added only when the profile asks for it.
 */

const appJson = require('./app.json');

/** Set by the `preview` profile in `eas.json`. Never set for production. */
const allowCleartext = process.env.EXPO_ALLOW_CLEARTEXT === 'true';

/**
 * Fold the cleartext switch into the `expo-build-properties` entry `app.json` already carries.
 *
 * Merged rather than appended, which it used to be. Listing one config plugin twice runs it
 * twice over the same gradle files, and the second pass writes what it was given and nothing
 * else — so a build asking for cleartext would silently lose the architecture and minification
 * settings that make the APK a third of its size. One entry, one pass, both facts.
 */
function buildProperties(plugins) {
  return plugins.map(plugin => {
    if (!Array.isArray(plugin) || plugin[0] !== 'expo-build-properties') {
      return plugin;
    }
    const [name, props = {}] = plugin;
    return [name, { ...props, android: { ...props.android, usesCleartextTraffic: true } }];
  });
}

module.exports = () => ({
  ...appJson.expo,
  plugins: allowCleartext ? buildProperties(appJson.expo.plugins) : appJson.expo.plugins,
  extra: {
    ...appJson.expo.extra,
    // An APK cannot discover this at runtime; whatever is set at build time is what it will
    // talk to for the life of the binary.
    apiUrl: process.env.EXPO_PUBLIC_API_URL || appJson.expo.extra.apiUrl,
  },
});
