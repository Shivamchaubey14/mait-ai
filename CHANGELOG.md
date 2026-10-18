# Changelog

All notable changes to this project are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **The Mait's Home in the coloured pattern.** Today and Waiting tiles with their glyphs on
  solid chips; Straws with you as a blue card with a syringe chip and a total badge, each breed
  a row of its own with its count on a badge and a yolk row and Low pill when it runs low;
  unfinished captures as a yolk card with a count and a Resume button; See stock in blue rather
  than a grey that read as switched off.

- **Raising an indent is a tab.** The Mait's bar gains **Indent** between Inventory and AI
  events, opening the form directly, and Inventory's Raise an indent button is gone — one form,
  one place. After an indent is sent, Done opens My indents.

- **Signing in, in the coloured pattern.**
  - *The number.* Three step tiles above the field — Your number (blue, phone), A code by SMS
    (yolk, message), You're in (green, double tick). The field's label has a phone chip and a
    live `n/10` count that turns green at ten; the field is edged blue with a solid blue `+91`
    block, and turns green with a tick once it holds a number that can be sent. No password is
    a yolk card with a solid key chip, and Send code carries a paper plane on a white chip.
  - *The code.* The number the code went to is a blue pill in the header. The six cells are
    blue while empty and green as each digit lands, with the wash of the failure on a refusal —
    red wrong or locked, yolk expired. The countdown is a blue pill with a clock; Send again is
    a green pill with a refresh glyph once it can be pressed, slate before. A wrong code is a
    solid red strip under the cells; expired and locked are cards with solid chips; the signal
    card is blue with a solid chip; asking the office is a dashed yolk card with a solid chip,
    and once asked a green card with a solid call chip. The button carries a sign-in, refresh
    or lock glyph, and Call IT is a red outlined button with a phone.

- **Nothing to collect, rebuilt.** A member's payment screen is now a full page, top to bottom:
  a red *No cash from a member* card with a struck-through cash chip, saying taking cash would
  make her pay twice; the deduction as a blue card with a receipt chip, the amount large and
  *at the next payout* on a solid blue pill (yolk when no rate is set); *How it is settled* as
  three steps on a slate rail — recorded now in green, deducted by finance and on her payment
  slip still to come; and *This visit* as two rows, the member in blue with her code on a pill
  and the animal in yolk. New strings in English and Hindi.

- **The capture flow, steps 1 to 6, in the coloured pattern — member and non-member alike.**
  The colour lives in the flow's shared pieces, so every step carries it:
  - *Option cards* are always in their tone's wash and edge with the glyph (or initials) on a
    solid chip; a chosen row turns green with a heavier edge and a green chip, and pills are
    solid. Collection points and members are blue, non-members and animals yolk, straws blue
    with the syringe, consumables green with a flask, cash green and UPI blue; on the first
    step Member is blue and Non-member yolk.
  - *Cow / Buffalo* is a blue control with the chosen half filled; the Straws / Consumables
    tabs on step 4 are blue with the syringe and green with a flask, each with its count.
  - *Add a record* is a dashed blue card with a solid plus; *photo slots* are dashed blue with
    a solid camera chip until taken, then green; the photo's pin is a blue card, yolk when
    there is none; search is blue with a solid magnifier chip; radio choices are blue, green
    once chosen; the consent tick is yolk until agreed, green once it is.
  - *The farmer being confirmed* is a yolk card — the colour of people — with a solid yolk
    avatar, the code on a green pill and each fact in a white tile.
  - *Notices* carry a solid chip and a solid pill; section labels lead with a green dot.
  - *Payment*: the cash to collect is a yolk card with a cash chip; a member's facts read back
    in slate. *Done*: what she paid is green (blue for a member's deduction), straws left blue
    with the syringe, and the day's line green when all is sent, yolk while work waits.

- **Pregnancy checks in the coloured pattern, all five screens.**
  - *The list.* Every row wears the wash of when it is due — red late, yolk today, blue coming
    up — or, once answered, of its answer: green pregnant, red not, slate unsure or refused.
    The day badge for a coming check is solid blue; each row has a pin or calendar glyph on
    its line, a Member / Non-member pill and a round arrow. The week tab is blue with a
    calendar and its count, Done green with a double tick, each filled when chosen. The late
    count in the header is a red pill, and Plan route carries a map glyph on a white chip. The
    legend is a slate card of four tiles, two to a row, each in its answer's wash with its
    mark on a solid chip and the whole word beside it — it had set all four on one line and
    clipped "Pregnant" to "Pregn…".
  - *Recording a check.* The owner question, the charge and the findings each have a heading
    with a glyph chip. Each answer is always in its colour — pregnant green, not pregnant red,
    not sure and refused slate, yes-go-ahead green — with its glyph on a solid chip, and
    chosen is a heavier border in that colour with a filled tick. A member's charge is blue,
    cash to collect or no price yolk. The photo box is dashed blue, green once taken and red
    when not pregnant needs one; its Take / Retake is a solid pill. The remark sits in slate;
    a recorded result reads back with the calving date in green, a recheck in yolk, a refusal
    in slate, the remark in blue and the lock in slate.
  - *Recorded.* A solid green tick in the header; queued yolk and sent green with solid chips;
    the money card blue for a member's deduction, yolk for cash to collect or no price, slate
    for no charge; inseminate-again green with the syringe; the next check blue with a navigate
    chip and round arrow; all done green; Back to list slate with a list glyph.
  - *The route.* The map card and each stop are blue, the next stop green and a late stop red;
    each stop's line has a pin glyph and its leg is a solid blue pill with a walking glyph. The
    missing-location note is yolk, and Reorder is slate with a swap glyph.
  - *Choosing the order.* Shortest is blue with a trail sign and late-first red with an alert,
    each with its glyph on a solid chip, the figures under map and clock glyphs, chosen drawn
    heavier with a filled tick.

- **Your indents in the coloured pattern.** Each status chip wears its state's colour and
  glyph — Requested slate, Approved blue, Issued yolk, Collected green, Rejected red, All in
  ink — outlined until chosen and filled when it is, its count on a badge. Every indent is a
  row in the wash of where it has got to, with a syringe (straws) or flask on a solid chip, the
  next step in the state's colour, a solid state pill with its glyph and a round arrow. The
  headline turns into a yolk pill when something is waiting to be collected, and the
  issued-is-not-received note has a solid yolk chip.

- **An indent's detail in the coloured pattern.** The status pill in the header is solid in
  its state's colour with its glyph. The timeline is a slate card: each step's glyph in its dot,
  green once done, yolk for the step it is sitting on, red where it was turned down, and each
  step's card in the same wash. Quantities have a heading chip and each figure is a coloured
  row with its glyph and its number on a solid badge — Requested blue, Approved green once
  agreed (slate before, red when refused), Issued so far yolk while it waits at a counter and
  green once collected. Trips across the counter are green when collected and yolk while
  waiting. The store's code sits in a yolk card with a keypad chip.

- **Profile's MPP list opens under its row.** The list is blue and hangs from the row that
  opened it — the row's lower corners square off and the list carries on beneath in the same
  wash — each MPP a white row with a numbered blue chip, its dairy and member count, and its
  code on a solid blue pill. The arrow turns down as it opens and back as it closes, and the
  list fades and slides in and out rather than blinking.

- **The Mait's Profile in the coloured pattern.** The Mait code rides in the header as a pill
  with an ID-card glyph. This month and Cash on hand are the shared coloured tiles with their
  glyphs — the month green, the cash yolk while there is cash to hand in. Every row carries
  its glyph on a solid chip and the wash of what it says: MPPs blue (the opened list with a pin
  and each code on a blue pill), pregnancy checks and indents yolk while something is due or
  open and green when not, Language and Help slate, Sync green when all is sent and yolk while
  work waits, with a solid Online / Offline pill. Openable rows end in a round arrow in their
  colour, and the unsent-work warning has a solid yolk chip.

- **An AI event's detail in the coloured pattern.** The header carries the event number, the
  member code (blue) or Non-member (yolk) and the MPP as pills, and the date and animal with
  their glyphs; the status pill has its own glyph. The four fact tiles are always coloured, each
  with its glyph on a solid chip: Breed blue with the syringe; Payment green once settled (a
  member's deduction, or a non-member's confirmed cash), yolk while cash is unconfirmed, red
  when nothing is recorded; Location blue, or slate with none; Recorded green on the server,
  yolk while still on the phone. What was used is green, the consumables colour, with a flask
  chip, a count and each quantity on a badge. The proof photo sits in a blue card with a camera
  chip, yolk when it was chosen from the gallery. The trail is slate: numbered steps, the
  latest in green, and the cannot-be-edited note behind a lock. The missing-step alert has a
  solid red chip.

- **The Mait's AI events in the coloured pattern.** Synced, Queued and Needs attention as three
  coloured tiles with their counts, each one a filter — tapped again it comes off, and a state
  with nothing in it says so in a green note. Every row is tinted by its state (green synced,
  yolk queued, red needing attention, slate cancelled) with the state's glyph on a solid chip,
  a solid state pill, a Member / Non-member pill and a round arrow. The range chips are blue
  with their glyphs, filled when chosen; each day is a blue pill with its count on a badge.

- **No plain white button left in the portal.** A `.btn` with no modifier was white on a white
  panel, and so were the outlined row actions — the only thing saying either was a control was
  a border you had to already be looking at. The three outline variants now carry their wash as
  the fill rather than on hover, and hover goes one step deeper (`--color-error-wash-pressed` is
  new, Red having no 100 step of its own). On **Stores** and **Zones** every remaining white
  button took a colour for what it does: the bulk tick green, and Clear, Cancel and Close the
  ink tint. **Products** row Edit joins the yolk Edit the other tables already had, and every
  Edit now carries a pencil glyph beside the word.

- **A superuser door on the sign-in page.** Below the form, and deliberately not a second
  form: an Ink card saying *Superuser login · Django admin — full database access, no zone
  limits*, which opens Django's own admin. It links to `/admin/` on the API's host, not the
  portal's — the same origin behind nginx, a different port on the development path, which
  `api.serverUrl()` now resolves in one place for both this and media.

- **The same row action on every table that has one.** The yolk Edit with its pencil reaches
  **Maits** and **Assignment**, whose Edit columns were still white. On **Indents** the Action
  column takes the colour of what it does: *Review* in yolk with an eye — the same yolk the
  row is tinted while an indent waits — and *Issue* keeping its green, now with an outbound
  glyph. On **Pregnancy** the *Round* button is filled yolk with a clipboard glyph, and its
  column widened to 118px because `table-layout: fixed` wraps rather than widens.

- **A Mait's MPPs, three at a time.** Seven MPPs made a row four lines tall and pushed the
  conception rate — the column the screen exists for — off the bottom of the panel. Three
  codes are shown and the rest sit behind a dashed *+N more* that opens that row in place and
  leaves every other row alone. The count is the point: it keeps a Mait covering seven
  distinguishable from one covering four, which a silent cut would not. Every code stays in
  the DOM, so the search still finds a Mait by a code that is not on screen.

- **The Zones card names its Action column.** Its last header was a `visually-hidden` span, so
  the column read as unlabelled on screen while screen readers heard it. It is now *Action*,
  right-aligned over the button, as on Stores and Products.

- **The Indent form in the coloured pattern.** Each line is tinted by its kind — Straws blue
  with a syringe, Consumables green with a flask, Equipment yolk with a spanner — and the three
  kind buttons wear those colours, filled once chosen. A folded line is a row in its colour with
  the glyph on a solid chip and its number on the corner; the stepper takes away in red and adds
  in solid green; "Issued in fives" is a yolk pill. The foot shows the count as a blue pill and
  the state as a yolk pill while a line is unfinished, green once it can go. The review sheet
  rows match, and the sent screen lists what was asked for in a green card. The breed and item
  pickers open in the line's colour: the kind's glyph on a solid chip by the title, the section
  as a pill with its count, each option tinted with its own chip, and what is held on a badge —
  green for enough, yolk for low, red for none. The breed picker asks **Cow** or
  **Buffalo** first — two buttons at the top, each with its count, filled blue when chosen —
  and lists only that animal's breeds; it reopens on the animal of the breed already chosen.
  The switch is opt-in on `BottomSheet` through `tabbed`. Other pickers are unchanged; the colour is
  opt-in on `BottomSheet` through `tone` and `icon`.
- **The Mait's Inventory in the coloured pattern.** Straws / Consumables / Equipment as three
  coloured buttons with their glyph and count; every row tinted in its kind, its glyph on a
  solid chip and its count on a solid badge; low stock in yolk with a Low pill; species heads,
  the nitrogen warning and the footnotes with chips of their own.

### Added (members)

- **Aadhaar on Members, for Admins only.** A column showing it masked to the last four, with
  **Show** to reveal one member's full number so an Admin can check a caller is who they say
  they are; it masks itself again after 30 seconds. Each reveal is logged as a personal-data
  read against the account, never cached, and rate-limited (`GET /members/{code}/aadhaar/`).
  The Mait app is not sent the field at all.

- **Only an Admin changes a member's mobile number, and SAP never takes it back.** Change
  number on every row of Members opens a dialog: what is on file and where it came from, the
  new number (checked as a 10-digit Indian mobile as it is typed), a required reason with
  quick picks, a preview of what saving will do, and every earlier change. The number becomes
  `mobile_source: office`, shown as a green Office badge and filterable. A member-master
  re-upload never writes an existing member, and now counts and reports the rows whose number
  disagreed with one the office set ("N office-set numbers kept"). Row-locked and checked
  against the number the admin saw, so two admins on one member are one change and one clear
  `409`; audited with both numbers masked. Admin with the Members section only, within their
  zones (`POST /members/{code}/mobile/`, `GET …/mobile-history/`; migration `0013`).

### Fixed

- **AI events now count a day the way the dashboard does.** A capture started before midnight
  and finished after it was counted by the dashboard on the day it *finished* (`completed_at`)
  but filtered into the AI events list — and the CSV export — on the day its draft was *started*
  (`created_at`), so the screen read six for a day the dashboard called seven. The list and the
  export now date an event on its completion for a finished capture, and on when it was started
  only while it is still unfinished (`core.timeframe.event_day_expr`); the list's Captured column
  shows that same date. The two screens agree.

- **A non-member's details no longer read as missing on an AI event.** The event detail only
  named the farmer in its title, which for a non-member — the one farmer with no SAP record to
  look up — left her number, parentage and Aadhaar nowhere to be seen. A new **Farmer & animal**
  panel lays them out (Aadhaar masked, with a "card on file" note where one was photographed),
  and the animal's **ear tag** sits alongside. The ear tag is also now a column in the AI events
  CSV export — it identifies the animal, not the farmer, so it belongs in the file a dispute is
  reconciled against while the file stays free of Aadhaar and bank details. New `owner_detail` on
  `GET /ai-events/{id}/`.

- **Sign out reads whole in Hindi.** On Android it showed "साइन" alone: the label was measured
  in Nunito, which has no Devanagari, and "आउट" wrapped out of sight. The label now spans the
  button with the simple line breaker.

### Added

- **An account's sign-in can be corrected from its row (Users & roles).** Clicking a
  **username** opens a credentials panel — the same "click the field to change it" pattern the
  Pages and Scope columns already use — where an Admin can rename the account and/or set a new
  password. The password is optional on every save (blank leaves it untouched), confirmed to
  catch a typo before it reaches the person's desk, and hidden entirely for a Mait, who signs in
  with a one-time code. Admin-only, enforced by the endpoint, and every change is audited with
  the username before and after. `username` is now accepted by `PATCH /admin/users/{id}/`
  (unique, case-insensitive, excluding the account itself); the password path was already there.

- **Adding stock to a Mait, from the office.** Inventory oversight's one write: a Mait's
  holding panel now carries an **Add stock** form below its three cards — kind (straws,
  consumables, equipment) as three coloured buttons, the item, and how many, with a green
  sentence saying `3 → 13` before the button is pressed. It is the exception the screen needs
  for stock that never came through an indent — an opening balance, straws carried by hand, a
  correction — so it is credited as a manual `adjustment` against `manual` (never an `issue`),
  straws as unnumbered placeholders a Mait claims at the AI step, and the ledger still sums to
  the balance. Audited as `mait_stock`. The everyday path is still a store handing an approved
  indent over the counter. New `POST /admin/inventory/{mait_id}/`; its `GET` now also returns a
  `catalogue` to add from.

- **The keeper's Profile in colour.** Today at your counter first — waiting, ready now, issued
  today and not collected, each with its glyph — then the store in green with its code and zone
  as pills, the BMC/MCCs it serves in yolk as pills with a count, and the language in slate.

- **The keeper's History in colour, over any dates.** Today / 7 days / 30 days and a calendar
  chip for any From–To range; Collected / Waiting for code / Put back as three tiles that
  filter the list; what went out as a green card of items with their glyphs; each handover a
  card in its state's colour with its verdict on a solid disc, and day headings with a count.

- **A straw is a syringe.** Everywhere a semen straw was a water drop — the zonal dashboard,
  indents, history, stock, the keeper's queue and stock, and the portal's store shelf — it is
  now a syringe; a drop reads as milk on a dairy's screens. Ionicons has none, so
  `components/glyph.tsx` draws it from Material Community Icons in the same package. The drop
  stays where it means milk: the daily-litres field.

- **The keeper's stock by kind.** Straws, Consumables and Equipment as three tiles and three
  sections, each item tinted in its kind's colour with its glyph, free and packed as words and a
  bar, and the count on a solid badge — red when there is none. A kind the store holds none of
  keeps its section and says so. Equipment can now be recorded as a delivery. The three tiles
  are the switch between kinds, straws chosen first, and a chosen tile carries a tick. The
  delivery sheet is drawn in the same colours: the kind as three coloured buttons with their
  glyphs and whole names, cow or buffalo as two, items as chips in the kind's colour, and each
  card a numbered step.
- **The keeper's To issue screen in colour.** Ready now / Issued today / Not collected as
  three tiles with their glyphs; every indent a card in its shelf's colour (green ready, yolk
  short, red nothing) with the Mait's initials and code, the item's glyph and count, and a
  sentence on what the shelf can do and who approved it; codes waiting on a Mait as yolk cards
  with the digits large enough to read out, red once locked. `Tile` moved to the shared frame.

- **Store stock from the portal.** Stock on any row of the Stores screen opens that store's
  shelf — straws, consumables and equipment in their own colours, each line with what is free
  and what is packed for a Mait — beside a four-step change: add a delivery or correct the
  count, the kind, the item, the number, with a sentence saying what saving will do. A count
  replaces the shelf and the difference goes to the store ledger as an adjustment, never below
  what is packed for Maits (`/admin/stores/{id}/stock/`).

- **The zonal manager's app** — a third shell on the same sign-in screen, beside the Mait's and
  the store keeper's. Five tabs:
  - **Zone**, a dashboard of the work actually happening, **live like the portal's**: every
    zonal screen re-reads itself every 30 seconds while the app is on screen, stops in the
    background, and fetches afresh the moment the app comes back or a screen is opened, with
    a "Live · updated 10:42" line in the hero that refreshes on a tap. Today, This week and
    This month as three coloured tiles; the week as bars on a green card with each day's
    count on a yellow disc; who is working and where, and the last few captures as they land.
    Who is working and where are coloured cards with every name labelled and coded (Mait
    name, vendor code; MPP with its code). Each capture opens its whole record: its number on
    a pill, member or non-member, the MPP and the Mait with their codes in the hero, and the
    straw, the people, the pregnancy check and the audit trail each in a colour of its own.
  - **All AI events**, from Profile: the zone's inseminations newest first, a page at a time,
    narrowed by a From–To range of dates, each row coloured by its state
    (`GET /zonal/events/`). Counted off the events rather than the pre-aggregated
    table, so it is never silently zero.
  - **Indents, as requests.** A Mait's multi-item Request Stock list arrives as one indent per
    item; the queue groups them back (same Mait, raised within ten minutes) into one card per
    request — the Mait with their vendor code, where they work, how long they have waited,
    and every item with its glyph, quantity and depot pill — coloured by its worst item. The
    decision screen gives each item a card in the colour of its shelf with its own Approve
    and Reject, and a foot of real buttons: Reject (red outline) beside Approve, or Reject all
    / Approve all for a list. Each item is still decided through `/indents/{id}/`.
    Every request waiting on them carries the facts the decision turns on —
    what that Mait already holds of the item, and what the depot serving them can still promise
    — because a manager standing in a yard has one screen, and approving blind is a failure
    nobody notices until the Mait turns up for straws that are not there.
  - **History in colour**: each decision a green or red card with its verdict on a solid disc,
    the item's glyph, the Mait with their code and the depot, and for an approval the road it
    has taken since — Approved → At the depot → Handed over — lit as far as it has got; a
    rejection reads back the words the Mait was given. All / Approved / Rejected tiles filter.
  - **Stock by product**: a Products view with Straws / Consumables / Equipment, each item
    with how much is with the Maits (and how many hold it), how much is in the depots and free
    to give, and what is on its way — asked, agreed, packed. A depot's straws now read as one
    bar: what can still be given out and what is packed for Maits waiting to collect it.
  - **Stock, by place first**: one card per chilling centre with its empty Maits and the depot
    that could restock them on the same card, because a manager works out which way to drive
    before they work out who to ring. Each Mait is counted at exactly one centre, so the rows
    add up to the figure above them.
  - **History**, every approval and rejection with the request behind it and where it got to
    since — and, on a rejection, the reason the Mait was given, read back.
  - **Profile**.

  Tapping any capture in the zone feed opens **the whole record** — the portal's AI event
  detail on a handset: straw and doses, what was charged and whether it cleared, the proof
  photo full size with whether it came from the camera or the gallery, where the handset was
  with a way to drive there, the owner and the animal, every consumable the visit took,
  whether it took, and the trail the server wrote at each step and has never edited. Read-only
  throughout. An event outside the manager's zones answers 404 rather than 403 — whether a
  record exists elsewhere in the network is not that account's to learn.

  Approving and rejecting post to the indent endpoints that already hold the state machine and
  the audit entry — there is no second write path — and rejecting asks for a reason, because
  the Mait reads the indent and not the log.
- **A zonal manager can sign in on a handset**, with the same OTP as a Mait. Two things are
  required and both are decisions somebody made: a live zone on the account, and a mobile
  number. An office Admin with no zone is not admitted at all — the role has a password, and
  opening the OTP door to it wholesale would put the account that runs the SAP imports behind a
  code sent to whatever number was on the row. Their portal login is untouched either way.
- **The Zones screen has a second half: the people (W20).** A zone is a line round some
  chilling centres until somebody is standing inside it. *Who runs these zones* lists every
  zone-scoped account with its zone and the size of its patch, **its mobile number** — editable
  in place, since that number is what opens the app — its last sign-in, what it approved and
  rejected, and an **App** pill that names which of three different things is stopping it. Under
  it, *What they have done*: the audit trail narrowed to those accounts and written as the same
  sentences the Audit log prints, filtered by manager and window, and by **decisions** rather
  than everything by default — a manager signs in and out several times a day, and ninety
  sign-ins bury the two approvals somebody came to read.
- **Users & roles takes a mobile number**, on the create form and beside the zones in the scope
  editor, with a line that says what the two together decide. The Scope column now reads
  *App · 9876500002* or *No number — no app* under an account's zone chips.

- **Audit log (W19)** — the trail this platform has written since its first commit, readable at
  last. Each row is a sentence rather than a schema dump; opening one shows the metadata
  labelled, a before/after diff where there is one, and the request id, which finds everything
  else recorded in the same request. Personal-data reads get a tile, a chip and the only red
  pill on the screen — who opened a farmer's Aadhaar card, who took a workbook of bank details
  away. Read-only, behind its own portal section.
- **The Failed OTPs queue counts a week, not a day**, and every exception card can be opened
  even when its own window is quiet. Between them those two made a queue holding fourteen
  failures read as empty: the card threw away anything older than midnight, and a zero count hid
  the Open control — which is where the window is chosen.
- **The leaderboard takes a date range (W14)** — two date fields beside the presets, so "who is
  working" can be asked about the month somebody is closing rather than only a rolling window,
  with four tiles saying what the range holds. Ranked by AI count as before, now with ties
  settled so an unchanged board reads the same twice. The recent days are counted live and only
  the settled ones come off the aggregate — previously only *today* was, leaving yesterday read
  off a table the hourly job was still writing.
- **Every Exceptions queue opens in place (W16b)** — each card's Open button raises the queue
  behind it as a dialog over the page instead of navigating away, on both Exceptions and the
  dashboard. One dialog serves all six because the API answers them in one row shape. Each row
  names who or what it is about, what state it is in, and — the point of it — **which of several
  causes** put it there, because the cause decides who gets rung: a payment waiting on a
  farmer's authorisation and one waiting on a Mait's screenshot are the same row on the card and
  two different phone calls. Filter chips are those causes, each carrying the count it will
  show.
- The non-member export carries each farmer's **last known position** — latitude, longitude,
  whether the fix came from the handset or from a chosen photograph's EXIF, and the day it was
  taken. Taken from the GPS pin on her most recent insemination, because a non-member holds no
  coordinates of her own and the MPP column cannot say which household. Blank where there is no
  fix, never 0, 0.
- **Mait payment (W18)** — the month's payout for the field technicians, previewed in the portal
  and downloaded as the two-tab workbook the office already keeps by hand. Commission per
  insemination and a monthly retainer, less the straws and consumables issued off the inventory
  ledger, with the per-MCC milk-payment deduction count on its own tab. Rates are editable from
  the screen rather than fixed in the build. The one export in the platform besides the
  non-member roster that carries unmasked bank details — it is a payment instruction — behind
  its own portal section and audit-logged as `pii_access` with the month it covered.
- Monorepo scaffold covering the three SRS workstreams: backend (Django 5 + DRF), mobile
  (React Native + TypeScript) and admin web (HTML/CSS/JS + jQuery).
- Django project skeleton with per-environment settings, domain apps, and models for the full
  §8 schema — master data, animals, inventory + ledger, AI events, payments, indents, audit.
- Atomic AI-event completion service enforcing the inventory invariant with row-level locking,
  a non-negative stock check constraint and idempotency keys.
- Docker Compose development environment: MySQL 8, Redis 7, API, Celery worker, Celery Beat,
  Flower, Nginx.
- GitHub Actions pipelines for backend, mobile and admin-web, plus CodeQL, dependency audit,
  container scan, and gated staging/production deploys.
- Documentation set: SRS, architecture, frozen v1 API contract, branching model, deployment
  runbook, design system, 30-day roadmap, ADRs.
- Design-system tokens shared between the admin portal (CSS custom properties) and the mobile
  app (TypeScript), derived from the business-supplied palette and Lexend/Quicksand pairing.

[Unreleased]: https://github.com/Shivamchaubey14/mait-ai/commits/develop
