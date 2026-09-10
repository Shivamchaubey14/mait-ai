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

### What carries a key (amended 2026-09-10)

The decision above was written for the AI event and is unchanged. Two more rows have since
needed the same protection, because both are now created in a yard with no signal:

| Row | Key | Replay |
| --- | --- | --- |
| `ai_event` | `client_uuid`, minted when the capture starts | `AIEventViewSet._replay` |
| `animal` | `client_uuid`, minted when the Mait fills the registration form | `AnimalViewSet._replay` |
| `non_member` | `client_uuid`, minted when the Mait fills the registration form | `NonMemberViewSet._replay` |
| `pregnancy_check` | `client_uuid`, minted when the outcome is tapped | unique column |

A duplicate non-member is the most expensive of the three: she is a farmer who can be asked for
cash a second time for one service, and once the round is over a duplicate is indistinguishable
from a second woman.

An animal's key is her own rather than the capture's, because she outlives it: she stays on
the farmer's roster after the insemination is closed, and a Mait who abandons the capture has
still registered the cow. A dropped response without it leaves the farmer with two identical
rows and the Mait with no way to tell them apart.

The AI event's photo `PATCH` carries no key of its own and is made replay-safe in the domain
instead — `photo_already_attached` answers a repeat with the event as it stands, the way
`complete` has always answered an already-completed one. Fingerprinting a multipart upload
would compare the bytes of a re-encoded JPEG, which is not a stable identity.

Two things follow for the handset. A row created offline has no server id, so the jobs behind
it name it by its local key and the drain fills in the real one once the create lands
(`api/queue`'s `rememberServerId`). And because the create and the jobs behind it are routinely
sent by different runs of the app, that translation lives on disk rather than in the drain.

## Alternatives considered

**Server-issued keys** — requires a round trip before the work can be queued, which defeats the
purpose in an offline-first flow.

**Natural-key deduplication** (mait + straw + timestamp) — no extra table, but timestamps drift
on field devices and the straw number is not yet known at draft creation.
