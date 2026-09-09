# Architecture — dsh-piblox-discord

**STATUS:** DESIGN / NOT IMPLEMENTED  
**Labels:** LOCKED intents from mission; OBSERVED DSH seams; PROPOSED plugin internals.

## 1. Logical stack

```text
Discord (Gateway + REST)
        ↕
dsh-piblox-discord
  ├── accounts
  ├── gateway
  ├── rest
  ├── rate-limit
  ├── messages / channels / threads
  ├── interactions
  ├── events (normalize)
  ├── tools (discord.* / discord.admin.*)
  ├── bindings adapter → conversationBinding
  ├── routing adapter → sessions / router (consumer-driven)
  ├── delivery / state (transport only)
  └── observability adapter → observability
        ↕
DSH Core
├── conversationBinding   (OBSERVED service)
├── router / sessions / agents
├── policy                (OBSERVED service)
├── observability         (OBSERVED service)
├── secrets               (OBSERVED — dsh-piblox-secrets)
└── consumers / domain plugins
```

## 2. Product boundary (LOCKED)

| In Core plugin | Out of Core |
|---|---|
| Discord connectivity (0..N accounts) | Vega persona / product UX |
| Transport reliability (429, retry, resume) | InfraMaintainer plans / P0–P4 |
| Normalized events + tools | Cursor remote semantics |
| ConversationBinding adapter | Policy decisions |
| Identity / guild / channel context | Domain executors |
| Delivery / dedupe / idempotency state | Maintenance renderers |

## 3. Conceptual responsibilities

These are **logical** modules — not a mandated `src/` layout (no implementation yet).

| Responsibility | Role |
|---|---|
| **accounts** | Lifecycle of 0..N Discord Application/Bot credentials and configs |
| **gateway** | WebSocket lifecycle, reconnect, resume, intent subscription per account |
| **rest** | Discord HTTP API client with bucket-aware rate limits |
| **rate-limit** | Global + per-route buckets, `Retry-After`, queue/backoff |
| **messages** | Send / reply / edit / delete / history; chunking / truncation |
| **channels / threads** | Channel + thread metadata and create/list where permitted |
| **interactions** | Slash / button / select / modal ack, defer, follow-up |
| **events** | Map Discord Gateway events → normalized DSH-facing event model |
| **tools** | Register Cordis/DSH tools under `discord.*` and `discord.admin.*` |
| **bindings** | Build `provider/scope/external_id` → call `conversationBinding` |
| **routing adapter** | Resolve session + hand off inbound content to DSH session/agent seams |
| **delivery/state** | Outbound job queue, idempotency keys, inbound event dedupe |
| **observability adapter** | Emit via `observability` using **allowed** Core event types + payloads |

## 4. Multi-account model (LOCKED)

```text
1 plugin process
  → Account A (token ref secrets:DISCORD_VEGA_TOKEN)
  → Account B (token ref secrets:DISCORD_INFRA_TOKEN)
  → …
```

Each account has its own Gateway connection, REST identity, guild memberships,
and binding rules. There is **no** singleton `ONE_PLUGIN = ONE_BOT` assumption.

Account ids are config labels (`vega`, `infra`, …). Those labels are **config
aliases**, not Core business logic branches (`if vega` is forbidden in Core code).

## 5. Inbound path (PROPOSED over OBSERVED seams)

```text
Discord Gateway event
  → account_id attach
  → authorize (guild/channel/user allowlists)     [plugin config]
  → inbound dedupe (Discord event/message id)
  → normalize → DiscordNormalizedEvent
  → ConversationBinding.resolveOrCreate(...)     [OBSERVED]
  → mint/resume DSH session_id via adapter callback  [OPEN — session mint seam]
  → observability.mint/bind + emit request.received  [OBSERVED types]
  → consumer routing (session.prompt / agent followup / router)  [PROPOSED]
  → outbound replies via delivery queue
```

## 6. Outbound path (PROPOSED)

```text
DSH consumer / tool / notification
  → discord.message.send (or proactive target alias)
  → policy tools/pre-execute gate (if tool call)   [OBSERVED]
  → outbox accept → queued → sending
  → REST with rate-limit / Retry-After
  → delivered | retry_wait | failed_terminal
  → observability tool.returned / tool.failed
```

## 7. Policy boundary (LOCKED)

Discord buttons and slash commands are **inputs / intents**, not authorization.

```text
Discord interaction
  → dsh-piblox-discord (normalize + transport)
  → consumer / domain plugin
  → dsh-policy-engine (AUTO | APPROVAL | DENY)
  → executor (only if allowed)
```

**OBSERVED gap:** `policy.requestApproval()` currently returns a stub advising
use of the `tools/pre-execute` park path (`ctx.approval`). Discord HITL relay
must integrate with that upstream approval surface — see OPEN in
[DSH-INTEGRATION.md](DSH-INTEGRATION.md).

## 8. Observability boundary (LOCKED intent / OPEN mapping)

**OBSERVED:** `observability.emit(type, …)` accepts a **closed** `EVENT_TYPES`
set. Unknown types are rewritten to `request.aborted` with
`E_CONTRACT_VIOLATION_EVENT_TYPE`.

Therefore Discord-specific names such as `discord.message.created` are a
**plugin-normalized event model** (see [EVENT-CONTRACT.md](EVENT-CONTRACT.md)).
Bridging into Core JSONL must use allowed types + structured payloads, or wait
for an OPEN contract extension of the event schema.

## 9. What we deliberately do not copy

| Source | Use |
|---|---|
| Atlas Python / discord.py seat | REFERENCE — failure modes (429, partial thread) inform reliability design |
| Community `dsh-discord` | REFERENCE — thin transport + FakeTransport ideas; reject StateStore session map and product-specific AgentController |
| Hermes Discord gateway | REFERENCE — multi-channel ops experience; not a dependency |

## 10. Implementation structure

**Not specified in this bootstrap.** File layout, package manager lockfile, and
Discord library choice remain OPEN until `READY_FOR_IMPLEMENTATION`.
