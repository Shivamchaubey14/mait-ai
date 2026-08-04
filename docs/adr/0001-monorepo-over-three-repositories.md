# 0001. Monorepo over three repositories

**Status:** Accepted
**Date:** 2026-08-04

## Context

SRS §12 has three workstreams — backend, mobile, admin web — building in parallel against one
API contract frozen on Day 3, on a 30-day timeline. The API surface will move during the build
despite the freeze, because contracts always do at the edges.

## Decision

One repository containing all three workstreams, with independent CI pipelines scoped by path
filter so a mobile change does not run the Django test suite.

## Consequences

An API change and its two client updates land in one atomic, reviewable pull request. There is
no version-skew window where the contract file says one thing and a client repo pinned to an
older commit says another. `docs/API_CONTRACT.md` has exactly one copy.

The cost: CI configuration is more involved than three simple repos, checkouts are larger, and
per-workstream access control is coarser — anyone with write access can touch any workstream.
For a team building three tightly coupled halves of one product in 30 days, that trade is
clearly worth it. It would not be for three independently released products.

Splitting later is straightforward with `git filter-repo`. Merging three repos into one after
they have diverged is not.

## Alternatives considered

**Three repositories** — cleaner ownership boundaries and lighter CI, but every contract change
becomes a cross-repo choreography with a skew window in the middle. On this timeline that is
the dominant risk.

**Two repositories** (backend + combined frontend) — splits the difference and inherits the skew
problem anyway, since the backend is the side that moves.
