# 0002. Enforce the inventory invariant with database locks, not application checks

**Status:** Accepted
**Date:** 2026-08-04

## Context

SRS §6.4 is the project's core promise: a Mait holding 10 straws can complete exactly 10 AI
events. The mobile app is explicitly offline-tolerant and retries on reconnect (§6.3.2), so
duplicate and concurrent completion requests are not an edge case — they are the normal
operating mode in poor connectivity.

An application-level "if balance greater than zero" check is a textbook race. Two requests read
a balance of 1, both pass, both decrement, and stock goes to -1. The straw is physically
single-use, so the database now disagrees with reality and no report built on it can be trusted.

## Decision

Three layers, all required:

1. `SELECT ... FOR UPDATE` on the Mait's inventory row inside the completion transaction, so
   concurrent completions serialise at the database.
2. A `qty_available >= 0` check constraint on the table, so no code path — including a future
   bug, a management command or a manual query — can drive stock negative.
3. Idempotency keys on `POST /ai-events/{id}/complete/`, so a retry returns the original
   response instead of executing a second deduction.

## Consequences

The invariant holds under concurrency and under retry, and it holds against code that has not
been written yet, which is the part application checks cannot promise.

The cost is a row lock held for the duration of the completion transaction. That transaction
must therefore stay small: no S3 uploads, no SMS dispatch, no external HTTP calls inside it.
Those happen before completion or asynchronously after. Lock contention is per-Mait, and a
single Mait does not perform two inseminations simultaneously, so real-world contention is near
zero — the locking exists for the retry storm, not for throughput.

This also constrains the database to MySQL 8 with InnoDB. Moving to a store without row-level
locking would mean redesigning this guarantee.

## Alternatives considered

**Optimistic locking with a version column** — works, but turns every conflict into a client-side
retry, which is unpleasant precisely when the network is bad.

**Application-level check only** — simplest, and wrong. Rejected outright.

**Serialising completions through a queue** — correct, but it makes completion asynchronous, so
the Mait cannot be told immediately whether their event succeeded. Unacceptable for a field
worker standing in front of a farmer waiting to be paid.
