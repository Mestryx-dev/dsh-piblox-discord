# State & reliability — dsh-piblox-discord

**STATUS:** IMPLEMENTED + TESTED (FakeTransport) / DESIGNED_FOR_LIVE (discord.js REST headers)  
**TRANSPORT_CLOSURE:** **PASS** (2026-09-09)  
**ALL_NORMAL_OUTBOUND_VIA_OUTBOX:** **LOCKED**  
**NOT_LIVE_TESTED:** real Discord rate-limit buckets / Gateway

State ownership mixes **OBSERVED** Core owners and **IMPLEMENTED** plugin transport state.

## 1. State ownership table

| STATE | OWNER | DURABLE? | WHY |
|---|---|---|---|
| Discord account configuration | Plugin config / profile | yes (config files) | Operator-owned |
| Bot token values | `dsh-piblox-secrets` (`secrets`) | yes | OBSERVED credential SSOT |
| Conversation ↔ session binding | `conversationBinding` | yes | OBSERVED — **no parallel store** |
| Discord channel/thread/message IDs | Discord + outbox `discord_resource_id` | ephemeral + refs | Platform truth is Discord |
| Stream delivery (per **turn** → Discord message_id) | Bridge `streams` map (`sentId` turn-scoped) | memory | Transport/render only — **not** a second ConversationBinding; cleared on `turn/end` |

| Outbound delivery jobs | Plugin outbox (`discord-outbox.json`) | **yes (IMPLEMENTED)** | Survive crash mid-send |
| Create Message `nonce` map | Outbox op + FakeTransport nonce index | yes | Discord-native idempotency (`enforce_nonce`) |
| Durable operation IDs | Outbox `operation_id` | yes | Dedupe + receipts |
| Multi-step delivery groups | Outbox `groups` | yes | Atlas partial-thread prevention |
| Inbound event dedupe window | Plugin `discord-inbound-dedupe.json` | **yes (IMPLEMENTED)** | Prevent double DSH followup |
| Rate-limit bucket state | Live REST layer | DESIGNED_FOR_LIVE | Short-lived; outbox honors Retry-After today |
| Retry state | Outbox | yes | Tied to delivery jobs |
| Delivery receipts | Outbox → `toReceipt()` | yes | Consumer confirmation |
| Correlation IDs | `observability` + outbox field | memory bind + JSONL | OBSERVED; no second scheme |
| Session messages / agent turns | DSH session store | yes | Upstream |
| Policy decisions / approvals | `policy` | yes | Outbox never bypasses policy |

**LOCKED:** Do not create a second ConversationBinding / session map inside this plugin.

## 2. Outbound state machine (IMPLEMENTED)

```text
accepted → queued → sending → delivered
                 ↘ retry_wait → queued/sending (after next_attempt_at)
                 ↘ failed_terminal
```

| State | Meaning |
|---|---|
| `accepted` | Momentary; persisted immediately as `queued` |
| `queued` | Waiting for scheduler / rate-limit slot |
| `sending` | Transport call in flight (claimed under lock) |
| `delivered` | Discord/Fake acknowledged; `discord_resource_id` stored |
| `retry_wait` | Transient/ambiguous failure; `next_attempt_at` set |
| `failed_terminal` | Non-retryable or attempts exhausted |

### Restart semantics (LOCKED)

```text
sending → queued (next_attempt_at = now)
```

Never permanently strand operations in `sending` after `recoverOnLoad()`.

### Create Message idempotency (LOCKED + TESTED)

- Deterministic **`nonce`** from `operation_id` via `nonceFromOperationId` (**LOCKED:** Discord Create Message nonce ≤ **25** characters — use SHA-256 hex prefix, not raw/`dsh_`+slice which overflowed to 28 and failed inaugural thread `sendMessage`)
- **`enforce_nonce=true`** on FakeTransport Create Message path
- Duplicate `operation_id` enqueue returns existing receipt (no second job)
- Ambiguous timeout with `applyDespiteFailure` + nonce → retry returns same resource (no duplicate)

### Multi-step outbound groups (IMPLEMENTED + TESTED)

```text
persist group + all steps before step 1
→ execute first incomplete step only
→ on deliver, unlock next step
→ on restart, skip delivered steps; resume incomplete
```

Atlas failure mode covered by `test/reliability.test.js` group case.

### Application outbound path (LOCKED)

```text
turn/start → begin turn delivery window (clear mutable sentId)
assistant/chunk → buffer only (coalesce)
assistant/message | turn/end | flushOutbound → outbox.enqueue
  → first flush this turn: send/reply (new Discord message)
  → later dirty flush same turn: edit THAT message only
turn/end → finalize: clear mutable sentId/buffer (keep durable outbox receipts)
outbox.tick → transport.send|reply|edit
```

**LOCKED:** `sentId` is **per-turn mutable delivery state**, never session-global response identity.

**LOCKED:** ConversationBinding session reuse ≠ Discord message reuse.
Same DSH session across turns MUST create a **new** Discord response each turn.
Edits never cross turn boundaries.

Proactive/tool surface: `provider.messages.sendMessage|replyMessage|editMessage` → same outbox.

**Not allowed:** bridge / messages API → transport directly.

### Restart / recovery boundary (LOCKED)

| Situation | Behaviour |
|---|---|
| Process restart mid-turn | In-memory `streams` rebuilt empty; durable outbox recovers `sending`→`queued` by `operation_id` |
| Process restart after turn completed | No second final send: outbox dedupe on `operation_id`; new turn starts with no `sentId` |
| Do not | Re-hydrate `sentId` from prior turn's Discord message into the next turn window |

## 3. Inbound dedupe (IMPLEMENTED + LOCKED)

Default TTL: **72h** (aligned with `CONFIGURATION.md` `inbound.dedupe_ttl_hours: 72`).  
Default lease: **5 minutes** for in-flight `claimed` / `dispatched`.

| Field | Purpose |
|---|---|
| `account_id` + `event_id` | Primary key |
| `event_type` | `discord.message.created` / `discord.interaction` / … |
| `state` | `claimed` → `dispatched` → `completed` |
| `first_seen_at` / `expires_at` | TTL window |
| `lease_until` | Crash reclaim |

**Keys:** messages → `account_id + message_id`; interactions → `account_id + interaction_id`.  
Content hash is **not** primary identity.

### Ordering (LOCKED)

```text
normalize → authorize → dedupe claim
  → [optional] createThread reconcile (thread_per_conversation launcher)
  → binding/session → agent.followup → complete
```

Authorize precedes claim so denied events are not stored.

### Interaction reliability (IMPLEMENTED foundation)

| Concern | Behaviour |
|---|---|
| Dedupe key | `account_id + interaction_id` (never `message_id` as primary for component clicks) |
| ACK deadline | `deferInteraction` via outbox **before** consumer / AgentLoop |
| Already acknowledged / expired | Mapped to terminal `already_acknowledged` / `interaction_expired` / `unknown_target` |
| Response retry | Outbox `operation_id` idempotency — must not re-execute business intent (intent already completed in dedupe) |
| Thread context | Resolve existing `discord:<acct>.thread:<thread_id>` binding; do not mint session on click alone |

Do not mark launcher inbound `completed` until thread is established (when required) and binding/session dispatch is accepted.

### Thread create reliability (IMPLEMENTED)

| Case | Behaviour |
|---|---|
| Thread create fails after claim | No ConversationBinding / no DSH session; claim stays leased for retry |
| Thread created, crash before binding | Retry reuses outbox `thread:create:<acct>:<parent_message_id>` receipt / Discord starter thread — no duplicate thread |
| Archived thread | Binding/session durable; inbound reuse same session; outbound may fail cleanly if Discord rejects send |
| Missing binding on allowed parent thread | Create binding/session for that thread (fail closed if parent unknown) |

Operation identity for thread create: `account_id + parent_message_id` (durable outbox `operation_id`).

### Crash semantics (LOCKED)

| Situation | Behaviour |
|---|---|
| `completed` within TTL | duplicate → **no** second followup |
| `claimed` / `dispatched` with live lease | duplicate (in-flight) |
| `claimed` with **expired lease** | **reclaim** (at-least-once ingestion) |
| After TTL expiry | new claim allowed (documented; Discord snowflakes remain unique in practice) |

Invariant: **duplicate Discord delivery ≠ duplicate DSH turn** while the claim is live.

## 4. Failure semantics (IMPLEMENTED classification)

| Failure | Class | Behaviour |
|---|---|---|
| HTTP 429 + Retry-After | transport | `retry_wait`; honor `retryAfterMs`; FakeClock in tests |
| Transient 5xx | transport | exponential backoff; max attempts → terminal |
| Network timeout | transport / ambiguous | retry; nonce reconciliation for Create Message |
| Invalid token | transport/auth | terminal; **isolate account**; others continue |
| Missing permission | discord_domain | `failed_terminal`; no retry loop |
| Unknown target / invalid payload | discord_domain | terminal |
| Policy DENY | policy | not a transport retry (outbox must not re-authorize) |

### discord.js error mapping (IMPLEMENTED + TESTED)

`mapDiscordJsError` (discord.js@14.27.0 shapes) → `TransportError` codes used by `classifyTransportError`.  
Outbox `dispatchToTransport` wraps throws via `toClassifiableError`.

### Class distinctions (LOCKED vocabulary)

```text
transport_failure
discord_domain_failure
dsh_failure
policy_denial
```

**LOCKED:** `transport failure ≠ DSH/domain failure` — ConversationBinding and session state are not corrupted by Discord 429 / terminal delivery failure.

## 5. Scheduler / clock

- `FakeClock.now()` / `advance(ms)` — tests (no real sleeps)
- `SystemClock` — production
- Per-account processing: alpha 429 does not block beta

## 6. FakeTransport (IMPLEMENTED)

- Records REST-like calls
- Injects 429 (with Retry-After), 5xx, timeout, permission, auth, network
- Ambiguous timeout via `applyDespiteFailure`
- Nonce / `enforce_nonce` index
- `createThread` for multi-step groups
- `injectMessage` / `replayMessage` / `injectInteraction` for Gateway replay tests
- No network, no tokens

## 7. Observability

Uses existing closed Core event types only (`tool.called` / `tool.returned` / `tool.failed`, optional `request.received`)
with `correlation_id` / `session_id` / `operation_id` / `account_id` metadata.  
Does **not** extend EVENT_TYPES with `discord.*`.
