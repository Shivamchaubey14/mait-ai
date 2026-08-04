# 0003. Client-generated UUIDs as idempotency keys for offline sync

**Status:** Accepted
**Date:** 2026-08-04

## Context

SRS §6.3.2 requires the mobile app to queue AI events locally and sync when connectivity
returns. A field Mait may capture several events with no signal, then reconnect on a moving bus
and lose the connection mid-drain. Requests will be sent whose responses never arrive, and the
client cannot distinguish "the server never got it" from "the server processed it and the
response was lost".

## Decision

The client generates a UUIDv4 when it creates a local draft, before any network attempt. That
UUID is the event's local primary key and the `Idempotency-Key` header on every write for that
event. The server stores key to response for 24 hours and replays the stored response on a
repeat.

## Consequences

The client can retry blindly, which is the only retry strategy that is actually reliable when
the network is unpredictable. It never has to reason about whether a request went through.

Because the key is generated before the first send, it survives app restarts and crashes — a
server-issued key would be lost in exactly the failure it is meant to protect against.

The cost is an `idempotency_record` table that needs periodic pruning, and a subtlety worth
stating: the stored response is replayed verbatim. If a completion succeeded and inventory
later changed, the replay still returns the original success. That is correct — it describes
what happened at the time — but it means clients must refresh inventory from
`GET /mait/inventory/` after a sync rather than inferring it from replayed responses.

A client that reuses a key for genuinely different content is a client bug. The server detects
the payload mismatch and returns `422` rather than silently serving the wrong response.

## Alternatives considered

**Server-issued keys** — requires a round trip before the work can be queued, which defeats the
purpose in an offline-first flow.

**Natural-key deduplication** (mait + straw + timestamp) — no extra table, but timestamps drift
on field devices and the straw number is not yet known at draft creation.
