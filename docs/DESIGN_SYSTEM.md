# Design system

Implements SRS §10. Tokens are defined once in
[`admin-web/assets/css/tokens.css`](../admin-web/assets/css/tokens.css) and mirrored for the
mobile app in [`mobile/src/theme/tokens.ts`](../mobile/src/theme/tokens.ts). Changing a colour
means changing those two files, not hunting hex codes across screens.

## Typography

| Use | Font | Weight |
| --- | --- | --- |
| Headings / display — app bar titles, section headers, dashboard KPIs | **Lexend** | 600–700 |
| Body / UI — copy, form labels, buttons | **Quicksand** | 400–600 |

```css
--font-heading: "Lexend", -apple-system, "Segoe UI", Roboto, sans-serif;
--font-body:    "Quicksand", -apple-system, "Segoe UI", Roboto, sans-serif;
```

Both are rounded, high-legibility faces — deliberate, given the semi-literate field user base.

### Scale

| Token | Size / line-height | Use |
| --- | --- | --- |
| `--text-display` | 32 / 40 | Dashboard KPI numbers |
| `--text-h1` | 24 / 32 | Screen titles |
| `--text-h2` | 20 / 28 | Section headers |
| `--text-h3` | 17 / 24 | Card titles |
| `--text-body` | 15 / 22 | Default copy |
| `--text-label` | 13 / 18 | Form labels, table headers |
| `--text-caption` | 12 / 16 | Helper and timestamp text |

On mobile, body text never goes below 15px and touch targets are never smaller than 48×48dp.

## Colour

The palette supplied by the business, mapped to functional roles. **Use the role token, not
the hex.** `--color-success` may be re-pointed later; `#66BB6A` scattered across 40 files
cannot.

| Token | Hex | Role |
| --- | --- | --- |
| `--color-primary` | `#43637E` | Headers, nav bar, primary buttons |
| `--color-primary-dark` | `#325E6A` | App bar, headings, active states |
| `--color-secondary` | `#8FA28A` | Backgrounds, success surfaces |
| `--color-success` | `#66BB6A` | Completed AI, payment success |
| `--color-success-alt` | `#249D8F` | Inventory OK, positive KPI |
| `--color-error` | `#BD4444` | Validation errors, low stock |
| `--color-error-dark` | `#B34A44` | Critical alerts |
| `--color-warning` | `#FFF449` | Pending OTP, low straw count |
| `--color-accent` | `#E98B50` | CTA buttons, highlights |
| `--color-accent-alt` | `#EC5B38` | Badges, tags |
| `--color-highlight` | `#C8A96B` | Featured MPP cards |
| `--color-highlight-alt` | `#BA6A4C` | Chart series |
| `--color-info` | `#78A4CB` | Informational banners, links |
| `--color-text` | `#2C3639` | Primary text on light background |
| `--color-text-muted` | `#524646` | Secondary text, captions |
| `--color-neutral` | `#464858` | Borders, dividers, icons |

### Contrast

`--color-warning` (`#FFF449`) is a bright yellow: it fails contrast against white and must
**never** carry text on a light surface. Use it as a fill or border with `--color-text` on top,
or as a status dot. Every other role colour above passes WCAG AA at 15px+ against white.

### Status coding — consistent everywhere

| Meaning | Colour |
| --- | --- |
| Success / completed | `--color-success` / `--color-success-alt` |
| Pending / needs attention | `--color-warning` |
| Error / blocked | `--color-error` / `--color-error-dark` |
| Informational | `--color-info` |

A completed AI event is green in the mobile list, green on the admin table row, and green in
the dashboard chart. No exceptions — field users learn colour faster than labels.

## Spacing, radius, elevation

4px base scale: `--space-1: 4px` through `--space-8: 48px`.

| Token | Value | Use |
| --- | --- | --- |
| `--radius-sm` | 8px | Inputs, chips, badges |
| `--radius-md` | 12px | Cards, modals |
| `--radius-lg` | 16px | Sheets, large surfaces |
| `--shadow-card` | `0 1px 3px rgba(44,54,57,.12)` | Resting card |
| `--shadow-raised` | `0 4px 12px rgba(44,54,57,.16)` | Menus, active sheets |

Rounded corners in the 8–16px range match the Quicksand/Lexend tone. Nothing is square.

## Component rules

**Buttons** — one primary action per screen. Primary is `--color-primary` filled; the
step-advancing CTA in the AI flow uses `--color-accent` so "what do I tap next" is
unmistakable. Minimum height 48dp mobile, 40px web.

**Cards** — the default container. White surface, `--radius-md`, `--shadow-card`,
`--space-4` internal padding. Status is a left border in the status colour, 4px.

**Forms** — label above the field, always visible (never placeholder-as-label — it disappears
exactly when a hesitant user needs it). Errors appear below in `--color-error` with an icon,
never colour alone.

**The 6-step AI flow** — a persistent progress indicator across the top showing all six steps
with the current one highlighted. Camera-first capture, no gallery picker, per SRS §6.3.

**Charts** — Chart.js themed to the palette. Primary series `--color-primary-dark`, secondary
`--color-success-alt`. Reserve `--color-accent` and `--color-accent-alt` for alerts and
highlighted series so an orange line always means "look here".

## Language

Hindi/English toggle on mobile (SRS §7 Usability). All user-facing strings live in
`mobile/src/i18n/`; none are hardcoded in components. Layouts must tolerate Devanagari, which
runs taller and often longer than the English equivalent — never fix a button's height to
exactly its English label.
