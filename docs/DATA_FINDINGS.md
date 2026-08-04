# SAP export findings

What the real exports contain, measured by running them through the importer on
4 August 2026. This supersedes the column descriptions in SRS §18.1, which were written from
a summary rather than from the files.

Source files (not committed — they hold PII, and `.gitignore` blocks `.xlsx`):

| File | Rows | Cols | Header row |
| --- | --- | --- | --- |
| `Sahyak.xlsx` | 3,134 | 25 | 1 |
| `Member.xlsx` | 105,484 | 54 | **6** |
| `Maits Vendor C.xlsx` | 61 | 23 | 1 |

---

## 1. Blocking: 93% of Maits have no mobile number

| | |
| --- | --- |
| Distinct Sahayak vendor codes | 3,110 |
| With a valid 10-digit mobile | **224 (7.1%)** |
| Without | **2,886** |

SRS §6.8.2 provisions Mait accounts from this master and activates them "with a mobile number
for OTP-based first login". SRS §9.1 has no password path for the Mait role — OTP is the only
way in.

**2,886 Maits therefore cannot log in at all.** This blocks Phase 2 Day 6 for everyone but a
7% pilot group, and it blocks go-live.

Note the MPP's *own* contact number is 99.9% populated (3,130/3,134) — it is the Sahayak's
personal number that is missing. The two live in adjacent columns that are **both named
`Mobile No`**, which is likely how the gap went unnoticed.

Needs a business decision:
- collect the missing numbers before rollout, or
- allow an Admin to set a Mait's mobile in-app at activation (a small addition to §6.8.2), or
- add a password fallback for the Mait role (weakens §16 and needs sign-off).

## 2. 1,580 members cannot authorise a payment

| | |
| --- | --- |
| Member rows | 105,484 |
| Valid 10-digit mobile | 103,904 (98.5%) |
| Invalid or unusable | **1,580 (1.5%)** |

Every row has *something* in the column; 1,580 fail a 10-digit Indian mobile check, so they
are malformed rather than absent.

SRS §6.5 sends the payment authorisation OTP to the member's registered mobile, and §6.5.3
blocks completion until it is verified. For these members the flow dead-ends: the Mait can
perform the AI but can never close the event, so the straw is consumed physically while
inventory still shows it.

The service already fails with a clear message rather than a crash, but the flow needs a
defined fallback — supervisor override, or capturing a number at point of service.

## 3. The two Mait files do not share an identifier space

| | |
| --- | --- |
| `Sahyak.xlsx` → `Sahayak Vendor` | `5500000003`… (3,110 distinct) |
| `Maits Vendor C.xlsx` → `CUSTOMER ID` | `9900000000`… (61 distinct) |
| **Overlap** | **0** |

SRS §1.3 defines Sahayak as "the vendor-coded field agent linked to an MPP; maps to Mait in
this app", and the MPP→Mait link only exists in `Sahyak.xlsx`.

The importer therefore treats `Sahyak.xlsx` as the authoritative Mait source and loads the
61-row vendor file as separate, unlinked Mait records. Merging them on a guess would corrupt
MPP assignment, which is what scopes a Mait's app to their own MPPs (§6.2.3).

**Open question:** what is `Maits Vendor C.xlsx`? A different role, a newer numbering scheme,
or a subset being onboarded first? 60 of its 61 rows have a mobile number — against 7% in the
Sahayak file — which hints it may be the actual app users.

## 4. 50 duplicate member codes

`member_code` is the upsert key (§6.1.3) and is `UNIQUE` in the schema. 50 codes appear twice
in the file. Under a plain upsert the second row silently overwrites the first and the run
looks clean.

The importer now flags a repeat *within a single file* as a failed row so it lands in the
error report instead of vanishing.

## 5. Referential integrity holds

All 3,050 distinct MPP codes referenced by member rows exist in `Sahyak.xlsx` — **zero
orphans**. Upload order matters (MPP master before members), and the importer enforces it by
rejecting a member row whose MPP is unknown.

## 6. Only 79% of members are active

83,480 of 105,484 rows have `Activation status = Yes`. Whether inactive members should be
selectable for AI service is a business rule the SRS does not state. Currently all rows are
imported and the status is stored unfiltered.

---

## Schema corrections made

| Field | SRS said | File actually has |
| --- | --- | --- |
| MPP name | `MPP Name` | `MPPName` (no space) |
| Geo hierarchy | `State`/`District`/`Tehsil` | `State Code`/`District Code`/**`Tahsil Code`** |
| Member form/folio | `Form no`/`Folio no` | `Form no.`/`Folio no.` (trailing period) |
| Member bank account | `Bank A/C No` | `Bank A/C No.` |
| Mait name | `Name` | `NAME OF THE CUSTOMER` |
| Mait mobile | `Contact Number` | `CUSTOMER CONTACT NUMBER` |
| MPP + Sahayak mobile | one column | **two columns both named `Mobile No`** |

All are handled in `backend/apps/masterdata/columns.py` via an alias table, so a future export
that drifts is a one-file change.

`9999-12-31` is SAP's "no end date" sentinel and is stored as `NULL`.

---

## Performance

Measured locally against MySQL 8.0.44:

| Stage | Rows | Time |
| --- | --- | --- |
| MPP + Sahayak | 3,134 | ~35 s |
| Vendor | 61 | <1 s |
| Member | 5,000 | 41 s |
| Member (extrapolated) | 105,484 | **~15 min** |

Acceptable for an async job with progress polling (§6.1.6). The remaining cost is one
`update_or_create` round trip and one Fernet encryption per PII field per row. If this needs
to be faster, batching the reads and writes per chunk is the next step — the per-row savepoint
that makes partial success work (§6.1.4) is the constraint to design around.
