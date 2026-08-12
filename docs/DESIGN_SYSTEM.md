# Design system

Implements SRS §10. Tokens are defined once in
[`admin-web/assets/css/tokens.css`](../admin-web/assets/css/tokens.css) and mirrored for the
mobile app in [`mobile/src/theme/tokens.ts`](../mobile/src/theme/tokens.ts). Changing a colour
means changing those two files, not hunting hex codes across screens.

## Typography

| Use | Font | Weight |
| --- | --- | --- |
| Headings / display — app bar titles, section headers, dashboard KPIs, numbers | **Quicksand** | 600–700 |
| Body / UI — copy, form labels, buttons | **Nunito Sans** | 400–600 |

```css
--font-heading: 'Quicksand', -apple-system, 'Segoe UI', Roboto, sans-serif;
--font-body: 'Nunito Sans', -apple-system, 'Segoe UI', Roboto, sans-serif;
```

Both are rounded, high-legibility faces — deliberate, given the semi-literate field user base.
Two families only; there is no third face.

Numbers take the heading face wherever they are data rather than prose — a table's figures, a
stat tile's value, a code or an identifier. It is what makes a column of quantities read as a
column.

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

Three scales — Nest Green, Cream Yolk, Ink — each running 50 → 900, mapped to functional roles.
**Use the role token, not the hex, and not a scale step.** A role can be re-pointed in one
place; `#3BB77E` scattered across forty files cannot.

### Roles

| Token | Hex | Role |
| --- | --- | --- |
| `--color-primary` | `#3BB77E` green-500 | The one screen-owning action: filled buttons, selected states, progress fill |
| `--color-primary-pressed` | `#329C6B` green-600 | Pressed state of that fill |
| `--color-primary-dark` | `#287D56` green-700 | Green **text** and glyphs on a light surface — never a fill |
| `--color-primary-wash` | `#EAF7F1` green-50 | The tint behind a chosen row, a green card, a success notice |
| `--color-secondary` | `#FDC040` yolk-500 | Attention, waiting, pending. Fill or border only |
| `--color-secondary-pressed` | `#E0A52F` yolk-600 | Yellow glyphs |
| `--color-secondary-wash` | `#FFF8E9` yolk-50 | The tint behind a "something to do" notice |
| `--color-ink` | `#253D4E` ink-600 | All primary text; every dark surface — sidebar, hero, banner |
| `--color-success` | `#3BB77E` | Completed AI, payment verified |
| `--color-warning` | `#FDC040` | Pending OTP, low straw count |
| `--color-error` | `#E54D42` | Validation errors, blocked work, destructive actions |
| `--color-error-pressed` | `#C43A30` | Pressed state of the above |
| `--color-error-wash` | `#FDECEA` | The tint behind a red notice or a blocked row |
| `--color-info` | `#3E92E5` | Informational banners, neutral state, links |
| `--color-info-wash` | `#D8E7FA` | The tint behind a blue notice |
| `--color-text` | `#253D4E` | Primary text on a light background |
| `--color-text-muted` | `#7A8893` | Secondary text, captions, subtitles |
| `--color-text-disabled` | `#8897A3` ink-300 | Unavailable text |
| `--color-border` | `#E3E7E9` | Every hairline |
| `--color-surface` | `#FFFFFF` | Cards, sheets, inputs |
| `--color-background` | `#F4F5F3` | The page behind the cards |
| `--color-disabled-fill` | `#D4DBE0` ink-100 | A disabled button's fill |

### Using the scales

Reach past a role only when none exists for what you need. Each step has a job:

| Step | Job |
| --- | --- |
| **50** | Wash — the tint of a whole card, notice or row |
| **100** | The border of something washed in 50 |
| **200** | A visible border or divider on a tinted surface |
| **300** | The disabled version of the role; a secondary chart series |
| **500** | **The role itself** — the fill everyone recognises |
| **600** | Pressed state of that fill |
| **700** | **Text and glyphs** of that colour on a light surface |
| **800–900** | Deep surfaces, and rare high-contrast text on a wash |

Two rules that catch most mistakes. A **wash is a surface, never a small fill** — a 50-step green
behind a card reads as a tint, and the same green on a 20px chip is invisible. And where a card
carries the wash, the chip on it goes white and the **glyph** carries the colour: tinting the
chip the same colour as the card behind it makes it disappear.

### Contrast

`--color-secondary` (`#FDC040`) is a bright yellow: it fails contrast against white and must
**never** carry text on a light surface. Use it as a fill, a border or a status dot with ink
text on top; for yellow *text*, use `--yolk-800` (`#8C6315`).

`--color-primary` is likewise a fill, not a text colour — green text on white is
`--color-primary-dark`. Every role colour passes WCAG AA at 15px+ against white when used as
described above.

### Status coding — consistent everywhere

| Meaning | Colour | Word |
| --- | --- | --- |
| Success / completed | `--color-success` | `Completed`, `Verified`, `Synced` |
| Pending / needs attention | `--color-warning` | `Pending`, `Queued`, `Waiting` |
| Error / blocked | `--color-error` | `Blocked`, `Failed` |
| Informational | `--color-info` | `Draft`, `Syncing` |

Colour never carries the meaning alone — the word is always there too.

A completed AI event is green in the mobile list, green on the admin table row, and green in
the dashboard chart. No exceptions — field users learn colour faster than labels.

## Spacing, radius, elevation

4px base scale: `--space-1: 4px` through `--space-8: 48px`.

| Token | Value | Use |
| --- | --- | --- |
| `--radius-sm` | 10px | Chips, glyph tiles, inner surfaces |
| `--radius-md` | 12px | Cards, inputs, buttons, menus |
| `--radius-lg` | 18px | Sheets, large surfaces, a hero's bottom corners |
| `--radius-xl` | 30px | Rare — a full-bleed feature surface |
| `--radius-pill` | 999px | Status pills, chips, badges |
| `--shadow-card` | `0 1px 3px rgb(37 61 78 / 10%)` | Resting card |
| `--shadow-raised` | `0 18px 40px rgb(37 61 78 / 12%)` | Menus, dropdowns, active sheets |

Two elevation levels only. Rounded corners in the 10–18px range match the tone of the two
faces. Nothing is square.

## Component rules

**Buttons** — one primary action per screen, `--color-primary` filled. A second green on the
same screen means neither is the answer to "what do I do here". Everything else is the neutral
button; red is reserved for the two actions that are genuinely destructive or closing — signing
out, and rejecting. An action that is destructive but is not what the screen is warning about
takes an outline rather than a fill (`--danger-outline`), so a table of fifteen rows does not
read as fifteen problems. Minimum height 48dp mobile, 38px web.

**Cards** — the default container. White surface, `--radius-md`, `--shadow-card`, `--space-4`
internal padding.

A card that carries a tone carries it as a **wash across the whole card**, with a matching
border and its glyph on a white chip. Not as a stripe down one edge: an edge stripe is a detail
nobody reads as meaning "this is the record you are working on", and against a near-white page
it reads as a stray shadow.

**Forms** — label above the field, always visible (never placeholder-as-label — it disappears
exactly when a hesitant user needs it). Errors appear below in `--color-error` with an icon,
never colour alone.

**The 6-step AI flow** — a persistent progress indicator across the top showing all six steps
with the current one highlighted. Camera-first capture, no gallery picker, per SRS §6.3.

## Capture-flow screen pattern (C1–C12)

Every screen in the six-step flow is built from the same three bands, so a Mait learns the
shape once and it never moves. Screens are specified in
[`SCREEN_INVENTORY.md`](SCREEN_INVENTORY.md); this is how they are put together.

**1 · Ink hero.** A card, not a band: `--color-ink`, rounded on all four corners, inset from
the screen edges so the page's grey shows above and beside it. The six steps then read as one
card being dealt and replaced, and the status bar sits on the page's own colour rather than on
Ink. In order:

- a circular translucent back button, and beside it the step label — `Step 3 of 6`, or a
  plain name where the screen is not a numbered step (`Authorisation`, `Proof of payment`,
  `Done`, whose leading glyph is a tick rather than an arrow);
- the six-segment progress bar, filled segments in white, remaining ones translucent;
- the question, as a question, in H1 white: *Which MPP? · Whose animal? · How is she
  paying?* A Mait reads a question and answers it; a noun phrase leaves them guessing what
  the screen wants;
- one line of subtitle explaining the consequence, not the mechanics — "Skipped
  automatically when you cover only one", "A second OTP records that you received it".

**2 · Body**, on the page grey, `--space-5` gutters. Built from six repeating pieces:

- **Selectable row** — a shadowed white card, title, one subtitle line, and an optional
  right-hand pill (`Nearest`, `Low`). Chosen: green border, pale green fill, and a filled
  green tick at the right. Blocked: greyed with the reason in place of the subtitle and a
  `Blocked` pill — shown, never hidden, so the Mait knows the record exists and why it cannot
  be used. The leading swatch is optional: it carries a glyph, or a short handle for rows that
  are otherwise identical (`C1`, `C2` on two untagged cows), and it is dropped entirely on a
  list whose rows are pure text, where a column of blank chips would be colour that means
  nothing.
- **Segmented control** — a rounded-rectangle track, the chosen half filled green in the same
  shape. **Never a pill:** every other surface in the flow is a rounded rectangle — the cards,
  the button, the hero — and a capsule would be the one shape on the screen that belongs to
  nothing else. The track's radius is the segment's plus its padding, so the filled half sits
  concentric inside it. For a question whose answer narrows everything under it (cow or
  buffalo). It always carries a value, so it reads as a thing already answered rather than a
  thing to decide.
- **Add card** — the same card, dashed and unfilled, ending a list: a place where a record
  could be, rather than another record. Its plus is neutral, never green — the green on a
  picking screen belongs to the row already chosen and to the button that acts on it.
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

**Charts** — themed from the chart tokens, in order: `--chart-1` green, `--chart-2` ink,
`--chart-3` blue, `--chart-4` pale green, `--chart-5` pale ink. `--chart-alert` is yellow and is
reserved for alerts and highlighted series, so a yellow line always means "look here" — which is
also why yellow is never used as an ordinary series colour.

## Language

Hindi/English toggle on mobile (SRS §7 Usability). All user-facing strings live in
`mobile/src/i18n/`; none are hardcoded in components. Layouts must tolerate Devanagari, which
runs taller and often longer than the English equivalent — never fix a button's height to
exactly its English label.
