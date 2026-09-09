# Design status — dsh-piblox-discord

**STATUS:** V1 TRANSPORT CLOSURE PASS (FakeTransport) / LIVE_DISCORD_READY=YES (dev-bot smoke ready, not prod)  
**TRANSPORT_DECISION:** **LOCKED_DIRECT_DISCORDJS**  
**TRANSPORT_DECISION_READY:** **YES**  
**READY_FOR_IMPLEMENTATION:** **YES**  
**V1_SPIKE:** **PASS**  
**RELIABILITY_SPIKE:** **PASS** (2026-09-09)  
**TRANSPORT_CLOSURE:** **PASS** (2026-09-09)  
**ALL_NORMAL_OUTBOUND_VIA_OUTBOX:** **LOCKED**  
**LIVE_DISCORD_READY:** **YES** (controlled dev-bot smoke only — **not** production activation)

Statuses: `LOCKED` | `IMPLEMENTED` | `TESTED` | `DESIGNED_FOR_LIVE` | `PROPOSED` | `OPEN` | `BLOCKED` | `LATER`

| DECISION | STATUS | EVIDENCE |
|---|---|---|
| Generic Discord provider | LOCKED | ADR-0001 |
| Cordis first-party plugin | LOCKED + IMPLEMENTED | `src/index.js` |
| Multi-account `0..N` | LOCKED + TESTED | lifecycle + outbox isolation |
| Direct `discord.js` 14.27.0 | LOCKED + IMPLEMENTED | package pin; skeleton only |
| FakeTransport | IMPLEMENTED + TESTED | reliability + closure fixtures |
| Durable outbox JSON ledger | **IMPLEMENTED + TESTED** | ADR-0011 |
| Bridge/tools outbound via outbox | **LOCKED + TESTED** | `src/bridge.js`, `src/outbound-api.js` |
| Stream delivery state (session→message_id) | **IMPLEMENTED + TESTED** | bridge `streams` map |
| State machine + crash recovery | **IMPLEMENTED + TESTED** | `sending`→`queued` |
| 429 Retry-After | **IMPLEMENTED + TESTED** | FakeClock |
| 5xx / backoff / max attempts | **IMPLEMENTED + TESTED** | |
| Terminal permission / auth isolate | **IMPLEMENTED + TESTED** | |
| operation_id dedupe + nonce/enforce_nonce | **IMPLEMENTED + TESTED** | |
| Multi-step groups | **IMPLEMENTED + TESTED** | Atlas scenario |
| Delivery receipts | **IMPLEMENTED + TESTED** | `toReceipt` |
| Inbound dedupe TTL store | **LOCKED + TESTED** | `src/inbound-dedupe.js` |
| discord.js → outbox error map | **IMPLEMENTED + TESTED** | `src/discord-errors.js` |
| Live Discord rate-limit buckets | DESIGNED_FOR_LIVE | DiscordJsTransport contract helper |
| Live Gateway/REST | BLOCKED / LATER | no token until operator authorize |
| Binding encoding | LOCKED | ADR-0010 |
| MessageSource.kind `user` | LOCKED | |
| Session bridge | LOCKED + TESTED | DeterministicAgents facade |
| Profile activation | BLOCKED | operator authorize |
| Full Components V2 renderer | LATER | kinds reserved |
| approvalChannel | V2 / non-blocking | |

## Runtime honesty

```text
DSH API contract = OBSERVED
adapter tests = TESTED against deterministic facade
full profile AgentLoop integration = NOT YET LIVE-SMOKED
```

## Reliability call graph (TESTED)

```text
Discord inbound
  → authorize → inbound dedupe claim
  → ConversationBinding → agents.followup
  → assistant coalesce → outbox.enqueue
  → outbox.tick → FakeTransport
  → delivery receipt

consumer/tool
  → provider.messages.* → outbox → transport
```
