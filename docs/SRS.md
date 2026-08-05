# Software Requirements Specification

## Mait AI — Artificial Insemination Field Operations Platform

Admin Web Portal · Mait Mobile App (React Native) · DRF API Backend · Indent Easy Integration

**Prepared for:** Shwetdhara Milk Producer Company
**Document Version:** 1.0
**Date:** 04 August 2026
**Classification:** Internal / Confidential

### Document control

| Version | Date        | Author                | Description                                                                                          | Status           |
| ------- | ----------- | --------------------- | ---------------------------------------------------------------------------------------------------- | ---------------- |
| 1.0     | 04-Aug-2026 | Product & Engineering | Initial production-grade SRS covering backend, mobile, web admin, integration and 30-day build plan. | Draft for Review |

---

## 1. Introduction

### 1.1 Purpose

This document specifies the functional, technical and non-functional requirements for the
Mait AI platform — a system that digitises the end-to-end Artificial Insemination (AI)
service delivered by field agents ("Maits") to dairy members and non-members under the MPP
(Milk Producer Pool/Parlour) network of Shwetdhara Milk Producer Company. It replaces the
current fully manual, paper-and-memory driven process with a role-based mobile app for
Maits, a comprehensive admin web portal, a documented REST API, and a live inventory link
to the existing Indent Easy web application.

### 1.2 Scope

The system covers three deliverables built together as one product:

- **Backend API** — Django REST Framework, MySQL, JWT-secured, OpenAPI/Swagger documented.
- **Mait Mobile App** — React Native, Android-first, used by field Maits to record AI
  events, request stock and collect payment.
- **Admin Web Portal** — HTML/CSS/JS with jQuery + AJAX, for SAP master-data upload,
  user/role management, inventory oversight and analytics dashboards.
- **Integration with Indent Easy** — the existing GRN/inventory web app, so Mait stock
  requests appear as indents there, and goods issued there sync back as the Mait's usable
  AI inventory.

**Out of scope:** replacement of Indent Easy itself, a farmer-facing member app, and
milk procurement/payment modules (handled by existing SAP/ERP systems).

### 1.3 Definitions, acronyms & abbreviations

| Term       | Meaning                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------- |
| AI         | Artificial Insemination — the field procedure a Mait performs on a cow/buffalo              |
| Mait       | Field technician/agent (the "Sahayak" in SAP MPP data) who performs AI and collects payment |
| MPP        | Milk Producer Pool/Parlour — the village-level collection point a Member/Mait is mapped to  |
| Sahayak    | SAP term for the vendor-coded field agent linked to an MPP; maps to "Mait" in this app      |
| Member     | A registered dairy producer in the SAP Member Master (has Member Code, Folio No.)           |
| Non-Member | A farmer without SAP membership who still avails AI service; captured directly in-app       |
| Straw      | Single-use frozen semen unit identified by a unique number, consumed per AI                 |
| GRN        | Goods Receipt Note — inventory receipt entry recorded in Indent Easy                        |
| Indent     | A stock request raised by a Mait for straws/consumables, fulfilled via Indent Easy          |
| UTR        | Unique Transaction Reference — bank reference number for a successful online payment        |
| COD        | Cash on Delivery — cash payment collected in person, confirmed by OTP                       |
| JWT        | JSON Web Token — used for stateless API authentication                                      |
| DRF        | Django REST Framework — backend API framework                                               |

### 1.4 Stakeholders

| Role                     | Interest in the system                                                           |
| ------------------------ | -------------------------------------------------------------------------------- |
| Mait (Field Agent)       | Primary mobile app user — records AI, requests stock, collects payment           |
| Admin / Back-office      | Uploads SAP master data, manages users, monitors dashboards, resolves exceptions |
| Company Management       | Consumes dashboards/reports for AI volume, coverage and revenue trends           |
| Indent Easy (Store User) | Issues goods against Mait indents; existing system, integrated not replaced      |

---

## 2. Current state — "as-is" manual process

Today the entire workflow is manual and phone/memory driven, which is the root cause of
the mis-reporting, disputed payments and stock leakage this project is meant to fix:

1. A Member or Non-Member calls a Mait requesting AI service.
2. The Mait travels to the MPP that the caller belongs to (or the nearest MPP for a non-member).
3. If the caller is a Member, the Mait manually looks up the MPP, then the Member name.
4. The Mait notes the animal type (COW/BUFF) and breed/category (e.g. Gir, Sahiwal, H.F.
   for cows; Murrah, Jafrabadi for buffalo).
5. The Mait records the ear-tag number if the animal has one.
6. The Mait notes the unique number printed on the semen straw used.
7. The Mait takes a photo as proof of performing the AI.
8. Payment is collected: an OTP is (informally) expected to go to the Member's mobile; if
   paid online the Mait takes a screenshot of the payment and notes the UTR number; if COD,
   a confirmation OTP is expected before the cash is accepted as settled.

Because none of this is captured digitally in real time, there is no single source of truth
for how many straws a Mait actually has left, whether the ear-tag/animal on record matches
history, whether payment was truly verified, or how many AIs were performed company-wide in
a given month.

---

## 3. Proposed solution overview

The proposed system digitises every step above as a guided, validated flow, and connects it
to real inventory so a Mait physically cannot record more AIs than they have straws for.

### 3.1 System components

| Component              | Platform                                    | Primary users                    | Core job                                                                         |
| ---------------------- | ------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------- |
| Backend API            | Django REST Framework + MySQL, JWT, OpenAPI | All clients                      | Single source of truth: master data, AI events, inventory, payments              |
| Mait Mobile App        | React Native (Android/iOS)                  | Maits                            | Guided AI capture flow, stock indent, payment collection, offline-tolerant queue |
| Admin Web Portal       | HTML/CSS/JS + jQuery/AJAX                   | Admin / back-office / management | SAP data upload, user & MPP management, dashboards, reports                      |
| Indent Easy (existing) | Existing web app                            | Store users                      | GRN entry and goods issue against Mait indents — integrated via API/webhook      |

### 3.2 High-level architecture

Layered architecture; all client apps talk only to the DRF API layer over HTTPS/JWT.

| Layer              | Contents                                                                                                        |
| ------------------ | --------------------------------------------------------------------------------------------------------------- |
| Client             | Mait Mobile App (React Native) · Admin Web Portal (HTML/CSS/JS/jQuery) · Indent Easy (external)                 |
| API gateway / edge | Nginx reverse proxy · TLS termination · rate limiting · gzip                                                    |
| Application        | Django + DRF services: Auth, Master Data, AI Event, Inventory, Payment, Indent, Dashboard, Notification         |
| Async / jobs       | Celery + Redis — SAP bulk import, SMS/OTP dispatch, report generation, Indent Easy sync                         |
| Data               | MySQL 8 (primary OLTP) · Redis (cache, OTP, Celery broker) · S3-compatible object storage (photos, screenshots) |
| Integration        | Indent Easy REST/webhook connector · SMS/OTP gateway (MSG91/Twilio) · Payment gateway webhook (optional)        |

### 3.3 Guiding principles

- **Inventory is the gate.** A Mait cannot start an AI event for a straw they do not hold in
  verified stock; completing an event decrements stock atomically.
- **Every AI event is auditable end-to-end:** who, where (MPP/GPS), which animal, which
  straw, which photo, which payment proof.
- **SAP remains the master** for Member/Mait/MPP identity; this app is an operational layer
  on top, refreshed via periodic admin uploads.
- **Mobile-first, low-connectivity tolerant:** the app queues AI events locally and syncs
  when network returns.

---

## 4. Technology stack

| Layer                | Technology                                                                                                                                                      |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend / API        | Python 3.12, Django 5.x, Django REST Framework, drf-spectacular (OpenAPI 3.0 + Swagger/Redoc), SimpleJWT                                                        |
| Database             | MySQL 8.0 (utf8mb4), Redis 7 (cache, OTP store, Celery broker)                                                                                                  |
| Async jobs           | Celery, Celery Beat (scheduled reports), Flower (monitoring)                                                                                                    |
| Mobile app           | React Native (TypeScript), React Navigation, Redux Toolkit + RTK Query, React Native Camera/ML Kit (barcode/QR straw scan), AsyncStorage/SQLite (offline queue) |
| Admin web portal     | HTML5, CSS3, vanilla JS + jQuery, AJAX to DRF APIs, Chart.js dashboards, Bootstrap 5 grid utilities (customised to design system)                               |
| Auth & security      | JWT (access + refresh), OTP (mobile) for payment steps, RBAC, HTTPS everywhere                                                                                  |
| File / media storage | S3-compatible object storage (AWS S3 or MinIO), served via signed URLs                                                                                          |
| API docs             | OpenAPI 3.0 auto-generated by drf-spectacular; Swagger UI (`/api/docs/`), Redoc (`/api/redoc/`)                                                                 |
| CI/CD                | GitHub Actions, Docker, Docker Compose (dev), Kubernetes or Docker Swarm (prod), Nginx + Gunicorn                                                               |
| Testing              | PyTest + pytest-django, DRF APITestCase, Jest + React Native Testing Library, Cypress (admin web E2E)                                                           |
| Monitoring           | Sentry (errors), Prometheus + Grafana (metrics), ELK / CloudWatch (logs)                                                                                        |

---

## 5. User roles & permissions

| Role                   | Access                                                                                                    |
| ---------------------- | --------------------------------------------------------------------------------------------------------- |
| Super Admin            | Full system access: user management, SAP uploads, all dashboards, system configuration                    |
| Admin / Back-office    | SAP uploads, MPP/Mait management, dashboards, exception handling; cannot change system config             |
| Mait                   | Mobile app only: record AI events at their assigned MPP(s), raise indents, view own inventory and history |
| Indent Easy Store User | Existing role, unchanged — sees Mait indents inside Indent Easy and performs GRN/issue                    |

---

## 6. Functional requirements

### 6.1 Master data upload (SAP import) — admin web

Admin uploads three periodic SAP exports; the platform parses, validates and upserts them
into its own MySQL tables. Files observed for scoping: Member Master (105,484 rows / 54
columns), Maits/Vendor Master, and MPP/Sahayak Master.

- **FR-6.1.1** — Admin can upload `.xlsx` files for Member, Mait (Vendor), and MPP
  (Sahayak) masters independently.
- **FR-6.1.2** — System auto-detects the header row, validates required columns, and rejects
  the file with a clear error list if mandatory columns are missing.
- **FR-6.1.3** — Each row is upserted by natural key — Member Code for members,
  Sahayak/Customer ID for Maits, MPP Code for MPPs — so re-uploads refresh existing records
  instead of duplicating.
- **FR-6.1.4** — Invalid rows (bad mobile format, missing MPP reference, duplicate ear-tag)
  are skipped and listed in a downloadable error report; valid rows still commit.
- **FR-6.1.5** — Every upload is logged (file name, uploader, timestamp, row counts, status)
  and visible in an upload history screen.
- **FR-6.1.6** — Large files (≈28 MB / 100k+ rows) are processed asynchronously via a Celery
  job with a progress/status endpoint, never inline on the request.

### 6.2 MPP & Mait assignment

- **FR-6.2.1** — Each MPP record carries its geo hierarchy
  (State/District/Tehsil/Panchayat/Village/Hamlet) and its assigned Mait.
- **FR-6.2.2** — Admin can reassign a Mait to a different/additional MPP, overriding the
  SAP-derived default.
- **FR-6.2.3** — A Mait's mobile app only shows Members and MPPs from their assigned MPP list.

### 6.3 Mait mobile app — AI event capture flow

Mirrors the manual flow, made mandatory and validated at each step:

1. **Select MPP** — auto-filtered to the Mait's assigned MPPs, searchable if they cover several.
2. **Choose Member or Non-Member** — if Member, search/select from that MPP's member list
   (name, member code, mobile); if Non-Member, quick-capture form (name, mobile, address)
   saved for reuse.
3. **Select or add the Animal** — Animal Type (COW/BUFF) → Breed/Category (config-driven,
   admin-editable) → Ear Tag (optional, validated unique if entered).
4. **Scan or enter the straw's unique number** — validated against the Mait's own current
   inventory and not already consumed; rejected with a clear reason ("not in your stock" /
   "already used").
5. **Capture the AI proof photo** through the in-app camera (gallery uploads disabled to
   prevent stale/reused images); photo is geo/time-stamped.
6. **Proceed to payment** (see 6.5).
7. On payment confirmation the AI event is marked Completed and the straw is deducted from
   the Mait's inventory in the same transaction.

- **FR-6.3.1** — Every step is a discrete, resumable stage; an interrupted event is saved as a
  draft and can be resumed, never silently lost.
- **FR-6.3.2** — The app works offline for steps 1–6 (reference data synced locally at login);
  it queues completed drafts and syncs when connectivity returns, with duplicate-safe
  idempotency keys.

### 6.4 Inventory-gated AI limit

- **FR-6.4.1** — A Mait's available straw count is fetched at login and refreshed after every
  completed AI and every fulfilled indent.
- **FR-6.4.2** — If a Mait holds 10 straws, the app allows exactly 10 AI events to reach
  Completed; the 11th attempt is blocked at the straw-scan step with a message to raise a new
  indent.
- **FR-6.4.3** — Straw deduction and AI-event completion happen inside one atomic backend
  transaction, so a network retry can never double-deduct or double-count.

### 6.5 Payment flow

1. Mait selects payment mode: Online or COD.
2. System sends an OTP to the Member's registered mobile number to authorise the transaction.
3. Member reads the OTP to the Mait (or enters it directly); Mait enters it in-app; backend verifies.
4. **Online** — after OTP verification, Mait captures a screenshot of the payment and enters
   the UTR number; both are stored against the AI event.
5. **COD** — after the first OTP verification, cash is collected, and a second confirmation
   OTP is sent and verified to close the collection.
6. On successful verification, Payment status = Verified and the AI event advances to Completed.

- **FR-6.5.1** — OTPs expire after 5 minutes and allow a maximum of 3 verification attempts
  before requiring a resend.
- **FR-6.5.2** — All OTP sends/verifies are logged for audit and fraud review.
- **FR-6.5.3** — An AI event cannot be marked Completed while Payment status is Pending or Failed.

### 6.6 Indent (stock request) & Indent Easy integration

- **FR-6.6.1** — A Mait can raise an indent for straws (by breed) or consumables (gloves,
  sheaths, liquid nitrogen), specifying quantity.
- **FR-6.6.2** — The indent is pushed to Indent Easy via API/webhook and appears there as a
  pending request against that Mait.
- **FR-6.6.3** — When the Indent Easy store user performs GRN/issues goods, Indent Easy calls
  back this platform's webhook and the Mait's inventory is credited automatically.
- **FR-6.6.4** — The Mait can see indent status in-app: Requested → Approved → Issued (with
  quantities), and their live stock balance at all times.
- **FR-6.6.5** — If the callback is delayed or fails, a scheduled reconciliation job polls
  Indent Easy's GRN endpoint to catch up (at-least-once delivery, idempotent by indent reference).

### 6.7 Admin dashboard & reporting

- **FR-6.7.1** — Home dashboard shows AI events today / this week / this month / lifetime,
  with the current month vs. the same day last month.
- **FR-6.7.2** — Highest single day and highest single month AI counts to date, with the
  date/month called out.
- **FR-6.7.3** — Trend chart (daily/monthly) filterable by MPP, District and Mait.
- **FR-6.7.4** — Mait leaderboard — AI count and payment collection per Mait for a period.
- **FR-6.7.5** — MPP coverage view — members served vs. total members per MPP.
- **FR-6.7.6** — Exception views — pending payments, failed OTPs, low-stock Maits, stale indents.
- **FR-6.7.7** — CSV/Excel export for every list/report view.

### 6.8 User & access management

- **FR-6.8.1** — Admin can create/deactivate Mait and Admin accounts, and reset credentials.

> **Superseded 5 Aug 2026.** The MPP Operator role described in the original §5 does not
> exist in the organisation and has been removed from the platform. Everything an operator
> would have done is an Admin action.

- **FR-6.8.2** — Mait accounts are provisioned from the uploaded Mait/Vendor master
  (auto-suggested) and activated by Admin with a mobile number for OTP-based first login.
- **FR-6.8.3** — Full role-based access control enforced at the API layer, not just hidden in the UI.

---

## 7. Non-functional requirements

| Category          | Requirement                                                                                                                                                                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Performance       | API P95 < 400 ms for reads, < 800 ms for writes under 200 concurrent Maits; dashboard queries pre-aggregated, not computed live over raw events                                                                                                   |
| Scalability       | Stateless backend, horizontally scalable behind a load balancer; MySQL read replicas for reporting; supports 105k+ members without redesign                                                                                                       |
| Availability      | Target 99.5% uptime for the API during business hours; graceful offline mode on mobile                                                                                                                                                            |
| Security          | JWT with short-lived access tokens + rotating refresh tokens; OTP for payment-critical actions; encrypted at rest (DB, S3) and in transit (TLS 1.2+); role-based authorization on every endpoint; PII field-level encrypted and masked by default |
| Auditability      | Every AI event, payment, indent and master-data change has an immutable audit trail (actor, timestamp, before/after)                                                                                                                              |
| Usability         | Mobile flow completable by a semi-literate field user in under 5 taps per major step; large touch targets; Hindi support                                                                                                                          |
| Offline tolerance | Mobile functions through the AI-capture steps without connectivity; syncs on reconnect with conflict-safe idempotency                                                                                                                             |
| Data integrity    | Straw uniqueness, ear-tag uniqueness (when present) and inventory counts enforced via DB constraints + transactional logic, not application code alone                                                                                            |
| Maintainability   | OpenAPI-documented, versioned API (`/api/v1/...`); modular Django apps per domain; ≥80% backend test coverage on core transactional logic                                                                                                         |
| Compliance        | Aadhaar/PAN handling aligned with data-minimisation practice; consent capture for non-member data collection                                                                                                                                      |

---

## 8. Data model / database schema (MySQL)

Derived from the three SAP exports supplied plus the new operational entities this app
introduces. See [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) for the ERD.

### 8.1 Master data tables (from SAP uploads)

**`mpp`**

| Column                                                                            | Type                | Notes                    |
| --------------------------------------------------------------------------------- | ------------------- | ------------------------ |
| id                                                                                | BIGINT PK           | internal surrogate key   |
| plant_code                                                                        | VARCHAR(10)         | SAP Plant / BMC-MCC code |
| plant_name                                                                        | VARCHAR(100)        |                          |
| mpp_code                                                                          | VARCHAR(15) UNIQUE  | SAP MPP Code             |
| mpp_name                                                                          | VARCHAR(150)        |                          |
| mpp_category                                                                      | VARCHAR(20)         |                          |
| mpp_sub_category                                                                  | VARCHAR(20)         |                          |
| state_code, district_code, tehsil_code, panchayat_code, village_code, hamlet_code | VARCHAR(10) each    | geo hierarchy from SAP   |
| mobile_no                                                                         | VARCHAR(15)         | MPP contact number       |
| address_line                                                                      | VARCHAR(255)        |                          |
| is_active                                                                         | BOOLEAN             | from 'Active' flag       |
| start_date, end_date, revival_date                                                | DATE                |                          |
| mait_id                                                                           | BIGINT FK → mait.id | linked Sahayak/Mait      |

**`mait`**

| Column                     | Type                      | Notes                                    |
| -------------------------- | ------------------------- | ---------------------------------------- |
| id                         | BIGINT PK                 |                                          |
| user_id                    | BIGINT FK → users.id      | login identity, nullable until activated |
| sahayak_vendor_code        | VARCHAR(15) UNIQUE        | SAP Sahayak Vendor / Customer ID         |
| name                       | VARCHAR(150)              |                                          |
| mobile_no, mobile_no_alt   | VARCHAR(15)               |                                          |
| pan_no                     | VARCHAR(12)               | encrypted at rest                        |
| aadhar_no                  | VARCHAR(20)               | encrypted at rest, masked in API         |
| bank_account_no, ifsc_code | VARCHAR(30) / VARCHAR(15) | encrypted at rest                        |
| is_active                  | BOOLEAN                   |                                          |

**`member`**

| Column                                                         | Type                  | Notes                            |
| -------------------------------------------------------------- | --------------------- | -------------------------------- |
| id                                                             | BIGINT PK             |                                  |
| mpp_id                                                         | BIGINT FK → mpp.id    |                                  |
| member_code                                                    | VARCHAR(20) UNIQUE    | SAP Member code                  |
| member_name, father_husband_name                               | VARCHAR(150)          |                                  |
| gender, age, category, education, class                        | VARCHAR / TINYINT     | SAP demographic fields           |
| sap_vendor_code, form_no, folio_no                             | VARCHAR(20)           |                                  |
| mobile_no                                                      | VARCHAR(15)           | used for OTP                     |
| aadhar_no                                                      | VARCHAR(20)           | encrypted at rest, masked in API |
| cattle_holding                                                 | SMALLINT              |                                  |
| bank_ac_no, bank_name, bank_branch, ifsc_code                  | VARCHAR               |                                  |
| activation_status, activation_date, deactivation_date, remarks | VARCHAR / DATE / TEXT |                                  |

**`non_member`**

| Column             | Type                | Notes              |
| ------------------ | ------------------- | ------------------ |
| id                 | BIGINT PK           |                    |
| name               | VARCHAR(150)        |                    |
| mobile_no          | VARCHAR(15)         | used for OTP       |
| address            | VARCHAR(255)        |                    |
| mpp_id             | BIGINT FK → mpp.id  | nearest/served MPP |
| created_by_mait_id | BIGINT FK → mait.id |                    |
| created_at         | DATETIME            |                    |

### 8.2 Operational tables (new)

**`animal`**

| Column                    | Type                        | Notes                         |
| ------------------------- | --------------------------- | ----------------------------- |
| id                        | BIGINT PK                   |                               |
| owner_type                | ENUM('member','non_member') |                               |
| member_id / non_member_id | BIGINT FK, nullable         | exactly one populated         |
| animal_type               | ENUM('COW','BUFF')          |                               |
| breed                     | VARCHAR(30)                 | config-driven list            |
| ear_tag_no                | VARCHAR(20) UNIQUE NULL     | optional, unique when present |
| created_at                | DATETIME                    |                               |

**`semen_batch`**

| Column          | Type               | Notes                           |
| --------------- | ------------------ | ------------------------------- |
| id              | BIGINT PK          |                                 |
| unique_straw_no | VARCHAR(30) UNIQUE | printed unique number per straw |
| breed           | VARCHAR(30)        |                                 |
| bull_id         | VARCHAR(30)        |                                 |
| semen_station   | VARCHAR(100)       |                                 |
| received_date   | DATE               |                                 |

**`mait_inventory`** — current balance per Mait per product:
`id, mait_id, product_type, product_ref_id, qty_available, updated_at`

**`mait_inventory_ledger`** — immutable movement log:
`id, mait_inventory_id, txn_type ENUM('issue','consume','return'), qty, ref_type ENUM('indent','ai_event'), ref_id, created_at`

**`ai_event`**

| Column                               | Type                                                                                      | Notes                  |
| ------------------------------------ | ----------------------------------------------------------------------------------------- | ---------------------- |
| id                                   | BIGINT PK                                                                                 |                        |
| mait_id, mpp_id                      | BIGINT FK                                                                                 |                        |
| member_id / non_member_id            | BIGINT FK, nullable                                                                       | exactly one populated  |
| animal_id                            | BIGINT FK → animal.id                                                                     |                        |
| semen_batch_id, straw_unique_no      | BIGINT FK / VARCHAR                                                                       |                        |
| ai_photo_url                         | VARCHAR(255)                                                                              | S3 object path         |
| status                               | ENUM('draft','straw_verified','photo_captured','payment_pending','completed','cancelled') |                        |
| gps_lat, gps_lng                     | DECIMAL                                                                                   | captured at photo step |
| performed_at, created_at, updated_at | DATETIME                                                                                  |                        |

**`payment`**

| Column                                      | Type                                | Notes                     |
| ------------------------------------------- | ----------------------------------- | ------------------------- |
| id                                          | BIGINT PK                           |                           |
| ai_event_id                                 | BIGINT FK UNIQUE                    | 1:1 with ai_event         |
| amount                                      | DECIMAL(10,2)                       |                           |
| mode                                        | ENUM('ONLINE','COD')                |                           |
| member_otp_verified, member_otp_verified_at | BOOLEAN / DATETIME                  | step-1 authorisation OTP  |
| utr_number, payment_screenshot_url          | VARCHAR                             | ONLINE mode only          |
| cod_otp_verified, cod_otp_verified_at       | BOOLEAN / DATETIME                  | COD mode only, second OTP |
| status                                      | ENUM('pending','verified','failed') |                           |
| created_at                                  | DATETIME                            |                           |

**Supporting tables**

| Table           | Key columns                                                                                                                                                 |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| indent_request  | id, mait_id, product_type, qty_requested, qty_issued, status ENUM('requested','approved','issued','rejected'), indent_easy_ref_no, requested_at, updated_at |
| otp_log         | id, purpose ENUM('login','payment_online','payment_cod'), mobile_no, otp_code_hash, is_verified, attempt_count, expires_at, created_at                      |
| data_upload_log | id, upload_type ENUM('member','mait','mpp'), file_name, uploaded_by, total_rows, success_rows, failed_rows, status, uploaded_at                             |
| audit_log       | id, actor_id, action, entity_type, entity_id, meta_json, created_at                                                                                         |

---

## 9. API specification

Base URL `/api/v1/`. All endpoints except login/OTP-send require an
`Authorization: Bearer <JWT>` header. Full interactive documentation is auto-generated as an
OpenAPI 3.0 schema via drf-spectacular at `/api/schema/`, browsable at `/api/docs/`
(Swagger UI) and `/api/redoc/` (Redoc).

The complete endpoint table lives in [`docs/API_CONTRACT.md`](API_CONTRACT.md) — that file is
the frozen contract the three workstreams build against.

### 9.11 API conventions

- Versioned under `/api/v1/`; breaking changes ship as `/api/v2/` with the old version kept
  live for a deprecation window.
- **Pagination:** limit/offset with a consistent `{count, next, previous, results}` envelope
  on all list endpoints.
- **Errors:** RFC-7807-style JSON problem details —
  `{type, title, status, detail, errors: {field: [...]}}`.
- **Idempotency:** retryable write endpoints (AI event creation/completion, indent creation)
  accept an `Idempotency-Key` header.
- All list endpoints support field filtering and ordering via query params, documented
  per-endpoint in the OpenAPI schema.

---

## 10. UI/UX design system

Full spec: [`docs/DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md).

### 10.1 Typography

| Use                | Font                                                | Notes                                                                          |
| ------------------ | --------------------------------------------------- | ------------------------------------------------------------------------------ |
| Headings / display | Lexend                                              | Bold, modern, highly legible — app bar titles, section headers, dashboard KPIs |
| Body / UI text     | Quicksand                                           | Rounded, friendly — body copy, form labels, buttons                            |
| Fallback stack     | Lexend/Quicksand, -apple-system, Roboto, sans-serif | For web portal CSS                                                             |

### 10.2 Colour palette

| Hex       | Usage in UI                                     |
| --------- | ----------------------------------------------- |
| `#43637E` | Primary — headers, nav bar, primary buttons     |
| `#325E6A` | Primary Dark — app bar, headings, active states |
| `#8FA28A` | Secondary — backgrounds, success surfaces       |
| `#66BB6A` | Success — completed AI, payment success         |
| `#249D8F` | Success Alt — inventory OK, positive KPI        |
| `#BD4444` | Error — validation errors, low stock            |
| `#B34A44` | Error Dark — critical alerts                    |
| `#FFF449` | Warning — pending OTP, low straw count          |
| `#E98B50` | Accent — CTA buttons, highlights                |
| `#EC5B38` | Accent Alt — badges, tags                       |
| `#C8A96B` | Highlight — premium / featured MPP cards        |
| `#BA6A4C` | Highlight Alt — chart series                    |
| `#78A4CB` | Info — informational banners, links             |
| `#2C3639` | Text Dark — primary text on light bg            |
| `#524646` | Text Muted — secondary text, captions           |
| `#464858` | Neutral — borders, dividers, icons              |

### 10.3 Design principles

- Clean, modern, card-based layouts with generous spacing and rounded corners (8–16px radius).
- Status colour-coding consistent everywhere: green/teal = success or completed,
  yellow = pending/attention, red/maroon = error or blocked, sky blue = informational.
- Mobile favours large primary-action buttons (one clear next step per screen), a progress
  indicator across the 6-step AI flow, and camera-first capture (no gallery picker).
- Admin dashboards use Chart.js line/bar charts themed to the palette, teal/slate as primary
  chart colours, orange/coral reserved for alerts and highlighted series.
- Hindi/regional-language toggle on the mobile app given the semi-literate field user base.

---

## 11. AI event workflow & state machine

`ai_event.status` drives the mobile UI and gates every subsequent action.

| State             | Entered when                                                  | Allowed next action                         |
| ----------------- | ------------------------------------------------------------- | ------------------------------------------- |
| `draft`           | Mait picks MPP + Member/Non-Member + Animal                   | Scan straw                                  |
| `straw_verified`  | Straw number validated against Mait's stock & uniqueness      | Capture AI photo                            |
| `photo_captured`  | In-app camera photo uploaded with GPS/time stamp              | Initiate payment                            |
| `payment_pending` | Payment initiated, OTP(s) not yet fully verified              | Verify OTP(s) / upload UTR + screenshot     |
| `completed`       | Payment verified (Online: OTP+UTR+screenshot; COD: both OTPs) | Straw deducted; event closed and reportable |
| `cancelled`       | Mait or Admin aborts the draft before completion              | None — terminal, straw not deducted         |

This mirrors the manual flow end to end: MPP → Member/Non-Member → Animal type & breed →
ear tag → straw number → AI photo → payment (OTP → online proof / COD double-OTP) → done —
but every transition is validated server-side and cannot be skipped or backdated from the client.

---

## 12. 30-day development plan

Three parallel workstreams (Backend, Mobile, Admin Web) run against one shared API contract,
frozen at the end of Phase 1. Tracked in [`docs/ROADMAP.md`](ROADMAP.md).

| Phase | Days  | Focus                                                                                                                   |
| ----- | ----- | ----------------------------------------------------------------------------------------------------------------------- |
| 1     | 1–3   | Foundation — ERD & API contract, repo, branching, Docker Compose, CI skeleton, app shells                               |
| 2     | 4–8   | Master data & auth — SAP upload pipelines, OTP/password login, RBAC, user management                                    |
| 3     | 9–14  | Core AI event & inventory — animal config, straw validation, state transitions, photo, atomic completion, offline queue |
| 4     | 15–18 | Payments — OTP service, online UTR path, COD double-OTP path, completion linkage                                        |
| 5     | 19–22 | Indent & Indent Easy integration — outbound push, inbound GRN webhook, reconciliation                                   |
| 6     | 23–25 | Mobile polish — design system, Hindi toggle, offline/error states, QA pass                                              |
| 7     | 26–28 | Admin dashboard & reports — pre-aggregation, charts, leaderboards, exports                                              |
| 8     | 29–30 | Hardening, UAT & go-live — security pass, load test, deploy, hypercare                                                  |

---

## 13. Testing strategy

| Level                        | Approach & tools                                                                                                                                                        |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit                         | PyTest + pytest-django for models, serializers, business logic (straw deduction, OTP expiry, state transitions). ≥80% coverage on transactional/payment/inventory code. |
| API / integration            | DRF APITestCase per endpoint incl. auth, permission and error-path cases; contract tests against the OpenAPI schema.                                                    |
| Mobile                       | Jest + React Native Testing Library for components/screens; Detox (or Appium) for the end-to-end AI-capture flow on device/emulator.                                    |
| Admin web                    | Cypress E2E for upload flows, dashboard rendering and export actions.                                                                                                   |
| Concurrency / data integrity | Dedicated suite simulating parallel AI-completion requests against a low-stock Mait, proving atomic deduction never over-issues.                                        |
| Performance / load           | k6 or Locust on ai-events, payments and dashboard endpoints at 200 concurrent Maits.                                                                                    |
| Security                     | OWASP ZAP baseline scan, dependency vulnerability scanning (pip-audit / npm audit) in CI, manual RBAC/PII-masking review before go-live.                                |
| UAT                          | Business stakeholders run real MPP/Member scenarios on staging with production-like SAP data before go-live sign-off.                                                   |

---

## 14. CI/CD pipeline

GitHub Actions across three pipelines (backend, mobile, admin-web), each triggered on PR and
on merge to `main`:

1. Lint & static analysis (ruff/black/isort for Python, ESLint/Prettier for JS/TS).
2. Automated tests (unit + API) with MySQL/Redis service containers in the runner.
3. Build: Docker image for backend (multi-stage, non-root user); React Native release build
   (Android AAB, iOS archive); static asset bundle for the admin web portal.
4. Security scan: dependency audit + container image scan.
5. Deploy to staging automatically on merge to `main`; deploy to production via a manual
   approval gate after UAT sign-off.
6. Post-deploy smoke test (health check + one synthetic AI-event flow).
7. Django migrations run as a pre-deploy job with an automatic rollback plan if the
   post-deploy smoke test fails.

Environments: dev → staging → production, each with isolated MySQL, Redis and S3 buckets, and
separate JWT signing keys.

---

## 15. Deployment architecture

| Component               | Deployment                                                                                                     |
| ----------------------- | -------------------------------------------------------------------------------------------------------------- |
| API (Django + Gunicorn) | Dockerised, behind Nginx, horizontally scaled (2+ replicas) on Kubernetes/Docker Swarm                         |
| Celery workers & Beat   | Separate Dockerised worker pool for SAP imports, notifications, Indent Easy sync, report pre-aggregation       |
| MySQL                   | Managed MySQL 8 (RDS/Cloud SQL) with daily automated backups and a read replica for dashboards                 |
| Redis                   | Managed Redis for cache, OTP store and Celery broker                                                           |
| Object storage          | S3-compatible bucket for AI photos & payment screenshots, lifecycle-archived after N months                    |
| Admin web portal        | Static HTML/CSS/JS served via Nginx/CDN, calling the same API                                                  |
| Mobile app              | Play Store (internal track for pilot, production track for rollout); OTA config for API base URL               |
| Monitoring              | Sentry (errors), Prometheus/Grafana (metrics), centralized logs; uptime alerting on API and Celery queue depth |

---

## 16. Security considerations

- JWT access tokens short-lived (≈15 min) with rotating refresh tokens; refresh-token
  blacklist on logout.
- All PII (Aadhaar, PAN, bank account) encrypted at rest and masked (last-4 only) in standard
  API responses; full values only via a restricted, audit-logged Admin endpoint.
- OTP-gated actions rate-limited per mobile number and per IP.
- Straw/AI-photo endpoints validate that the acting Mait is actually assigned to the MPP in
  the request, preventing cross-Mait tampering.
- Indent Easy webhook authenticated via a signed API key/HMAC, never open unauthenticated.
- Full `audit_log` on every master-data change, AI event transition and payment verification.

---

## 17. Risks & assumptions

### 17.1 Assumptions

- SAP exports continue to be provided as periodic `.xlsx` files in the same column structure
  observed during scoping.
- An SMS/OTP gateway account (MSG91/Twilio) will be procured and credentials made available
  before Phase 4.
- Indent Easy exposes (or can be extended to expose) an API/webhook for indent intake and GRN
  callbacks; if not, Phase 5 shifts to polling-only.
- Field connectivity is intermittent but not fully absent — the offline queue assumes periodic
  reconnect, not permanent offline operation.

### 17.2 Risks & mitigations

| Risk                                                              | Mitigation                                                                                                                                   |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Indent Easy has no exposed API in time for Phase 5                | Fall back to a scheduled export/import file bridge; revisit real-time webhook post-launch                                                    |
| Large SAP files (100k+ rows) slow down uploads                    | Async Celery processing with chunked bulk-upsert and progress polling, never a synchronous request                                           |
| Field users struggle with a fully digital flow                    | Camera-first, large-button UI, Hindi toggle, phased pilot with one district before full scale-up                                             |
| Duplicate/near-duplicate ear tags or straw numbers across regions | DB-level uniqueness constraints plus a fuzzy-duplicate warning (not a hard block) at data entry                                              |
| 30-day timeline is aggressive for a 3-platform build              | Parallel workstreams against a Day-3 frozen API contract; MVP prioritises the core AI + payment + inventory loop over nice-to-have reporting |

---

## 18. Appendix

### 18.1 Source data reference (as supplied)

| File                | Rows × Cols (observed) | Key fields used                                                                                      |
| ------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------- |
| Member.xlsx         | 105,484 × 54           | MPP, Member code, Member name, Mobile No, Aadhar No, Cattle Holding, Bank details, Activation status |
| Maits_Vendor_C.xlsx | 61 × 23                | Customer ID, Name, Contact Number, PAN/Aadhar/GST, Bank Key, Account Number                          |
| Sahyak.xlsx         | 3,134 × 25             | MPP Code, MPP Name, geo hierarchy, Sahayak Vendor, Sahayak Name, Mobile, Bank details                |

Field names above are drawn directly from the uploaded SAP exports and used as the basis for
the schema in Section 8. Final production mapping should be reconfirmed against the live SAP
export at build time in case of column drift between periods.

> **Note:** the source `.xlsx` files contain PII and are excluded by `.gitignore`. They are
> never committed to this repository.

### 18.2 Open items for business confirmation

1. Confirm the authoritative breed list per animal type (COW/BUFF) for the config-driven dropdown.
2. Confirm per-AI service pricing (fixed, per-breed, or per-MPP) to drive the payment amount.
3. Confirm SMS/OTP gateway vendor and budget.
4. Confirm whether Indent Easy can expose a webhook, or only file-based exchange is possible.
5. Confirm data retention period for AI photos and payment screenshots.
