# Screen inventory — for design handover

Every screen the platform needs, with the exact tokens to design against. Hand designs back
against these names and they map straight onto the code.

Source of truth for tokens:
[`mobile/src/theme/tokens.ts`](../mobile/src/theme/tokens.ts) ·
[`admin-web/assets/css/tokens.css`](../admin-web/assets/css/tokens.css)

---

## 1. Typography

| Role | Font | Weight | Size / line-height |
| --- | --- | --- | --- |
| Display — dashboard KPI numbers | **Quicksand** | 700 | 32 / 40 |
| H1 — screen titles | **Quicksand** | 700 | 24 / 32 |
| H2 — section headers | **Quicksand** | 700 | 20 / 28 |
| H3 — card titles, list row titles | **Quicksand** | 600 | 17 / 24 |
| Body — copy, inputs | **Nunito Sans** | 400 | 15 / 22 |
| Body strong — button labels, values | **Nunito Sans** | 600 | 15 / 22 |
| Label — form labels, table headers | **Nunito Sans** | 600 | 13 / 18 |
| Caption — helper text, timestamps | **Nunito Sans** | 400 | 12 / 16 |

Quicksand for headings, Nunito Sans for body — two families only, no third face anywhere.
Numbers, the `+91` prefix and OTP digits use Quicksand 700 so they read as display, not copy.

Body text never goes below **15px** on mobile. The user base is semi-literate and often
outdoors in sunlight.

## 2. Colour

Design against the **role**, not the hex — a role can be re-pointed, forty scattered hex
values cannot.

| Role | Hex | Where it appears |
| --- | --- | --- |
| Primary — Nest Green | `#3BB77E` | Primary actions, active nav, brand mark, CTAs |
| Secondary — Cream Yolk | `#FDC040` | Highlights, badges, promo/notice cards, ratings |
| Ink | `#253D4E` | Headings, body text, dark surfaces (splash), icons |
| Success | `#3BB77E` | Completed AI event, payment success |
| Warning | `#FDC040` | Pending OTP, low straw count, queued draft |
| Error | `#E54D42` | Validation errors, blocked actions, critical alerts |
| Info | `#3E92E5` | Informational banners, links |
| Rating | `#FDC040` | Stars, scores |
| Text Primary | `#253D4E` | Headings, body |
| Text Muted | `#7A8893` | Captions, helper text |
| Border | `#E3E7E9` | Dividers, hairlines, input outlines |
| Surface | `#FFFFFF` | Cards |
| Background | `#F4F5F3` | Screen background |

### Tint & shade scales

| Step | Nest Green | Cream Yolk | Ink |
| --- | --- | --- | --- |
| 50 | `#EAF7F1` | `#FFF8E9` | `#EEF1F3` |
| 100 | `#CDECDE` | `#FEEDC4` | `#D4DBE0` |
| 200 | `#9FDCC0` | `#FEE19E` | `#AEB9C1` |
| 300 | `#71CCA1` | `#FED578` | `#8897A3` |
| 400 | `#52C08D` | `#FDCB5C` | `#5E7180` |
| 500 | **`#3BB77E`** | **`#FDC040`** | `#3D566A` |
| 600 | `#329C6B` | `#E0A52F` | **`#253D4E`** |
| 700 | `#287D56` | `#B98421` | `#1D303D` |
| 800 | `#1E5E41` | `#8C6315` | `#15232D` |
| 900 | `#143E2B` | `#5E420C` | `#0C151B` |

Green 600 is the pressed state, green 700 the darkest text-safe green, green 50/100 the wash
behind icons. Ink 300 `#8897A3` is the disabled foreground; Ink 100 `#D4DBE0` a disabled fill.

**Four rules that constrain the design:**

1. **Nest Green is the single primary.** One green screen-owning action per screen, so "what
   do I tap now" is unmistakable. Green never competes with a second green button.
2. **Cream Yolk is an accent only.** Notices, badges, pending state, dashed-border cards —
   always with Ink text on top. Never a full-width primary button, never light text on yellow,
   never yellow text on a pale surface.
3. **Ink carries all text and every dark surface** — splash, hero headers, nav. Text Muted
   `#7A8893` for captions and helper lines.
4. **Status colour is consistent everywhere.** Green = completed, yellow = pending, red =
   blocked, blue = informational. A completed event is the same green in the app list, the
   admin table and the dashboard chart. Field users learn colour faster than labels.

## 3. Spacing, radius, elevation

4px scale: `4, 8, 12, 16, 24, 32, 40, 48`.

| Token | Value |
| --- | --- |
| Radius small — chips, icon washes | 8–10px |
| Radius medium — inputs, cards, notice blocks | 12px |
| Radius large — hero cards, sheets | 18px |
| Radius xl — phone/screen shell | 30px |
| Card shadow | `0 1px 3px rgba(37,61,78,.10)` |
| Raised shadow | `0 18px 40px rgba(37,61,78,.12)` |

**Minimum touch target: 48×48dp.** Cold, wet or gloved hands, often in sunlight.

## 4. Language

The app **defaults to English** for now, with a Hindi toggle on the login hero. Both
languages are kept complete and parity is enforced by tests.

Devanagari runs taller and often longer than the English equivalent — never size a button to
exactly its English label. Please show both languages for any screen with tight text.

> Worth revisiting before field rollout: SRS §7 asks for Hindi *because* the user base is
> semi-literate and Hindi-speaking, and a Mait who cannot read the default has to find the
> toggle before they can find anything else.

---

# Mobile screens (React Native)

Status: ✅ built · 🟡 partly built · ⬜ not started

## Auth

| # | Screen | Status | Contents |
| --- | --- | --- | --- |
| M1 | **Login — mobile number** | ✅ · designed | Green hero card with the MAIT AI mark, EN/हिं pill, `+91` field, "Send OTP" enabling at ten digits, yellow no-password notice, two help rows, legal line. |
| M2 | **Login — OTP** | ✅ | 6-digit entry, countdown, resend, back. Distinct errors for wrong / expired / out-of-attempts. |
| M3 | **Splash** | 🟡 · designed | Full Nest Green field, white **MAIT AI** brand pill (English only — the product name is never transliterated), one-line English tagline, three capability chips, determinate progress bar, version line. |

## The 6-step AI capture flow

This is the heart of the product (SRS §6.3). A persistent progress indicator spans all six
steps. Camera-first — the gallery picker is deliberately disabled.

| # | Screen | Status | Contents |
| --- | --- | --- | --- |
| M4 | **Step 1 — Select MPP** | ✅ | Searchable list; auto-skips when the Mait covers only one. |
| M5 | **Step 2 — Select farmer** | ✅ | Member search by name/code/mobile. A member with no mobile is shown but **not selectable**, with the reason on the row. Route to non-member capture. |
| M6 | **Step 2b — Add non-member** | ✅ | Name, mobile, address, explicit consent checkbox. |
| M7 | **Step 3 — Select animal** | ⬜ | Cow/Buffalo toggle → breed (config-driven) → optional ear tag. Add-new and pick-existing. |
| M8 | **Step 4 — Scan straw** | ⬜ | Camera barcode scan + manual entry fallback. Must show two distinct rejections: "not in your stock" and "already used". |
| M9 | **Step 5 — Capture photo** | ⬜ | Full-bleed camera, no gallery button. GPS + timestamp overlay. Retake. |
| M10 | **Step 6 — Payment mode** | ⬜ | Online vs Cash. Amount. |
| M11 | **Payment — OTP entry** | ⬜ | Member authorisation OTP. |
| M12 | **Payment — online proof** | ⬜ | UTR field + screenshot capture. |
| M13 | **Payment — COD confirm** | ⬜ | Second confirmation OTP. |
| M14 | **Event complete** | ⬜ | Success state, straw deducted, remaining count, "start another". |

## Supporting

| # | Screen | Status | Contents |
| --- | --- | --- | --- |
| M15 | **Home / dashboard** | ⬜ | Today's count, straws remaining, resume drafts, start new AI. |
| M16 | **My inventory** | ⬜ | Straw balance by breed, consumables, low-stock warning. |
| M17 | **Stock ledger** | ⬜ | Movement history — issued, consumed, returned. |
| M18 | **Request stock (indent)** | ⬜ | Product/breed, quantity, submit. |
| M19 | **Indent status** | ⬜ | Requested → Approved → Issued, with quantities. |
| M20 | **AI event history** | ⬜ | Own past events, filterable, with status chips. |
| M21 | **Event detail / timeline** | ⬜ | Full audit trail of one event. |
| M22 | **Offline queue** | ⬜ | Pending drafts, sync status, conflicts needing resolution. |
| M23 | **Settings** | ⬜ | Language toggle, profile, sign out. |

## Design language (as built on M3 / M1)

Established on the auth screens and carried forward to every mobile screen:

- **Screen shell** — `#F4F5F3` page, white content, 30px shell radius, no device chrome in
  the handover files.
- **Hero card** — a Nest Green 18px-radius card at the top holds the brand pill, the language
  pill, the screen title and a row of translucent capability chips. It gives the green CTA
  below something to sit against.
- **Fields** — 52px minimum, 12px radius, a fixed `+91` block divided by a hairline, Quicksand
  700 digits. Border: `#E3E7E9` at rest, Ink 300 while typing, Nest Green when valid.
- **Primary button** — 52px, 12px radius, Ink 300 on `#E3E7E9` while disabled, Nest Green with
  a right arrow when enabled. It never resizes between states or languages.
- **Notice card** — Cream Yolk 50 fill with a dashed `#FDC040` border and Ink text; used for
  the things a user must read once, not for actions.
- **Info rows** — 30px soft-tint icon wash, Quicksand 700 title, Nunito Sans caption.
- **Brand name** — always "MAIT AI" in Latin script, in both languages.

### Mobile states needed for every screen

Empty · Loading · Error · **Offline** (the app must work through steps 1–6 with no signal).
Please design the offline banner and the "queued, will send" indicator — they are seen daily,
not occasionally.

---

# Admin web portal screens (HTML/CSS/JS + jQuery)

| # | Screen | Status | Contents |
| --- | --- | --- | --- |
| W1 | **Login** | ⬜ | Username + password. Admin accounts only. |
| W2 | **Dashboard** | 🟡 | KPI tiles (today/week/month/lifetime), all-time highs, trend chart, exceptions panel. Structure exists, needs design. |
| W3 | **SAP upload** | ⬜ | Three upload cards (Member / Mait / MPP), drag-drop, **progress bar for a 15-minute import**, history table. |
| W4 | **Upload error report** | ⬜ | Row-level failures with spreadsheet row numbers, downloadable. |
| W5 | **AI events list** | ⬜ | Filter by MPP/district/Mait/date/status, export. |
| W6 | **AI event detail** | ⬜ | Photo, GPS map, straw, payment proof, full timeline. |
| W7 | **Maits list** | ⬜ | Roster, activation status, **which Maits still need a mobile number**. |
| W8 | **Mait activation** | ⬜ | Pick a pending Sahayak, set their mobile, activate. |
| W9 | **MPP list & assignment** | ⬜ | Geo hierarchy, assigned Mait, reassign. |
| W10 | **Members list** | ⬜ | Search across 105k rows, masked PII. |
| W11 | **Users & roles** | ⬜ | Create/deactivate admins and operators. |
| W12 | **Inventory oversight** | ⬜ | Stock by Mait, low-stock exceptions. |
| W13 | **Indents** | ⬜ | Pending/stale indents, Indent Easy sync status. |
| W14 | **Mait leaderboard** | ⬜ | AI count and collections per Mait for a period. |
| W15 | **MPP coverage** | ⬜ | Members served vs. total per MPP. |
| W16 | **Exceptions** | ⬜ | Pending payments, failed OTPs, low stock, stale indents. |
| W17 | **Reports & export** | ⬜ | Query builder, CSV/Excel export. |

Admin layout: 248px sidebar, 60px topbar, 1440px max content width. Charts use Chart.js —
Nest Green and Ink lead, Cream Yolk for a second series, `#E54D42` reserved for alerts so a
red line always means "look here".

---

# What would help most in a handover

Ranked by how much it unblocks:

1. **M7–M14, the rest of the capture flow.** Built in Phase 3–4, so designs landing before
   then get implemented as designed rather than retrofitted. This is also where a
   semi-literate user is most likely to get stuck.
2. **M15 home screen.** The first thing a Mait sees every morning; nothing exists yet.
3. **W3 SAP upload.** The progress state matters — an admin stares at it for 15 minutes and
   needs to believe it is still working.
4. **W2 dashboard.** Management-facing, so it carries the most weight per pixel.
5. **The offline and empty states.** Easy to leave until last and seen constantly in the field.

Deliver in whatever form suits — Figma, images, or PDF. If Figma, please use the role names
above for the colour styles so the mapping to tokens is unambiguous.

## Two things worth knowing before designing

**A 48px-tall row is the floor, not a target.** Field conditions are hostile to precision
tapping.

**Two real data facts shape several screens.** 93% of Maits arrive from SAP with no mobile
number, so W7/W8 need to make that population obvious and workable. And 1.5% of members have
an unusable number, so M5 has to explain a disabled row rather than just greying it out.
