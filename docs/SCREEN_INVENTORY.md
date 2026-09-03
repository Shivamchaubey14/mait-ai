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

**Buttons are rounded rectangles — 12px radius, 56dp tall, full width, no border, no shadow.**
Every primary action in the app wears that one shape: `Send code`, `Sign in`, `Start new AI`,
`Request stock`, `Continue`, `Try again`. Pills (`radius.pill`) are for things that carry a
word rather than a tap — status chips, counts, the `Low` badge, the language toggle, progress
tracks. A pill-shaped button and a pill-shaped label are the same object to someone who has
used the app twice.

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

**The bottom bar carries destinations only** — Home, Inventory, AI events, Profile — flat and
full width against the bottom edge, the selected one a filled glyph and a green label. The
unsent count badges *AI events*, which is where those records are. Each screen's own action
sits at the foot of that screen's content instead of floating in the bar: a control that
changes its job depending on the open tab, while living in the furniture that never changes,
is the one thing on screen that cannot be learned once.

## Auth

| # | Screen | Status | Contents |
| --- | --- | --- | --- |
| M1 | **Login — mobile number** | ✅ · designed | Ink hero with the MAIT AI wordmark and an English / हिन्दी pill, the heading "What is your mobile number?", a `+91` field with a filled prefix block, one yellow no-password notice, "Send code" pinned to the bottom and enabling at ten digits. |
| M2 | **Login — OTP** | ✅ · designed | Ink hero carrying the number with a round back button beside it, "Enter the code we sent". Six cells over one hidden input, a `Resend in 0:24` countdown opposite "Send again", a blue card saying this is the one step that needs a signal, "Sign in" pinned to the bottom. Three refusals replace the blue card when they fire, each shaped like the action it wants next: **wrong** — red cell outlines and an inline line under them, corrected in place; **expired** — a yellow card and the button becomes "Send a new code"; **out of attempts** — a red card, a "Call IT Department" link, and a button that holds `Locked · 14:52` until the countdown runs out and then becomes "Send a new code" (never back to "Sign in": the code being typed died long before the lock lifted). The minutes in that copy are interpolated from `OTP_EXPIRY_SECONDS` and `OTP_LOCK_MINUTES`, never written into the sentence. |
| M3 | **Splash** | ✅ · designed | Full Ink field, bare white **MAIT AI** wordmark (English only — the product name is never transliterated), one-line tagline "Record an insemination in six steps", determinate progress bar with a green fill, `v{version}`. One centred stack, nothing else. The capability chips are gone from here and from M1 — the app demonstrates all three within a minute of being used. |

## The 6-step AI capture flow

This is the heart of the product (SRS §6.3). A persistent progress indicator spans all six
steps. Camera-first — the gallery picker is deliberately disabled.

**Every step is the same three bands: a fixed Ink hero, a scrolling body, a fixed footer.**
The hero carries the step number, the progress and the question, and it stays put while the
body moves under it — a Mait scrolling a long roster should never lose sight of what they are
choosing. Both bands are opaque, so the list passes behind them rather than through them, and
the CTA never has to be scrolled back to. Steps that read a list off the server carry
pull-to-refresh.

The six counted steps are **owner type → MPP → farmer → animal → straw → photo**.

**Six steps, eight screens.** A step is a question, not a screen, and two of them are asked
over two: the farmer is found (C3) and then read back to her own phone (C4), and the animal
step (C6) can open a sheet to register one. Both halves carry the same number, because the bar
measures how far through the work a Mait is rather than how many screens they have touched —
and a bar that advanced on a confirmation would promise progress that had not happened.

**There is no straw-number screen.** The number printed on a straw can only be read by lifting
the goblet clear of the liquid nitrogen, which warms every straw in it — cumulatively and
invisibly, so the cost is not the Mait's time but the viability of the semen they are about to
use and of everything beside it. The app was asking a Mait to damage the semen in order to
record it. Step 5 asks the **breed** and the platform holds one straw of it from their stock,
so the gate becomes a count rather than an identity: ten straws of a breed still complete
exactly ten inseminations, and the eleventh is still refused. The API still accepts a number
where one is genuinely known — a depot scan, an admin correction — and traceability survives
wherever stock was issued numbered, because the row the platform picks carries its own number.

The photo is the sixth and last: it is the act the whole flow exists to evidence. The screens
past it — payment, done — are named rather than numbered. Payment is Phase 4 and does not
exist yet; counting a screen that never arrives made the indicator promise a step that was
really the last. Restore `collectPayment` to `AI_FLOW_STEPS` when payments land — the bar
reads that list's length, so nothing else moves.

| # | Screen | Status | Contents |
| --- | --- | --- | --- |
| C1 | **Step 1 — Owner type** | ✅ · designed | *Is she a member?* Two option cards — Member "Sells milk to the cooperative", Non-member "You collect ₹ n today" — defaulting to Member, with a note that everything after depends on the answer. The only step that keeps the tab bar: nothing is committed yet, so leaving costs a tap rather than a record. The fee is named only when `extra.nonMemberFee` is configured. |
| M4 | **Step 2 — Select MPP** | ✅ · designed | *Which collection point?* Search by name or code, then rows carrying a two-letter initials tile, `MPP0004120 · 412 members`, and a `Last used` pill on wherever the previous event was recorded. Tap selects, Continue commits. Auto-skips when the Mait covers only one. **Not "Nearest"** — the MPP master has no coordinates, so no row can honestly claim distance; that pill needs lat/long on the master plus a location read. |
| C3 | **Step 3 — Which member** | ✅ · designed | *Which member?* A pinned search box over the MPP's roster — by code, name or mobile. Rows carry a round initials avatar in pale green, the name, and `MEM00000412 · 98765 43210`, the mobile grouped the way it is read back to her. A member with no mobile is shown but **not selectable**: greyed avatar, the reason in red where the code would be, a `Blocked` pill, and one blue line under the list saying where the fix is — *No mobile, no record — she must add it at the collection point.* The way out is a green text link, **She is not a member**, never a card in the list. Reached only when C1 said Member. |
| C3b | **Step 3 — Which farmer (non-member)** | ✅ · built | The other roster, reached when step 1 said non-member and the collection point is chosen. It did not exist: the flow went from the MPP straight into the registration form, which assumed every non-member is a new one. She usually is not — a farmer without membership is served again the next season — so the second visit registered her a second time. Survivable while duplicates were untidy; **not survivable once one Aadhaar became one farmer**, because the form now refuses her card and a Mait with no route to the existing record cannot serve the woman in front of them. Same shape as C3: pinned search, round initials avatars, one tap to choose. The row carries the household **with the relation spelled out** and her number, because the same names repeat in a village, and a pill saying *Never served* or *3 AI* — a farmer nobody has inseminated yet is the ordinary state of a registration whose capture never finished, and the usual reason a Mait is here. The way out is the dashed **Register a new farmer** card at the end of the list, not a footer link: at an MPP where nobody is registered yet the list is empty, and a footer link is the one thing a Mait will not find there. |
| C4 | **Step 3, second half — Is this her?** | ✅ · designed | *Is this her?* — *A wrong code here puts the record on another woman's animal.* One card, read back before the flow acts: a round initials avatar, her name, the code that was typed in green, then **MPP · Mobile · Father/husband · Animals** in a two-by-two grid. **Then read back to her phone.** The button is one of three things in turn — *Verify her number*, *Check the code*, *Yes, continue* — and the flow cannot pass until she has answered on the number her record carries. Both kinds of farmer come through here: a member against the number SAP holds, a non-member against the one the Mait just typed, which is the number her receipt will go to. A farmer with no mobile cannot be verified at all, and the screen says so instead of failing later. Her village is deliberately not among them — it is not on the member master, and the collection point is what the record is keyed to and what catches the commonest mis-tap, the right name at the wrong MPP. Under it a green statement, *Nothing to collect — ₹ n comes out of her milk payment*, then **No — search again** over **Yes, continue**. It re-uses step 3's number and draws no second progress bar: this is the same question's second half, and the height buys the card its place on one unscrolled screen. |
| M6 | **Step 3b — Add non-member** | ✅ · designed | *Who is she?* Labelled boxes, each with a tinted icon — her name, father/husband name, mobile (`10 digits`), village, **Aadhaar (mandatory, 12 digits)** — over a consent checkbox naming the brand in the sentence. Reached straight from the MPP step when C1 said Non-member. |

**The Aadhaar check is a fraud control, not a form field.** This is the one screen in the
product that ends with a Mait asking a farmer for cash, and a member recorded as a non-member
is a farmer paying twice for a service her milk payment already covered — she has no reason to
query it, she was asked and she paid. So the server matches the Aadhaar against the membership
roll before creating anything, and names the member it found: *"Radha Singh is already a member
at Barsana MPP (M-9001). Record this as a member — she pays nothing today."*

The match runs on `aadhar_hash`, a keyed HMAC-SHA256 kept alongside the encrypted number on
both `member` and `non_member`. Fernet ciphertext differs per row and cannot be indexed or
matched, and a *plain* hash of a twelve-digit number is brute-forced in minutes — so the key is
derived from `FIELD_ENCRYPTION_KEY` with a domain label, giving a column that is searchable to
the application and useless to anyone holding a copy of the database. Migration `0006`
backfills the roll; members whose SAP row carried no Aadhaar are not checkable by this route,
which is a data gap to close upstream. The number itself is stored encrypted and read back
masked (SRS §16). The **duplicate check also covers non-members**, which it did not: uniqueness
on that table was mobile-per-MPP only, so one Aadhaar went in again on a different number, or
at a second MPP, as often as anyone liked — and every copy is a farmer who can be charged
again.

**Both faces of the card are photographed**, at the dairy's request. This reverses the earlier
decision to hold nothing but the number, which reasoned from SRS §7 data minimisation that a
masked number was enough and that card images carry UIDAI obligations it does not. Those
obligations now apply and are worth stating plainly: the images are written through
`default_storage`, so they land in the encrypted S3 bucket in production, and **the URL is
never returned to a handset** — the API answers `aadhar_front_captured` / `aadhar_back_captured`
instead, because a Mait needs to know the step is done and a link to somebody's identity
document has no business in an app's response cache. Registration and the upload are two calls,
and only the upload is allowed to fail.

Alongside them, a **Father / Husband radio** says which of the two `father_husband_name` is. The
column has carried both since SAP; a record that cannot say which cannot tell a daughter from a
wife, and in a village where the same names repeat that is two women in one row.
| C6 | **Step 4 — Select animal** | ✅ · designed | *Which animal?* A Cow/Buffalo segmented control over the farmer's animals, each row led by **her photograph** where there is one and by a handle (`C1`, `C2`) where there is not, then her tag or `no tag`, and *Last AI 14 Mar 2026 · HF Cross* — because two untagged cows are told apart by a face, by when they were last served, and by nothing else the app holds. A dashed **Add an animal** card ends the list: a place for a record rather than another record. |
| C6b | **Add an animal** | ✅ · designed | A sheet over C6, not a screen — registering is a detour from the list, handed straight back to it, so the question stays legible behind and the tab bar is not covered. Named for the farmer it will register against (*For Kavita Devi · MEM00000412*). Asks four things in the order a Mait can answer them by looking at the animal: cow or buffalo, her breed from a **dropdown** (the one closed list in the flow — twenty breed cards would bury the two fields under them), her ear tag *— optional*, and **a photograph**. The photo is the point: most animals here carry no tag, and next visit the row shows her face. Registration and the upload are two calls, and only the photo is allowed to fail. |
| C7 | **Step 5 — Which breed** | ✅ · designed | *Which breed?* The straw's breed, asked before its number, so a Mait carrying unnumbered stock in two breeds is asked a question instead of refused one. **Opens already answered with the animal's own breed**, where the flask holds it — like to like is the ordinary case, so agreeing costs one tap and every other breed is still one tap away. Rows carry `18 straws with you`, a `Low` pill under five, and every configured breed the flask is empty of shown **blocked** with `None in your stock` — never hidden. Most-carried first. |
| C9 | **Step 6 — Take the proof photo** | ✅ · designed | Ink screen, the step and the question on the page rather than in a card — the body is a live camera and it wants the room. The preview sits inside a **dashed frame**, a space to be filled, captioned *The animal and the Mait in frame*. Under it, the two facts that will be stamped on the record: the GPS pin and `11 Aug · 10:42`, shown **before** the shutter so a Mait knows what they are about to capture. Three controls: flip camera, a green-ringed shutter, and a **torch** — sheds are dark at the hours a Mait works, and a light that stays on lets them frame the shot first. Still no gallery button (SRS §6.3 step 5). |
| C10a | **Member — nothing to collect** | ✅ · designed | Green before it is read. *Nothing to collect · She is a member. Do not take money from her.* The amount she will be charged is shown as what the dairy deducts, never as something to take, and there is no way to collect anything on the screen at all — a member who is asked for cash has no reason to refuse, because she was asked and she paid. Ends the capture. |
| C10b | **Non-member — how is she paying?** | ✅ · designed | Cash or UPI, with her own rate — a non-member's price is its own, since she is not settling against a payout the dairy already owes. Cash leads and is the default. **UPI is blocked outright with no signal**, said before the choice rather than discovered by waiting with the farmer standing there. |
| C11 | **Record the payment** | ✅ · designed | The authorisation code, sent to her own number and read back — the only thing that turns cash in a pocket into a record anyone can stand behind. **It works with no signal**: the capture is saved and the code is asked for when the network returns, because refusing to finish would leave a Mait holding money against an event the app will not close. What is never done is pretending a code was verified when it was not. |
| M12 | **Payment — online proof** | 🟡 | UTR and screenshot are accepted by the API and verified server-side; the screen for capturing them is still to build. |
| M13 | **Payment — COD confirm** | ⬜ | Second confirmation OTP. |
| C12 | **Recorded** | ✅ · designed | The three questions a Mait actually has: is it saved, what did it cost her, how many straws are left. **Queued is not failed** — a record waiting for signal is complete work on a handset, and a Mait who reads "failed" recaptures it, which is how one insemination becomes two. The button is *Start another*, because the next animal is usually in the same yard. |
| C13 | **Unfinished** | ✅ · built | Everything still owed a finish, reached from Home's amber strip. A capture is six steps and four of them write to the server, so it can be abandoned in four places — and Home used to admit to exactly one of them: a straw verified *today* whose photo never arrived. Every other abandoned capture was invisible, which for work already done is the worst kind of missing record: the animal was served and a straw was spent. Each row says who it was for, which animal, and **what it is actually waiting for** — *Photo not taken*, *Payment not taken*, *Code not confirmed* — with the step it reached underneath, so a Mait can pick the nearly-finished ones off first. Tapping a row lands on **that** step, not on the start: the label and the destination come from one function (`aiFlow/resume.ts`), so a row cannot promise one thing and do another. The money states wear the accent; the rest are muted, because a photo still to take is work in progress and a payment never recorded may be cash already in a pocket. Deliberately **not** the waiting-to-sync list — a queued record is finished work held up by a network and is owed nothing by anybody. |

## Supporting

| # | Screen | Status | Contents |
| --- | --- | --- | --- |
| M15 | **Home / dashboard** | ✅ · designed | Ink hero: the Mait's name, `MAIT {id} · n MPPs`, a compact EN/हिं pill and an initials avatar. A squared Ink strip under it while offline. Then two tiles — Today (green) and Waiting (yellow, tapping it syncs) — a **Straws with you** card listing every breed held with a `Low` badge at two or fewer, a yellow **Unfinished — {name}** row that resumes the capture, and **Start new AI** at the foot of the content. At zero straws that button becomes "See stock" rather than starting a flow that would stop dead at the scan step. |
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
| W10b | **Non-members list** | ✅ · built | The farmers Maits registered in the field, directly under Members in the sidebar because it is the same question — who is this farmer — asked of the other roster. Not the same screen, though: Members is search-first because nobody browses 105k imported rows, and this is a **review queue**, browsed newest first. Every column is there to judge a row without opening it — who she is, whose household, who registered her, and the two things that keep the cash path honest: her Aadhaar card and her consent. A row missing consent is tinted red and one missing a card face yellow, the same language the other rosters use. Headline tiles count exactly those, and `No card on file` filters to them. |
| W10c | **Non-member detail** | ✅ · built | Two columns, the same shape W6 uses: evidence left, facts right. The **card first** — both faces in ID-1 wells, each opening full size in the browser's own viewer, because the panel's whole job is reading twelve digits off a photograph and a third-of-a-screen thumbnail cannot be read. A face nobody photographed is a light dashed frame, never a dark slab, which reads as an image that failed to load. Under them, the masked number to check against and the plain statement that opening the record is logged. Right, her record as a definition list — the form an operator reads back down a phone; a fact nobody recorded says so in muted type rather than in the same weight as one that was. |
| W11 | **Users & roles** | ⬜ | Create/deactivate admins and operators. |
| W12 | **Inventory oversight** | ⬜ | Stock by Mait, low-stock exceptions. |
| W13 | **Indents** | ⬜ | Pending/stale indents, Indent Easy sync status. |
| W14 | **Mait leaderboard** | ⬜ | AI count and collections per Mait for a period. |
| W15 | **MPP coverage** | ⬜ | Members served vs. total per MPP. |
| W16 | **Exceptions** | ⬜ | Pending payments, failed OTPs, low stock, stale indents. |
| W16b | **Failed OTPs** | ✅ · built | The detail behind one of W16's cards, reached from its Open link — the same relationship W4 has to W3, so it carries `data-page="exceptions"` and is gated with it rather than becoming a section of its own. The card can only mask a number and count it; this says who is stuck, what they were trying to do, which of four things went wrong and what it is holding up. **The four are the point.** Attempts used up sends somebody to ring a person; *never entered* sends them to the SMS gateway and is invisible on the card, which counts only codes somebody typed into; *ran out of time* is ordinary; and *replaced* is not a failure at all — asking for a second code expires the first, and on the dev database half the rows are that. Rows open in place rather than into a dialog, because an operator works down a queue. |
| W17 | **Reports & export** | ⬜ | Query builder, CSV/Excel export. |
| W18 | **Mait payment** | ✅ · built | The month's payout, previewed and taken away as the two-tab workbook the office already reads. One row per Mait and every column the file has, in the file's order — a preview that shows a convenient subset is one that can agree with itself and disagree with what was downloaded. Nineteen columns fit no screen, so the sheet scrolls sideways with serial, MCC and name pinned and the head frozen; the money is grouped by three vertical rules — earned, after the recovery, paid — rather than by nineteen equal headings. The aside holds the one thing the sheet is *checked against*: the rate card, editable, because a commission is the terms of somebody's engagement and not a constant in a build. It also sets the height — the sheet stretches to end level with it and scrolls inside, so the screen is two columns of the same shape rather than a long table beside a short card. The per-MCC AI deduction count is deliberately **not** here; it is a different question for a different desk, and beside a payout sheet it invited a reconciliation the two figures cannot support. It stays in the API and as the workbook's second tab, where the people who settle milk payments read it. |

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
