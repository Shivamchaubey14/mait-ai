/**
 * Deployment settings for the portal.
 *
 * There is no build step here on purpose (README.md), so a setting that differs between
 * environments is a value edited in this file rather than baked in by a bundler. Loaded
 * before the page's own script by whichever pages need one; everything in it is optional and
 * every reader must cope with it being blank, because on a fresh checkout it is.
 *
 * Nothing secret belongs here. The file is served to the browser, so anyone who can open the
 * portal can read it — a Maps key is a public identifier, restricted by HTTP referrer in the
 * Google Cloud console, and that referrer restriction is what actually protects it.
 */

/**
 * Google Maps Embed API key, for the pin on the AI event detail screen.
 *
 * Leave it empty and the map card falls back to a plate showing the recorded coordinates —
 * the screen still says where the event happened, it just cannot draw it. Enable "Maps Embed
 * API" on the key and restrict it to the portal's own hostname.
 */
window.MAITAI_MAPS_KEY = '';
