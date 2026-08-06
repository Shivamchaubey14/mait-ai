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

## Capture-flow screen pattern (M4–M14)

Every screen in the six-step flow is built from the same three bands, so a Mait learns the
shape once and it never moves. Screens are specified in
[`SCREEN_INVENTORY.md`](SCREEN_INVENTORY.md); this is how they are put together.

**1 · Green hero.** Full-bleed `--color-primary`, rounded bottom corners. In order:

- a circular translucent back button, and beside it the step label — `Step 3 of 6`, or a
  plain name where the screen is not a numbered step (`Authorisation`, `Proof of payment`,
  `Done`, whose leading glyph is a tick rather than an arrow);
- the six-segment progress bar, filled segments in white, remaining ones translucent;
- the question, as a question, in H1 white: *Which MPP? · Whose animal? · How is she
  paying?* A Mait reads a question and answers it; a noun phrase leaves them guessing what
  the screen wants;
- one line of subtitle explaining the consequence, not the mechanics — "Skipped
  automatically when you cover only one", "A second OTP records that you received it".

**2 · Body**, on white, `--space-5` gutters. Built from four repeating pieces:

- **Selectable row** — a card with a leading rounded swatch, title, one subtitle line, and
  an optional right-hand pill (`Nearest`). Chosen: green border, pale green fill. Blocked:
  greyed with the reason in place of the subtitle and a `Blocked` pill — shown, never
  hidden, so the Mait knows the record exists and why it cannot be used.
- **Field card** — label above the value, the same card shape as a row. Never a bare input
  in the flow.
- **Info tile** — grey card, small label over a large value (`₹ 300`), pale pill on the
  right for its qualifier.
- **Notice** — yellow for something to do, blue for something to know, red for something
  wrong. Leading swatch, title, one line of body.

**3 · Footer.** One full-width primary CTA, always in the same place, labelled with the verb
and a forward arrow (`Continue →`, `Save & continue →`, `Submit proof →`). Grey and inert
until the step is genuinely satisfiable. A secondary route out of the step, when there is
one, sits above it as a green text link (`Add a non-member`), never as a second button.

## Admin portal screen pattern (W2–W17)

The portal is one shell with a page poured into it. Screens are listed in
[`SCREEN_INVENTORY.md`](SCREEN_INVENTORY.md); this is how each is assembled.

**Shell.** Ink sidebar, fixed width, holding the white `MAIT AI / ADMIN` mark and one link
per section, each with a leading dot. The current section is a filled green pill. A count of
things needing a human rides on the Exceptions link itself, so it is visible from every
screen rather than only once someone thinks to look.

**Topbar.** Page title in H1 with a one-line meta beneath it — the row count and the scope
(`31,540 this month`, `2,940 MPPs across 14 districts`). Actions sit right: a neutral
secondary (`Export`) and at most one green primary. Never two greens.

**Body**, from six repeating pieces:

- **Stat tile** — small label, large Quicksand figure, one line of context under it
  (`+9% on yesterday`, `All-time high 32,006`). Four across on a summary screen. The context
  line carries the colour: green for good, red for a number someone must act on.
- **Filter bar** — a search field, then chips that read as their current state
  (`All districts`, `Status: all`, `Aug 2026`). An active filter is a green outline. Filters
  sit directly above the table they govern, never in the topbar.
- **Table** — the portal's main object. First column is the identity in Ink semibold with its
  code beneath in muted type; the last column is a status pill. Rows tint with meaning:
  yellow for waiting, red for blocked. Numbers right-align; codes and IDs use the heading
  face so they read as data.
- **Status pill** — the same vocabulary everywhere, matching the app: `Complete`, `Queued`,
  `Payment failed`, `Needs mobile`, `Blocked`, `Stale`. Colour never carries the meaning
  alone; the word is always there.
- **Notice** — blue explains a rule that is not obvious (`Personal data is masked for
  everyone below Admin`), yellow flags a backlog worth acting on, red states something
  blocked. Full width, above the content it qualifies.
- **Progress bar** — for a proportion that has a target: coverage, leaderboard standing.
  Green when on track, yellow when behind.

**Empty and partial states** are written out, not left blank: `No Mait assigned`,
`Cannot record events`, `Waiting — phone offline`. A blank cell in an admin table reads as a
bug in the portal rather than a fact about the row.

**Charts** — Chart.js themed to the palette. Primary series `--color-primary-dark`, secondary
`--color-success-alt`. Reserve `--color-accent` and `--color-accent-alt` for alerts and
highlighted series so an orange line always means "look here".

## Language

Hindi/English toggle on mobile (SRS §7 Usability). All user-facing strings live in
`mobile/src/i18n/`; none are hardcoded in components. Layouts must tolerate Devanagari, which
runs taller and often longer than the English equivalent — never fix a button's height to
exactly its English label.
