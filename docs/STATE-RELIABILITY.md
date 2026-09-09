# State & reliability — dsh-piblox-discord

**STATUS:** DESIGN / NOT IMPLEMENTED  
State ownership mixes **OBSERVED** Core owners and **PROPOSED** plugin transport state.

## 1. State ownership table

| STATE | OWNER | DURABLE? | WHY |
|---|---|---|---|
| Discord account configuration | Plugin config / profile | yes (config files) | Operator-owned |
| Bot token values | `dsh-piblox-secrets` (`secrets`) | yes | OBSERVED credential SSOT |
| Conversation ↔ session binding | `conversationBinding` | yes | OBSERVED — **no parallel store** |
| Discord channel/thread/message IDs | Discord + event payloads / outbox refs | ephemeral + refs in outbox | Platform truth is Discord |
| Outbound delivery jobs | Plugin outbox | **yes (PROPOSED)** | Survive crash mid-send |
| Idempotency keys (outbound) | Plugin outbox index | yes | Prevent duplicate side effects |
| Inbound event dedupe window | Plugin dedupe store | yes (TTL) | Prevent double session prompts |
| Interaction ack / follow-up state | Plugin (memory + durable if multi-step) | hybrid | Discord 3s window; follow-ups may outlive process |
| Slash command registration state | Plugin / Discord Application | yes (Discord + local cache) | Avoid re-register storms |
| Rate-limit bucket state | Plugin REST layer | memory (+ optional durable) | Buckets are short-lived; durable optional |
| Retry state | Plugin outbox | yes | Tied to delivery jobs |
| Delivery receipts | Plugin → caller | yes (job record) | Consumer confirmation |
| Correlation IDs | `observability` | memory bind + JSONL events | OBSERVED |
| Session messages / agent turns | DSH session store | yes | Upstream |
| Policy decisions / approvals | `policy` + approvals ledger / `ctx.approval` | yes | OBSERVED |
| Domain executor state | Domain plugins | — | Out of scope |

**LOCKED:** Do not create a second ConversationBinding / session map inside this plugin.

## 2. Outbound state machine (PROPOSED)

```text
accepted → queued → sending → delivered
                 ↘ retry_wait → sending (loop)
                 ↘ failed_terminal
```

| State | Meaning |
|---|---|
| `accepted` | API/tool validated inputs; job persisted |
| `queued` | Waiting for rate-limit slot / worker |
| `sending` | REST in flight |
| `delivered` | Discord acknowledged (message id stored) |
| `retry_wait` | Transient failure; backoff scheduled (`Retry-After` honored) |
| `failed_terminal` | Non-retryable or attempts exhausted |

### Multi-step outbound groups (critical)

Atlas failure mode to prevent:

```text
create thread → message 1 → message 2 → HTTP 429 → process exit → partial thread
```

**PROPOSED:** treat multi-step builds as an **outbox group** with group id:

1. Persist full plan before first Discord call.
2. On resume, skip steps that already have Discord ids.
3. Never mark group `delivered` until all required steps succeed or group is aborted with compensating action documented.

## 3. Interaction state machine (PROPOSED)

```text
received → acknowledged → dispatched → completed
                                   ↘ failed
```

| State | Meaning |
|---|---|
| `received` | Gateway interaction accepted; dedupe recorded |
| `acknowledged` | Discord ack/defer within platform deadline |
| `dispatched` | Intent handed to consumer / session / approval path |
| `completed` | Follow-up response sent or intentionally silent |
| `failed` | Acked but completion failed — may retry follow-up only |

## 4. Failure semantics

| Failure | Class | Behaviour (PROPOSED) |
|---|---|---|
| HTTP 429 + Retry-After | transport | `retry_wait`; honor header; do not drop job |
| Transient 5xx | transport | backoff retry |
| Network timeout | transport | retry with idempotency key |
| Invalid token | transport/auth | account `failed_auth`; stop that account; alert |
| Missing permission | domain/Discord | `failed_terminal` for that op; no blind retry loop |
| Unknown channel / deleted thread | domain/Discord | terminal; unbind if conversation gone |
| Invalid payload | domain | terminal validation error |
| Duplicate inbound event | transport | ignore after dedupe hit |
| Process crash | transport | reload durable outbox + incomplete groups |
| Policy DENY | policy | not a transport retry — surface to caller |
| DSH session errors | DSH | classify; may unbind+recreate per CB contract |
| Approval deny/timeout | policy | consumer-visible; no executor call |

### Class distinctions (LOCKED vocabulary)

```text
transport failure  — Discord/network/rate-limit/plugin outbox
domain failure     — bad Discord target / permissions / payload
DSH failure        — session/router/agent/runtime errors
policy denial      — evaluate/park path DENY or timeout
```

## 5. FakeTransport (PROPOSED)

Deterministic in-memory Discord double for unit tests:

- records REST calls
- can inject 429 / 5xx / timeout
- no network, no tokens

Required in V1 design so reliability machines are testable without a live bot.
