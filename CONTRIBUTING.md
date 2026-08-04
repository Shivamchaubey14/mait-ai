# Contributing

## Before your first pull request

1. Read [`docs/BRANCHING.md`](docs/BRANCHING.md) and [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
2. Get the stack running: `make up && make migrate`.
3. Install the pre-commit hooks: `pre-commit install`. CI runs the same checks, so this
   catches failures before they cost a round trip.

## Workflow

```bash
git checkout develop && git pull
git checkout -b feature/42-straw-scan-validation

# work, commit in Conventional Commits format
make lint test

git push -u origin feature/42-straw-scan-validation
gh pr create --base develop
```

Every PR needs a linked issue, green CI, and one approving review. Merges into `develop` are
squashed.

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org/), because the changelog and the
version bump are generated from them:

```
feat(ai-events): block completion when straw is not in Mait stock
fix(payments): reset OTP attempt counter on resend
chore(ci): cache pip wheels between runs
```

Types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`, `build`, `ci`, `revert`.
Scopes: `auth`, `masterdata`, `ai-events`, `inventory`, `payments`, `indents`, `dashboard`,
`mobile`, `admin-web`, `infra`, `ci`.

Breaking changes get a `!` and a `BREAKING CHANGE:` footer explaining the migration path.

## Code standards

### Backend (Python)

- **Ruff** for linting and import sorting, **Black** for formatting, line length 100.
- Type hints on every public function and all service-layer code.
- Business logic lives in `services.py`, not in views or serializers. Views handle HTTP;
  services handle rules. This is what makes the logic testable and reusable from Celery tasks.
- Every model change ships with its migration in the same commit.
- No raw SQL without a comment explaining why the ORM was not sufficient.

### Mobile (TypeScript)

- **ESLint** + **Prettier**, strict TypeScript, no `any` without a comment justifying it.
- API access goes through RTK Query only — no bare `fetch` in components.
- No user-facing string hardcoded in a component; everything through `src/i18n/`.
- Anything that writes to the server must be safe to retry.

### Admin web (JS)

- ESLint + Prettier. Vanilla JS + jQuery per SRS §4 — no framework creep.
- All colours and fonts through the tokens in `assets/css/tokens.css`. No inline hex.

## Testing

New code needs tests. Non-negotiable for the transactional core — inventory deduction, payment
state transitions, OTP verification, AI event transitions — which carries a **≥80% coverage
floor enforced in CI** (SRS §7).

```bash
make test               # everything
make test-backend       # pytest
make test-mobile        # jest
```

When you touch inventory or payments, add a concurrency case. The failure mode that matters is
not "does it work", it is "does it still hold when two requests arrive at once".

## Pull request expectations

- Scoped to one issue. A PR that fixes a bug *and* refactors a module gets split.
- Description explains **why**, not just what — the diff already says what.
- Screenshots or a recording for any UI change.
- Migrations called out explicitly, with a note on backward compatibility
  ([`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md#migration-discipline)).
- API changes update `docs/API_CONTRACT.md` and regenerate `backend/openapi.yaml` in the same
  PR. CI fails on schema drift.

## Reviewing

Review for correctness first, then clarity, then style — style is largely automated, so if
you are commenting on formatting the tooling has a gap worth fixing instead.

Approve when you would be comfortable being paged for it at 2am. Blocking comments should say
what would change your mind.

## Data safety

**Never commit SAP exports, database dumps, or anything containing member PII.** `.gitignore`
blocks `*.xlsx`, `*.csv` and `*.sql`, but the rule matters more than the mechanism. Use
generated fixtures for tests: `make seed`.

If you commit a secret, rotate it first, then rewrite history. Rotating second is how leaked
credentials get used.
