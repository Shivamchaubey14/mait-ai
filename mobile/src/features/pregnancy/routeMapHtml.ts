/**
 * The round as a map, drawn with no API key at all.
 *
 * **Why the app needed a key when "Open in Maps" never did.** Those are two different things.
 * Handing a URL to Maps asks an app that is already installed, already signed in and already
 * paid for to draw a map — nothing of ours is involved. Drawing a map *inside* our own screen
 * uses Google's Maps SDK, which is metered, and the key is how Google knows whose meter to
 * run. There is no way to use that SDK without one, and an empty key does not degrade: the
 * Android SDK fails to initialise and takes the screen down, which is what crashed the app.
 *
 * So this does not use Google. It is Leaflet over OpenStreetMap tiles in a web view — the
 * same tiles behind most of the open mapping on the internet, free to use and requiring no
 * account, no key and no billing profile. Real roads, real village names, real rivers.
 *
 * **What that costs, stated plainly.** OSM's tile servers are donated infrastructure with a
 * usage policy: a handful of tiles for one Mait looking at one round is squarely within it,
 * and attribution is required, which the layer below carries. Leaflet itself is fetched from
 * a CDN, so a first view needs a network — after which the web view's own cache serves it.
 * With no signal the caller falls back to the plot rather than showing an empty frame.
 *
 * The HTML is built here rather than in the component so it can be read and tested as what it
 * is: a document, with one function producing it from the stops.
 */

export interface MapPoint {
  lat: number;
  lng: number;
  /** 0 is the Mait's own position; stops are numbered from 1. */
  index: number;
  label: string;
  late: boolean;
}

/** Guards the numbers going into the document, so nothing can be closed and re-opened. */
function num(value: number): string {
  return Number.isFinite(value) ? String(value) : '0';
}

/** Escapes what goes into a marker's tooltip. A farmer's name is not markup. */
function text(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function routeMapHtml(
  points: MapPoint[],
  colours: {
    primary: string;
    error: string;
    info: string;
    surface: string;
  },
): string {
  const markers = points
    .map(point => {
      const here = point.index === 0;
      const background = here ? colours.info : point.late ? colours.error : colours.primary;
      const size = here ? 16 : 26;
      // The number is the whole point of the pin: it is what the list beside the map is
      // keyed to, and a map of identical dots would need reading twice.
      const inner = here ? '' : String(point.index);
      return `addPin(${num(point.lat)}, ${num(point.lng)}, ${size}, '${background}', '${inner}', '${text(point.label)}');`;
    })
    .join('\n      ');

  const line = points.map(p => `[${num(p.lat)}, ${num(p.lng)}]`).join(',');

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    <style>
      html, body, #map { margin: 0; padding: 0; height: 100%; background: #eef1f3; }
      /* The pin is a plain disc with its number in it — the same shape the list uses. */
      .pin {
        display: flex; align-items: center; justify-content: center;
        border-radius: 50%; color: ${colours.surface};
        font: 600 11px/1 -apple-system, 'Segoe UI', Roboto, sans-serif;
        border: 2px solid ${colours.surface};
        box-shadow: 0 1px 3px rgb(12 21 27 / 35%);
      }
      /* Attribution is a condition of using these tiles, so it is not styled away. */
      .leaflet-control-attribution { font-size: 9px; }
    </style>
  </head>
  <body>
    <div id="map"></div>
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <script>
      // Anything at all going wrong is reported to the app, which then shows the plot rather
      // than a blank frame. A map that silently fails to load is indistinguishable from one
      // that has nothing to show.
      function fail(reason) {
        if (window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage(JSON.stringify({ ok: false, reason: reason }));
        }
      }
      window.onerror = function (message) { fail(String(message)); };

      try {
        var map = L.map('map', { zoomControl: false, attributionControl: true });
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 18,
          attribution: '&copy; OpenStreetMap',
        }).addTo(map);

        var path = [${line}];

        function addPin(lat, lng, size, background, inner, label) {
          var icon = L.divIcon({
            className: '',
            iconSize: [size, size],
            iconAnchor: [size / 2, size / 2],
            html: '<div class="pin" style="width:' + size + 'px;height:' + size + 'px;background:' + background + '">' + inner + '</div>',
          });
          L.marker([lat, lng], { icon: icon }).addTo(map).bindPopup(label);
        }

        // The order, drawn. Without it the stops are pins and not a route.
        if (path.length > 1) {
          L.polyline(path, { color: '${colours.primary}', weight: 4, opacity: 0.9 }).addTo(map);
        }

        ${markers}

        if (path.length > 1) {
          map.fitBounds(path, { padding: [28, 28] });
        } else if (path.length === 1) {
          map.setView(path[0], 14);
        } else {
          fail('no points');
        }

        // Said only once the tiles are actually on screen, so a dark screen in a village with
        // no signal is never reported as a working map.
        map.whenReady(function () {
          if (window.ReactNativeWebView) {
            window.ReactNativeWebView.postMessage(JSON.stringify({ ok: true }));
          }
        });
      } catch (error) {
        fail(String(error));
      }
    </script>
  </body>
</html>`;
}
