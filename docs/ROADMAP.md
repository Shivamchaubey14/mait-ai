# 30-day delivery plan

Implements SRS §12. Three workstreams — Backend, Mobile, Admin Web — run in parallel against
one API contract frozen at the end of Phase 1 ([`API_CONTRACT.md`](API_CONTRACT.md)).

Each phase maps to a GitHub milestone. Each day's deliverables become issues under it.

## Phase 1 — Days 1–3 · Foundation

| Day | Deliverables |
| --- | --- |
| 1 | Requirement sign-off with business; finalise ERD & API contract; repo, branching strategy, Docker Compose dev environment |
| 2 | Django + DRF skeleton, MySQL migrations for all master & operational tables; JWT auth scaffolding |
| 3 | CI pipeline skeleton (lint + test on PR); OpenAPI generation wired; React Native app shell; admin web shell with design-system CSS |

**Exit gate:** API contract frozen. Mobile and admin-web can now build against it, mocked or live.

## Phase 2 — Days 4–8 · Master data & auth

| Day | Deliverables |
| --- | --- |
| 4 | SAP Member Master upload pipeline (async Celery parser, header detect, validation) + admin upload UI |
| 5 | Mait/Vendor and MPP/Sahayak upload pipelines + upload-history and error-report screens |
| 6 | Auth: OTP login for Mait, password login for Admin/MPP Operator; RBAC middleware |
| 7 | Admin: user management (create/activate Mait & Admin accounts), MPP–Mait assignment screen |
| 8 | Mobile: login, MPP/Member/Non-Member selection wired to real APIs; Phase 2 integration test pass |

**Exit gate:** a real Mait can log in and see their real assigned MPPs and members.

## Phase 3 — Days 9–14 · Core AI event & inventory

| Day | Deliverables |
| --- | --- |
| 9 | Animal & breed config APIs; animal add/select screens |
| 10 | Semen batch & Mait inventory APIs; straw scan + validate endpoint with stock/uniqueness checks |
| 11 | `draft` → `straw_verified` transitions (backend transactional logic + mobile screens) |
| 12 | Camera photo capture with GPS/time stamp, S3 upload pipeline, `photo_captured` transition |
| 13 | Atomic `complete` transaction (straw deduction + completion); inventory ledger writes |
| 14 | Offline queue (local SQLite) + sync-on-reconnect with idempotency keys; end-to-end test of the 10-straws-max-10-AI scenario |

**Exit gate:** the inventory invariant holds under a concurrency test. This is the highest-risk
phase — everything else assumes it.

## Phase 4 — Days 15–18 · Payments

| Day | Deliverables |
| --- | --- |
| 15 | OTP service (send/verify, expiry, attempt limits) wired to SMS gateway; payment initiate + member-OTP verify |
| 16 | Online path: UTR + screenshot capture/upload, payment status transitions |
| 17 | COD path: two-step OTP confirmation, backend + mobile screens |
| 18 | Payment → AI-event completion linkage; end-to-end test of both modes |

**Dependency:** SMS gateway credentials must be procured before Day 15 (SRS §17.1).

## Phase 5 — Days 19–22 · Indent & Indent Easy integration

| Day | Deliverables |
| --- | --- |
| 19 | Indent request API + mobile "Request Stock" screen |
| 20 | Outbound integration: push new indents into Indent Easy |
| 21 | Inbound GRN/issue webhook → inventory credit; reconciliation polling job |
| 22 | Indent status screens (mobile + admin); integration test against Indent Easy staging |

**Risk:** if Indent Easy cannot expose an API in time, fall back to a scheduled file bridge
(SRS §17.2). Decide by Day 19, not Day 22.

## Phase 6 — Days 23–25 · Mobile polish

| Day | Deliverables |
| --- | --- |
| 23 | Full 6-step AI flow UI to design system (palette, Lexend/Quicksand, progress indicator) |
| 24 | Hindi toggle; empty/error/offline states; push notifications for indent status |
| 25 | Mobile QA: device matrix, low-connectivity simulation, Sentry wired in |

## Phase 7 — Days 26–28 · Admin dashboard & reports

| Day | Deliverables |
| --- | --- |
| 26 | Dashboard summary + trend endpoints with pre-aggregation; Chart.js UI in palette theme |
| 27 | Mait leaderboard, MPP coverage, exception views (pending payments, low stock, stale indents) |
| 28 | CSV/Excel export across all report views; admin UI polish and responsive pass |

## Phase 8 — Days 29–30 · Hardening, UAT & go-live

| Day | Deliverables |
| --- | --- |
| 29 | Full regression + security pass (RBAC, PII masking, rate limiting); load test; UAT with business on production-like data |
| 30 | UAT bug fixes, production deployment, Swagger/Redoc published, go-live checklist signed off, hypercare monitoring live |

Checklist: [`DEPLOYMENT.md`](DEPLOYMENT.md#go-live-checklist-srs-12-day-30).

---

## Scope guard

The timeline is aggressive for a three-platform build; SRS §17.2 acknowledges this. If a phase
slips, protect the core loop — **AI capture + inventory gating + payment** — and let reporting
depth (Phase 7 beyond the summary dashboard) move to a stabilisation sprint. Reporting can be
added after go-live without data loss. A missing inventory guarantee cannot be retrofitted,
because the events recorded without it are already wrong.
