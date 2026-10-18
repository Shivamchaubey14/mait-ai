# MAIT AI — Go Live Event launch presentation

A single-page, full-screen launch ceremony. The chief guest sees the official **Go Live
Event** banner, presses **CLICK TO LAUNCH MAIT AI**, the stage curtains open outward while
poppers and confetti burst from both corners, and the browser then navigates to the real
MAIT AI login page.

**Final destination (exact, unchanged):**

```
https://mait-ai.shwetdharamilk.com:8001/login.html
```

## Files

```
go-live/
  index.html          launch presentation markup (semantic, accessible, no-JS fallback)
  css/styles.css       layout, banner, curtains, particles, responsive + reduced-motion
  js/main.js           INTRO → LAUNCHING → REDIRECTING state machine, particles, navigation
  assets/
    favicon.png
    fonts/             Quicksand + Nunito Sans (self-hosted, copied from the portal)
  README.md
```

There is no banner or logo **image**: the MAIT AI mark is the portal's own text wordmark,
reproduced in CSS so it can never distort and needs no artwork file. Colours are the
portal's design tokens (`admin-web/assets/css/tokens.css`) — nest green, ink navy, white,
sky blue and a restrained gold.

## Setup

The presentation is static — no backend, no build step, no framework. Serve the folder
over HTTP from any web server (the self-hosted fonts need `http(s)://`, not `file://`).

Serve it from the application host so it is reachable at:

```
https://mait-ai.shwetdharamilk.com:8001/go-live/
```

(the `go-live/` folder sits alongside `login.html` in `admin-web/`). It is fully
self-contained, so it can equally be copied to any other static host.

### Run it locally

```sh
# from admin-web/
python -m http.server 8777
# then open http://127.0.0.1:8777/go-live/
```

For the presentation machine, open the page full-screen (F11) in current Chrome or Edge.

## Testing checklist

1. Banner loads; the MAIT AI wordmark and all event text are readable.
2. Click **CLICK TO LAUNCH MAIT AI** with the mouse → curtains open, poppers + confetti fire.
3. Tab to the button and press **Enter** or **Space** → same sequence (keyboard focus ring visible).
4. Click repeatedly / mash the button → the animation never restarts (locked after first press).
5. Both curtains move outward from the centre to the edges, simultaneously.
6. Confetti and poppers originate from both the left and right corners.
7. After ~3.8s the browser navigates to the exact URL above (port `8001`, `/login.html`).
8. Temporary particles are removed after they finish (inspect `#fx-layer` — it empties).
9. Reduced motion: enable OS "reduce motion", reload → a short, calm launch that still navigates.
10. No-JS: disable JavaScript → event details remain, and a visible **OPEN MAIT AI
    APPLICATION** link navigates to the real login page.
11. Failure path: a labelled **OPEN MAIT AI APPLICATION** button also appears during the
    launch as a manual fallback, and a watchdog guarantees navigation within a few seconds.
12. Check at 1920×1080, 1366×768, a tablet, and a phone (portrait + landscape) — no
    horizontal scroll, button always visible.

## Notes

- Verified: Prettier, `html-validate`, and a static reference cross-check all pass; every
  linked asset resolves 200 when served. Do a final live run-through on the actual
  presentation machine and network before the event.
- The launch never claims the application has opened — navigation is the browser's own,
  and the fallback link is always a real anchor to the exact URL.
