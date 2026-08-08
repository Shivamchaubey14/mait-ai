# Handover — where the build stands

Written 2026-08-07. Read this first if you are picking the project up cold; it says what
exists, what does not, and the things that are true but not obvious from the code.

Everything else worth knowing is already in the repo: [`SRS.md`](SRS.md) for requirements,
[`ARCHITECTURE.md`](ARCHITECTURE.md), [`API_CONTRACT.md`](API_CONTRACT.md) for the frozen
endpoint surface, [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md) for both UI patterns, and
[`ROADMAP.md`](ROADMAP.md) for the phase plan.

---

## Phase status

| Phase | Days | State |
| --- | --- | --- |
| 1 · Foundation | 1–3 | Done |
| 2 · Master data & auth | 4–8 | Done |
| 3 · Core AI event & inventory | 9–14 | **Done** |
| 4 · Payments | 15–18 | **Not started** — `apps/payments/urls.py` is empty |
| 5 · Indent & Indent Easy | 19–22 | Day 19 done (indent API + screens). An admin can now approve, reject and issue from the portal — see below. Days 20–22 — the outbound push, the GRN webhook and reconciliation — still not started |
| 6 · Mobile polish | 23–25 | Substantially done ahead of schedule |
| 7 · Admin dashboard & reports | 26–28 | Done — all 16 portal screens built |
| 8 · Hardening, UAT, go-live | 29–30 | Not started |

**The core loop is proven.** `backend/apps/ai_events/tests/test_ten_straws.py` walks it over
real HTTP: ten straws complete exactly ten events, the eleventh capture is refused at the
scan, a queue replaying the whole day changes nothing, and one straw cannot serve two animals.

---

## The one thing that blocks the app

An AI event cannot reach `completed` without a **verified payment**, and the payment endpoints
do not exist yet (Phase 4). So in the app the capture flow runs MPP → farmer → animal → straw
→ photo and then stops. `complete_ai_event` and `POST /ai-events/{id}/complete/` are built and
tested; nothing can legitimately reach them from a handset until payments land.

`test_ten_straws.py` writes the `Payment` row directly and says so in a comment. That is a
test-only shortcut, not a code path the app has.

---

## Running it locally

Docker was not used in this work — the no-Docker path in `scripts/dev-start.ps1` was. Two
servers plus Expo:

```powershell
cd D:\mait-ai\backend;   python manage.py runserver 0.0.0.0:8000
cd D:\mait-ai\admin-web; python -m http.server 8080 --bind 127.0.0.1
cd D:\mait-ai\mobile;    npx expo start -c
```

The API binds `0.0.0.0` on purpose: a phone cannot reach the host's loopback. The app derives
its API host from whatever address the Expo packager serves on
(`mobile/src/config/env.ts`), so if Expo picks a Hyper-V adapter instead of Wi-Fi, set
`$env:REACT_NATIVE_PACKAGER_HOSTNAME` to the LAN address first.

The admin portal does the same trick in `admin-web/assets/js/api.js`: served on a port other
than 80/443/8000 it points at `:8000` directly, because behind nginx the portal and API share
an origin and a relative path is correct there.

### Credentials and seeded data (development only)

| | |
| --- | --- |
| App | `9999999999` / `123456` — a fixed dev OTP, wired via `DEV_FIXED_OTP_NUMBERS` in `backend/.env`. Production refuses to boot if it is set. |
| Portal | `admin` / `MaitAdmin@2026` |

The demo Mait is ROHIT KUMAR (`5500000054`), assigned MPPs 001302, 001308 and 001371, holding
straws in three breeds plus consumables and equipment. None of that survives a database reset;
re-seed with:

```powershell
python manage.py seed_straws   --mait 5500000054 --count 10 --breed MURRAH
python manage.py seed_supplies --mait 5500000054
```

Both go through `credit_stock`, so the ledger stays summable to the balance —
`/api/v1/mait/inventory/check/` should always answer `consistent: true`.

The OTP throttle is 5 sends/hour in `base.py` and loosened to 100/hour in `dev.py` only.
Hitting the production limit while testing surfaces as a generic error, which cost an hour
once.

---

## What was built, by workstream

**Backend** (179 tests, ~73% coverage). AI event capture, photo upload with GPS and a device
timestamp, the atomic completion, the animal registry, inventory including an admin-wide
oversight endpoint and a product catalogue, indents, the Mait roster, and a streaming CSV
export. Storage goes through `default_storage`, so photos land on disk in development and in
the encrypted S3 bucket in production without the view knowing.

**Mobile.** Login with OTP, a session that survives restarts via `expo-secure-store`, four
tabs (Home, Stock, History, Settings), the capture flow through step 5, request-stock with a
multi-line form and a review sheet, and the offline queue.

**Admin portal.** All 16 screens, W2–W17, on one shared shell (`portal.css`, `shell.js`,
`ui.js`).

---

## Things that will bite you

- **`mypy` cannot run locally** — it is only in the container the Makefile targets. `ruff` and
  `black` do run; CI covers mypy.
- **Straw scanning is manual entry.** `expo-camera` is installed for the proof photo, so the
  barcode scanner is a small job, but it is not done.
- **The admin portal's Indents screen only has data if the app has raised one.** Same for
  payments columns everywhere — Phase 4.
- **An admin can now approve, reject and issue indents from the portal**, because the GRN
  callback that was meant to be the only path does not exist yet — without it an indent never
  leaves `requested`. Read the docstring in `apps/indents/services.py` before touching it: the
  original design deliberately had no such path, and what keeps it honest is that issuing only
  *sets stock aside*. The balance moves at `confirm-collection`, which the Mait does from the
  app once the goods are in their hands. When Indent Easy lands, this becomes the fallback,
  not the route.
- **Straws issued as a quantity have no numbers until they are used.** They are `SemenBatch`
  rows flagged `is_unnumbered`, and the number a Mait types at the AI step claims one
  (`get_straw_for_mait(..., claim=True)`). Uniqueness is untouched — the number is written
  onto a row they already hold. A Mait carrying unnumbered stock in two breeds gets
  `400 breed-required`, because the number alone cannot say which bundle it came from.
- **Commits carry no `Co-Authored-By` trailer** in this repo. The trailer is still on commits
  pushed before 2026-08-06; removing it there means rewriting published history, which was
  deliberately not done.
- **A Sahayak is not a Mait.** `Sahyak.xlsx` carries an MPP and the Sahayak who staffs it on
  one row, and the importer used to turn that column into a `Mait` — producing one pseudo-Mait
  per village, 3,110 of them, each "covering" the single MPP they came from, while the real
  roster (the ZMAI vendor export, ~58 rows) had no coverage at all. Settled on 2026-08-07:
  the master now stores the Sahayak as an MPP *contact* (`MPP.sahayak_name` and friends) and
  creates no Maits, and `manage.py retire_sahayak_maits` deactivated the rows left behind.
  They are deactivated rather than deleted because inventory, indents and AI events point at
  them. `/admin/users/maits/` hides them unless `?include_retired=true`.
- **Coverage now comes only from the assignment sheet.** The MPP master no longer writes
  `MPP.mait` at all, so a master refresh cannot silently undo an assignment — which it used
  to do. Assign from the portal's Assignment screen (bulk `.xlsx` round trip, or one row at a
  time). After the retirement, 3,131 of 3,134 MPPs are unassigned and need doing.
- **Never ask MySQL what local day a timestamp falls on.** `__date` and `TruncDate` on an aware
  `DateTimeField` compile to `CONVERT_TZ`, which returns NULL unless `mysql.time_zone*` was
  loaded with `mysql_tzinfo_to_sql` — and this database's is empty, as most are. A NULL
  comparison matches nothing, so the whole dashboard reported zero on a database full of
  events, and the hourly aggregate job keyed every slice on NULL. Nothing in either answer said
  the filter was at fault rather than the data. Fixed 2026-08-08 by comparing against instants
  and grouping by day in Python: see `apps/core/timeframe.py`, and use it rather than
  reintroducing `__date`. Loading the timezone tables in production is still worth doing, but
  no query should need it.
- **`develop` is pushed to directly**, bypassing the branch-protection rule. That is a known,
  accepted deviation from `BRANCHING.md`.

---

## Where to start next

Phase 4, payments, in the order the roadmap gives: the OTP service and `initiate` +
member-OTP verify, then the online UTR path, then COD's second confirmation, then the
linkage that lets `complete` be reached. That is what turns a capture that stops after the
photo into an event a Mait can actually finish.
