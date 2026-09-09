# State & reliability — dsh-piblox-discord

**STATUS:** IMPLEMENTED + TESTED (FakeTransport) / DESIGNED_FOR_LIVE (discord.js REST headers)  
**NOT_LIVE_TESTED:** real Discord rate-limit buckets / Gateway

State ownership mixes **OBSERVED** Core owners and **IMPLEMENTED** plugin transport state.

## 1. State ownership table

| STATE | OWNER | DURABLE? | WHY |
|---|---|---|---|
| Discord account configuration | Plugin config / profile | yes (config files) | Operator-owned |
| Bot token values | `dsh-piblox-secrets` (`secrets`) | yes | OBSERVED credential SSOT |
| Conversation ↔ session binding | `conversationBinding` | yes | OBSERVED — **no parallel store** |
| Discord channel/thread/message IDs | Discord + outbox `discord_resource_id` | ephemeral + refs | Platform truth is Discord |
| Outbound delivery jobs | Plugin outbox (`discord-outbox.json`) | **yes (IMPLEMENTED)** | Survive crash mid-send |
| Create Message `nonce` map | Outbox op + FakeTransport nonce index | yes | Discord-native idempotency (`enforce_nonce`) |
| Durable operation IDs | Outbox `operation_id` | yes | Dedupe + receipts |
| Multi-step delivery groups | Outbox `groups` | yes | Atlas partial-thread prevention |
| Inbound event dedupe window | Plugin dedupe store | PROPOSED | Prevent double session prompts |
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

- Deterministic **`nonce`** from `operation_id`
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

## 3. Failure semantics (IMPLEMENTED classification)

| Failure | Class | Behaviour |
|---|---|---|
| HTTP 429 + Retry-After | transport | `retry_wait`; honor `retryAfterMs`; FakeClock in tests |
| Transient 5xx | transport | exponential backoff; max attempts → terminal |
| Network timeout | transport / ambiguous | retry; nonce reconciliation for Create Message |
| Invalid token | transport/auth | terminal; **isolate account**; others continue |
| Missing permission | discord_domain | `failed_terminal`; no retry loop |
| Unknown target / invalid payload | discord_domain | terminal |
| Policy DENY | policy | not a transport retry (outbox must not re-authorize) |

### Class distinctions (LOCKED vocabulary)

```text
transport_failure
discord_domain_failure
dsh_failure
policy_denial
```

## 4. Scheduler / clock

- `FakeClock.now()` / `advance(ms)` — tests (no real sleeps)
- `SystemClock` — production
- Per-account processing: alpha 429 does not block beta

## 5. FakeTransport (IMPLEMENTED)

- Records REST-like calls
- Injects 429 (with Retry-After), 5xx, timeout, permission, auth, network
- Ambiguous timeout via `applyDespiteFailure`
- Nonce / `enforce_nonce` index
- `createThread` for multi-step groups
- No network, no tokens

## 6. Observability

Uses existing closed Core event types only (`tool.called` / `tool.returned` / `tool.failed`)
with operation metadata. Does **not** extend EVENT_TYPES with `discord.*`.
