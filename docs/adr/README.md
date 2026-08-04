# Architecture decision records

Short documents capturing decisions with lasting consequences — the ones where "why is it like
this?" would otherwise be answered by guesswork six months from now.

Write one when a decision is hard to reverse, constrains future work, or was chosen over a
credible alternative someone will propose again.

Format: `NNNN-short-title.md`, using [`template.md`](template.md).

| ADR | Title | Status |
| --- | --- | --- |
| [0001](0001-monorepo-over-three-repositories.md) | Monorepo over three repositories | Accepted |
| [0002](0002-inventory-gating-via-database-locks.md) | Enforce the inventory invariant with database locks | Accepted |
| [0003](0003-client-generated-idempotency-keys.md) | Client-generated UUIDs as idempotency keys | Accepted |
