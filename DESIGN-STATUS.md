# Design status — dsh-piblox-discord

**STATUS:** V1 SPIKE + RELIABILITY LAYER IMPLEMENTED (FakeTransport) / NOT PRODUCTION-ACTIVATED  
**TRANSPORT_DECISION:** **LOCKED_DIRECT_DISCORDJS**  
**TRANSPORT_DECISION_READY:** **YES**  
**READY_FOR_IMPLEMENTATION:** **YES**  
**V1_SPIKE:** **PASS**  
**RELIABILITY_SPIKE:** **PASS** (2026-09-09)

Statuses: `LOCKED` | `IMPLEMENTED` | `TESTED` | `DESIGNED_FOR_LIVE` | `PROPOSED` | `OPEN` | `BLOCKED` | `LATER`

| DECISION | STATUS | EVIDENCE |
|---|---|---|
| Generic Discord provider | LOCKED | ADR-0001 |
| Cordis first-party plugin | LOCKED + IMPLEMENTED | `src/index.js` |
| Multi-account `0..N` | LOCKED + TESTED | lifecycle + outbox isolation |
| Direct `discord.js` 14.27.0 | LOCKED + IMPLEMENTED | package pin; skeleton only |
| FakeTransport | IMPLEMENTED + TESTED | reliability fixtures |
| Durable outbox JSON ledger | **IMPLEMENTED + TESTED** | ADR-0011 |
| State machine + crash recovery | **IMPLEMENTED + TESTED** | `sending`→`queued` |
| 429 Retry-After | **IMPLEMENTED + TESTED** | FakeClock |
| 5xx / backoff / max attempts | **IMPLEMENTED + TESTED** | |
| Terminal permission / auth isolate | **IMPLEMENTED + TESTED** | |
| operation_id dedupe + nonce/enforce_nonce | **IMPLEMENTED + TESTED** | |
| Multi-step groups | **IMPLEMENTED + TESTED** | Atlas scenario |
| Delivery receipts | **IMPLEMENTED + TESTED** | `toReceipt` |
| Live Discord rate-limit buckets | DESIGNED_FOR_LIVE | DiscordJsTransport contract helper |
| Live Gateway/REST | BLOCKED / LATER | no token |
| Binding encoding | LOCKED | ADR-0010 |
| MessageSource.kind `user` | LOCKED | |
| Session bridge | LOCKED + TESTED | |
| Profile activation | BLOCKED | operator authorize |
| Full Components V2 renderer | LATER | kinds reserved |
| Inbound dedupe TTL store | PROPOSED | |
| approvalChannel | V2 / non-blocking | |

## Reliability call graph (TESTED)

```text
producer
  → outbox.enqueue / enqueueGroup
  → durable discord-outbox.json
  → outbox.tick (FakeClock)
  → FakeTransport.send|reply|edit|createThread
  → delivery receipt (queued|retry_wait|delivered|failed_terminal)
```
