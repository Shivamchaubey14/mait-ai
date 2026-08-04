# Backend API

Django 5 + DRF, MySQL 8, Celery/Redis. The single source of truth for master data, AI events,
inventory and payments (SRS §3.1).

## Running it

```bash
make up          # from the repo root — MySQL, Redis, API, Celery, Flower
make migrate
make superuser
```

| | |
| --- | --- |
| API root | http://localhost:8000/api/v1/ |
| Swagger UI | http://localhost:8000/api/docs/ |
| Redoc | http://localhost:8000/api/redoc/ |
| Django admin | http://localhost:8000/admin/ |

Without Docker:

```bash
python -m venv .venv && .venv\Scripts\activate     # Windows
pip install -r requirements/dev.txt
cp .env.example .env                                # then fill it in
python manage.py migrate
python manage.py runserver
```

`mysqlclient` needs the MySQL client headers and a C compiler to build. On Windows the
straightforward path is the Docker route above.

## Layout

```
config/
├── settings/       base → dev / staging / production / test
├── celery.py       app + the Beat schedule
└── urls.py         everything under /api/v1/

apps/
├── core/           audit log, PII encryption, idempotency, RFC-7807 errors, RBAC, health
├── accounts/       users, roles, OTP login
├── masterdata/     MPP, Mait, Member, Non-member + the SAP xlsx import pipeline
├── animals/        animal registry, config-driven breed list
├── inventory/      semen batches, Mait stock, immutable ledger  ← the invariant lives here
├── ai_events/      the state machine
├── payments/       payment records, OTP issue/verify
├── indents/        stock requests
├── integrations/   Indent Easy client, webhook, reconciliation
└── dashboard/      pre-aggregated reporting
```

## How the code is organised

**Business logic lives in `services.py`, not in views or serializers.** Views translate HTTP
into a service call and back. That is what lets the same logic run from a Celery task or a
management command, and what makes the concurrency tests possible at all.

**The inventory invariant is enforced in three places** — a row lock, a database check
constraint, and idempotency keys. Read [ADR 0002](../docs/adr/0002-inventory-gating-via-database-locks.md)
before touching `apps/inventory/services.py` or `apps/ai_events/services.py`.

**Nothing slow goes inside the completion transaction.** No S3 upload, no SMS, no outbound
HTTP — the inventory row lock is held for its duration.

**PII fields are encrypted and masked by default.** `EncryptedCharField` handles storage;
serializers return `mask(...)` output. An encrypted column cannot be searched with `LIKE` or
indexed — if you need lookup by one of those values, add a separate keyed hash column.

## Testing

```bash
make test-backend                       # pytest with coverage, fails under 80%
pytest apps/ai_events -v                # one app
pytest -k concurrent                    # the invariant tests
```

Tests run against **real MySQL**, not SQLite. The invariant depends on InnoDB row locking and
check constraints, and SQLite would let a broken implementation pass.

## The API contract is frozen

`docs/API_CONTRACT.md` is what mobile and admin-web build against. Changing a route means
updating the contract and regenerating the schema in the same PR:

```bash
make schema        # writes openapi.yaml
```

CI fails on drift between the committed schema and the generated one.

## Migrations

Every migration must be backward compatible with the release currently running — during a
rolling update both versions serve traffic. Add nullable columns, never rename, and run large
backfills as a Celery job rather than inside the migration. Details in
[`docs/DEPLOYMENT.md`](../docs/DEPLOYMENT.md#migration-discipline).
