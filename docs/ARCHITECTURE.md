# Architecture

## System context

```
┌──────────────┐   ┌───────────────────┐   ┌──────────────────┐
│ Mait Mobile  │   │ Admin Web Portal  │   │   Indent Easy    │
│ React Native │   │ HTML/JS + jQuery  │   │ (existing app)   │
└──────┬───────┘   └─────────┬─────────┘   └────────┬─────────┘
       │ HTTPS/JWT           │ HTTPS/JWT            │ HMAC webhook
       └─────────────┬───────┴──────────────────────┘
                     ▼
          ┌─────────────────────┐
          │ Nginx — TLS, rate   │
          │ limiting, gzip      │
          └──────────┬──────────┘
                     ▼
          ┌─────────────────────┐        ┌──────────────────┐
          │ Django + DRF        │◀──────▶│ Redis            │
          │ Gunicorn, 2+ pods   │        │ cache/OTP/broker │
          └──────────┬──────────┘        └────────┬─────────┘
                     │                            │
        ┌────────────┼───────────────┐            │
        ▼            ▼               ▼            ▼
  ┌──────────┐ ┌──────────┐  ┌────────────┐ ┌──────────────┐
  │ MySQL 8  │ │ MySQL RR │  │ S3 storage │ │ Celery + Beat│
  │ primary  │ │ (reports)│  │ photos/UTR │ │ workers      │
  └──────────┘ └──────────┘  └────────────┘ └──────────────┘
                                                   │
                                       ┌───────────┴──────────┐
                                       ▼                      ▼
                                 SMS/OTP gateway      Indent Easy sync
```

Clients never touch the database. The DRF layer is the only writer, which is what makes the
inventory invariant enforceable.

## Backend module layout

Each domain is a Django app under `backend/apps/`. Apps depend downward, never sideways in a
cycle.

| App | Owns | Key models |
| --- | --- | --- |
| `core` | Shared base classes, audit log, encrypted fields, idempotency, problem-details handler | `AuditLog`, `TimeStampedModel`, `IdempotencyRecord` |
| `accounts` | Users, roles, JWT, OTP login, RBAC permissions | `User`, `Role` |
| `masterdata` | SAP-sourced identity — MPP, Mait, Member, Non-Member; upload pipeline | `MPP`, `Mait`, `Member`, `NonMember`, `DataUploadLog` |
| `animals` | Animal registry and breed configuration | `Animal`, `BreedConfig` |
| `inventory` | Semen batches, Mait stock balance and immutable ledger | `SemenBatch`, `MaitInventory`, `MaitInventoryLedger` |
| `ai_events` | The AI event state machine — the heart of the system | `AIEvent` |
| `payments` | Payment records, OTP issuance/verification, UTR proof | `Payment`, `OTPLog` |
| `indents` | Stock requests and their lifecycle | `IndentRequest` |
| `integrations` | Indent Easy connector, webhook receiver, reconciliation job | — |
| `dashboard` | Pre-aggregated reporting and exports | `DailyAIAggregate` |

### Dependency direction

```
core ◀── accounts ◀── masterdata ◀── animals
  ▲          ▲            ▲            ▲
  └──────────┴── inventory ◀── ai_events ──▶ payments
                     ▲              ▲
                  indents      dashboard
                     ▲
               integrations
```

`ai_events` is the only app permitted to call `inventory`'s deduction service, and it does so
inside a single transaction.

## The inventory invariant

SRS §3.3 and §6.4 make one guarantee: **a Mait cannot complete more AI events than they hold
straws for**, even under concurrent requests and network retries. Three mechanisms enforce it.

**1. Row-level lock at completion.** `complete()` opens a transaction and takes
`SELECT ... FOR UPDATE` on the Mait's inventory row before checking the balance. Two
concurrent requests serialise; the second sees the decremented balance.

**2. A database check constraint.** `qty_available >= 0` is a table constraint, so even a bug
in application code cannot drive stock negative — the write fails instead.

**3. Idempotency keys.** A retried `complete` call carrying the same `Idempotency-Key` returns
the stored original response rather than executing a second deduction. This is what makes the
mobile offline queue safe: it can retry blindly.

```python
with transaction.atomic():
    inv = MaitInventory.objects.select_for_update().get(mait=mait, product_ref=batch)
    if inv.qty_available < 1:
        raise InsufficientStock(straw_no)
    inv.qty_available -= 1
    inv.save(update_fields=["qty_available", "updated_at"])
    MaitInventoryLedger.objects.create(
        inventory=inv, txn_type="consume", qty=1, ref_type="ai_event", ref_id=event.id
    )
    event.status = AIEvent.Status.COMPLETED
    event.save(update_fields=["status", "updated_at"])
```

The concurrency test suite (SRS §13) fires parallel completions at a Mait holding one straw
and asserts exactly one succeeds.

## AI event state machine

Transitions are server-side only. The client sends intent; the server decides whether the
transition is legal.

```
        ┌─────────┐  scan straw   ┌────────────────┐  photo   ┌────────────────┐
   ───▶ │  draft  │ ────────────▶ │ straw_verified │ ───────▶ │ photo_captured │
        └────┬────┘               └───────┬────────┘          └────────┬───────┘
             │                            │                            │ initiate
             │ abort                      │ abort                      ▼
             │                            │                   ┌─────────────────┐
             ▼                            ▼                   │ payment_pending │
        ┌───────────┐ ◀────────────────────────────────────── └────────┬────────┘
        │ cancelled │            abort                                 │ payment verified
        └───────────┘                                                  ▼
                                                              ┌─────────────┐
                                                              │  completed  │  ← straw deducted
                                                              └─────────────┘
```

`completed` and `cancelled` are terminal. A straw is deducted on exactly one edge — the one
into `completed` — so a cancelled event never leaks stock.

## Offline sync

Mobile keeps a local SQLite queue. Steps 1–6 of the capture flow work with no network.

1. Reference data (assigned MPPs, their members, breed config, own inventory) is pulled at
   login and cached.
2. A draft event is written locally with a client-generated UUID, which doubles as its
   `Idempotency-Key`.
3. On reconnect the queue drains in order. Photos upload first, then the event body, then
   completion.
4. The server dedupes on the idempotency key, so a partially-drained queue retried from the
   start produces no duplicates.
5. A rejected event (straw already consumed by a synced-earlier event) surfaces in the app as
   a resolvable conflict rather than silently disappearing.

## Async jobs

| Job | Trigger | Purpose |
| --- | --- | --- |
| `process_master_upload` | On upload | Chunked bulk-upsert of 100k+ SAP rows with progress reporting |
| `send_otp` | On payment initiate / login | Dispatch via SMS gateway, log the attempt |
| `push_indent_to_indent_easy` | On indent create | Outbound API call with retry/backoff |
| `reconcile_indent_easy_grn` | Celery Beat, every 15 min | Poll for GRNs whose webhook never arrived |
| `aggregate_daily_ai_counts` | Celery Beat, hourly + nightly | Pre-compute dashboard series so reads never scan raw events |
| `expire_stale_otps` | Celery Beat, every 5 min | Housekeeping on the OTP store |

## PII handling

Aadhaar, PAN and bank details are encrypted at rest with a Fernet key held outside the
database (`FIELD_ENCRYPTION_KEY`, injected from the secret store). Serializers return masked
values (`XXXXXXXX1234`) by default. Full values are available only from a dedicated
admin-restricted endpoint, and every such read writes an `AuditLog` row.

Rotating the encryption key is a migration, not a config change — see
[`DEPLOYMENT.md`](DEPLOYMENT.md).

## Records of decision

Architecture decisions with lasting consequences are captured in [`adr/`](adr/).
