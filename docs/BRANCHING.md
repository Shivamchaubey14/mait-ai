# Branching & release strategy

A trunk-plus-integration model. It is deliberately small: two long-lived branches, short-lived
work branches, and one release path. Everything else is a variation on those.

## Long-lived branches

| Branch | Deploys to | Protected | Description |
| --- | --- | --- | --- |
| `main` | **production** | Yes | Always deployable. Only receives merges from `release/*` and `hotfix/*`. Every merge is tagged `vX.Y.Z`. |
| `develop` | **staging** | Yes | Integration branch. All feature work merges here first. Auto-deploys to staging on merge. |

Nobody pushes directly to either. Both require a pull request.

## Short-lived branches

| Prefix | Cut from | Merges into | Use |
| --- | --- | --- | --- |
| `feature/` | `develop` | `develop` | New functionality |
| `fix/` | `develop` | `develop` | Bug fix that is not production-urgent |
| `chore/` | `develop` | `develop` | Tooling, deps, CI, refactors with no behaviour change |
| `docs/` | `develop` | `develop` | Documentation only |
| `release/` | `develop` | `main` **and** `develop` | Version stabilisation before a production cut |
| `hotfix/` | `main` | `main` **and** `develop` | Urgent production defect |

### Naming

```
<prefix>/<issue-number>-<short-kebab-summary>

feature/42-straw-scan-validation
fix/117-otp-attempt-counter-off-by-one
chore/58-bump-drf-3.15
release/1.2.0
hotfix/203-double-deduct-on-retry
```

Scope a branch to one issue. If it needs a second issue, it needs a second branch.

## Flow

```
                     tag v1.2.0
main ──────────────────────●────────────────●──────▶  production
                          ╱                ╱
             release/1.2.0                ╱ hotfix/203
                        ╱                ╱
develop ──●────●───────●────────────────●─────────▶  staging
          ╲   ╱ ╲     ╱
    feature/42  feature/51
```

1. Cut `feature/*` from an up-to-date `develop`.
2. Open a PR into `develop`. CI must be green and one review approving.
3. **Squash merge** into `develop`. The squash subject becomes the changelog line.
4. When the scope for a version is complete, cut `release/x.y.z` from `develop`. Only
   stabilisation commits land on it — bug fixes, version bumps, changelog.
5. PR the release branch into `main`. **Merge commit**, not squash — `main` keeps release
   granularity. Tag `vX.Y.Z`. Back-merge into `develop`.
6. Production deploy runs from the tag behind a manual approval gate.

### Hotfixes

Cut from `main`, PR back into `main`, tag a patch version, then immediately back-merge into
`develop` so the fix is not lost on the next release. A hotfix that is not back-merged is a
regression waiting for the next deploy.

## Merge strategy

| Target | Strategy | Why |
| --- | --- | --- |
| → `develop` | Squash | One reviewable unit per issue, clean history |
| → `main` | Merge commit | Preserves release boundaries |
| Hotfix → `main` | Squash | A hotfix is one logical change |

Rebase your branch on `develop` before merge rather than merging `develop` into it — keeps
the squash diff honest.

## Protection rules

Both `main` and `develop` are configured with:

- Pull request required before merging, with at least **1 approving review**
- Stale approvals dismissed when new commits are pushed
- **Conversation resolution required** before merge
- Required status checks passing (`backend`, `admin-web`, `mobile`, `security`)
- Force pushes and branch deletion blocked
- Linear-history enforcement on `develop`

`main` additionally requires the deploy environment's manual approval before production release.

## Versioning

[Semantic Versioning](https://semver.org/). Given the API is versioned separately under
`/api/v1/`, a breaking API change means both a major bump *and* a new API version path — the
old one stays live for the deprecation window.

| Bump | When |
| --- | --- |
| MAJOR | Breaking API change, or a migration that is not backward compatible with the running release |
| MINOR | New backward-compatible functionality (a completed SRS phase usually lands as a minor) |
| PATCH | Bug fixes, security patches, dependency bumps |

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <subject>

feat(ai-events): block completion when straw is not in Mait stock
fix(payments): reset OTP attempt counter on resend
chore(ci): cache pip wheels between runs
```

Types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`, `build`, `ci`, `revert`.
Scopes track the domain apps: `auth`, `masterdata`, `ai-events`, `inventory`, `payments`,
`indents`, `dashboard`, `mobile`, `admin-web`, `infra`, `ci`.
