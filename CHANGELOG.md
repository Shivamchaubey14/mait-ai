# Changelog

All notable changes to this project are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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
