# App artwork

Everything here is cut from one file, `../design/logo-source.png` — the logo as it was
supplied: a circular badge drawn on a white square, 1254 × 1254.

It lives in `design/` rather than here on purpose. `assetBundlePatterns` in `app.json` is
`**/*`, and a megabyte of artwork that nothing renders has no business anywhere the bundler
looks.

The badge's geometry inside that square was measured, not guessed, and the numbers matter
because every file below depends on them:

| | |
| --- | --- |
| Centre | `(636, 616)` |
| Radius that contains the whole badge | `546` |

Everything outside that circle is white, so each asset is the same crop with a circular alpha
mask, resized.

| File | Size | Shape | Why |
| --- | --- | --- | --- |
| `icon.png` | 1024², opaque | Badge at 96%, white corners | iOS renders transparency here as black, so it has to be opaque. Taken close to the edge because the platform rounds the corners off itself — padding would show as a ring of dead space. |
| `adaptive-icon.png` | 1024², transparent | Badge at 683px, centred | Android masks this to the middle 72dp of 108dp — two thirds — and each launcher picks its own shape. At exactly that size the badge fills a round mask edge to edge and sits inside a squircle on the white background set in `app.json`. |
| `splash.png` | 1284², transparent | Badge at 560px, centred | Sits on the Ink background `app.json` gives the launch screen, so the app does not flash white before its own splash. The padding is what makes `resizeMode: contain` render it at about half the width of the screen instead of filling it. |
| `favicon.png` | 64² | Badge, full bleed | Web only. |
| `logo-mark.png` | 512², transparent | Badge, full bleed | The one the app itself draws — `BrandLogo` in `src/components/brand.tsx`, on the splash and sign-in heroes. Transparent so it can sit on Ink without a white box around it. |

## Regenerating them

If the logo is ever redrawn, replace `design/logo-source.png` and re-cut the rest rather than editing
the outputs by hand. The centre and radius above will need measuring again — the bounding box
of the non-white pixels is the badge, because the artwork has no other content.

`app.json` carries two colours that go with this artwork and are not derived from it:
`android.adaptiveIcon.backgroundColor` is white so the badge's own white field runs to the mask
edge, and `splash.backgroundColor` is Ink so the launch screen matches the one the app draws a
moment later.
