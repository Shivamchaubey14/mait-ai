# Security policy

This platform holds Aadhaar numbers, PAN numbers and bank details for 105,000+ dairy members
and their field agents. Treat every security question as if that data is already at stake,
because it is.

## Reporting a vulnerability

**Do not open a public GitHub issue.**

Email the engineering lead directly with:

- What you found and where
- Steps to reproduce
- What an attacker could reach with it
- Anything you have on remediation

Expect acknowledgement within **2 business days** and an initial assessment within **5**.
Please give us a reasonable window to ship a fix before disclosing anywhere else.

## Controls in place

Implements SRS §16.

| Area | Control |
| --- | --- |
| Authentication | JWT, ~15-minute access tokens, rotating refresh tokens, refresh blacklisted on logout |
| Authorisation | RBAC enforced at the API layer on every endpoint — never only hidden in the UI |
| PII at rest | Aadhaar, PAN and bank fields Fernet-encrypted; key held in the secret store, never in the database or repo |
| PII in transit | TLS 1.2+ everywhere; masked (last-4 only) in standard API responses |
| PII full access | One restricted admin endpoint, every read written to `audit_log` |
| OTP abuse | Rate-limited per mobile number and per IP; 5-minute expiry; 3 attempts before forced resend |
| Cross-Mait tampering | Straw and photo endpoints verify the acting Mait is actually assigned to the MPP in the request |
| Webhooks | Indent Easy callback authenticated by HMAC signature — never open unauthenticated |
| Audit | Immutable trail on every master-data change, AI event transition and payment verification |
| Dependencies | `pip-audit` and `npm audit` on every PR; Dependabot for updates |
| Containers | Trivy image scan in CI; non-root runtime user; HIGH/CRITICAL blocks the deploy |
| Static analysis | CodeQL on every PR and on a weekly schedule |
| Secret scanning | GitHub secret scanning with push protection enabled |

## Rules for contributors

**Never commit:** SAP exports, database dumps, `.env` files, API keys, signing keystores,
or anything with real member data. `.gitignore` blocks the common shapes, but it is a
backstop, not the control.

**If a secret is committed:** rotate it first, then rewrite history. In that order. A rotated
secret in git history is an embarrassment; an un-rotated one removed from history is still
compromised — it was public, and it may have been indexed the moment it was pushed.

**Logging:** never log OTP codes, JWTs, Aadhaar/PAN/bank numbers, or full request bodies from
the payment and master-data endpoints. Log identifiers, not payloads.

**New endpoints** need an explicit permission class. There is no default-allow. If you are
unsure which role should reach it, that is a question for review, not a `AllowAny` placeholder.

**The `FIELD_ENCRYPTION_KEY` is unrecoverable.** Lose it and every encrypted PII column
becomes permanently unreadable. It is backed up in the secret manager; do not treat any other
copy as authoritative, and never move it into the repo "temporarily".

## Supported versions

Only the latest production release receives security updates. There is no long-term support
branch during the initial build.
