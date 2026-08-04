# Mait AI — Artificial Insemination Field Operations Platform

Digitises the end-to-end Artificial Insemination (AI) service delivered by field agents
("Maits") to dairy members and non-members across the MPP network of
**Shwetdhara Milk Producer Company**.

Replaces a paper-and-memory driven process with a validated, inventory-gated, fully
auditable digital flow.

> Specification: [`docs/SRS.md`](docs/SRS.md) · Version 1.0 · Classification: Internal / Confidential

---

## Repository layout

This is a **monorepo**. Three workstreams build in parallel against one API contract
that is frozen at the end of Phase 1.

| Path | Component | Stack |
| --- | --- | --- |
| `backend/` | REST API — single source of truth | Python 3.12, Django 5, DRF, MySQL 8, Celery, Redis |
| `mobile/` | Mait field app (Android-first) | React Native + TypeScript, Redux Toolkit, RTK Query |
| `admin-web/` | Admin / back-office portal | HTML5, CSS3, jQuery + AJAX, Chart.js |
| `infra/` | Local + deployment infrastructure | Docker Compose, Nginx, Kubernetes manifests |
| `docs/` | SRS, architecture, ADRs, API contract | Markdown |
| `.github/` | CI/CD pipelines, templates, policies | GitHub Actions |

## Core invariants

These are non-negotiable and enforced at the database and transaction layer, not in UI code:

1. **Inventory is the gate.** A Mait cannot complete an AI event for a straw they do not
   hold. 10 straws means exactly 10 completable AI events.
2. **Atomic completion.** Straw deduction and event completion happen in one transaction,
   so a network retry can never double-deduct or double-count.
3. **No completion without verified payment.** `ai_event.status = completed` is unreachable
   while payment is `pending` or `failed`.
4. **Everything is auditable.** Every master-data change, event transition and payment
   verification writes an immutable audit record.
5. **PII is encrypted at rest and masked by default.** Aadhaar, PAN and bank details are
   never returned in full from a standard endpoint.

## Quick start (local development)

Requires Docker Desktop and Docker Compose v2.

```bash
git clone https://github.com/Shivamchaubey14/mait-ai.git
cd mait-ai

cp backend/.env.example backend/.env     # then fill in real values
make up                                  # MySQL + Redis + API + Celery + Nginx
make migrate
make superuser
```

| Service | URL |
| --- | --- |
| API root | http://localhost:8000/api/v1/ |
| Swagger UI | http://localhost:8000/api/docs/ |
| Redoc | http://localhost:8000/api/redoc/ |
| Django admin | http://localhost:8000/admin/ |
| Admin web portal | http://localhost:8080/ |
| Flower (Celery) | http://localhost:5555/ |

Run `make help` for the full task list.

### Without Docker

```bash
cd backend
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements/dev.txt
cp .env.example .env
python manage.py migrate
python manage.py runserver
```

## Branching

`main` is production and always deployable. `develop` is the integration branch. Nothing
lands on either without a reviewed, green pull request.

```
feature/* ─┐
fix/*      ├─▶ develop ─▶ release/x.y.z ─▶ main ─▶ tag vX.Y.Z ─▶ production
chore/*   ─┘                                 ▲
                                   hotfix/* ─┘
```

Full rules, naming conventions and the release process: [`docs/BRANCHING.md`](docs/BRANCHING.md).

## Contributing

Read [`CONTRIBUTING.md`](CONTRIBUTING.md) before your first pull request. In short:
Conventional Commits, a linked issue, green CI, one approving review, squash merge.

## Security

Do not open a public issue for a vulnerability. See [`SECURITY.md`](SECURITY.md).

## Documentation

| Document | Contents |
| --- | --- |
| [`docs/SRS.md`](docs/SRS.md) | Full software requirements specification |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | System architecture, data flow, state machine |
| [`docs/API_CONTRACT.md`](docs/API_CONTRACT.md) | Frozen v1 endpoint surface and conventions |
| [`docs/BRANCHING.md`](docs/BRANCHING.md) | Branching model, releases, hotfixes |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Environments, deploy and rollback runbook |
| [`docs/DESIGN_SYSTEM.md`](docs/DESIGN_SYSTEM.md) | Typography, palette, component rules |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | 30-day phased delivery plan |
| [`docs/adr/`](docs/adr/) | Architecture decision records |
