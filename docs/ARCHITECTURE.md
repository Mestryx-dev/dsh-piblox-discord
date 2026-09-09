# Architecture — dsh-piblox-discord

**STATUS:** DESIGN / NOT IMPLEMENTED  
**Labels:** LOCKED intents from mission; OBSERVED DSH seams; PROPOSED plugin internals.

**LOCKED:** Modern Discord API / Components V2 baseline (ADR-0007) — Discord HTTP **`v10`**, **`discord.js` 14.x** direction, Components V2 as first-class transport/render primitive.

## 1. Logical stack

```text
Discord Developer Platform (API v10)
  ├── Gateway (intents, resume, reconnect)
  ├── REST (buckets, Retry-After)
  └── optional later: HTTP interactions / webhooks
        ↕
dsh-piblox-discord
  ├── accounts
  ├── gateway
  ├── rest (v10 isolated here)
  ├── rate-limit
  ├── components (V2-native model + legacy compat)
  ├── messages / channels / threads
  ├── interactions (delivery-agnostic)
  ├── events (typed + unknown envelope)
  ├── tools (discord.* / discord.admin.* + REST escape hatch)
  ├── bindings adapter → conversationBinding
  ├── routing adapter → sessions / router (consumer-driven)
  ├── delivery / state (transport only; nonce / operation IDs)
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
| Normalized events + tools + Components V2 model | Cursor remote semantics |
| ConversationBinding adapter | Policy decisions |
| Identity / guild / channel / install contexts | Domain executors |
| Delivery / dedupe / nonce / operation IDs | Maintenance renderers |

## 3. Modern platform baseline (LOCKED)

| Concern | Decision |
|---|---|
| HTTP API | **`v10` only** as architectural dependency; no legacy/deprecated endpoints |
| Client | Current **`discord.js` 14.x** direction |
| API version leakage | **Forbidden** into DSH contracts, ConversationBinding keys, Core event types, tool names |
| Rate limits | Honor Discord headers / buckets / `Retry-After` |
| Bitfields | Preserve Discord permission/flag bitfields **losslessly** (not signed 32-bit assumptions); support extended/string-serialized forms where Discord uses them |
| Components | **Components V2 native**; legacy ActionRow/embeds/content remain compatibility paths |
| Install model | Understand `GUILD_INSTALL` and `USER_INSTALL`; V1 ops may use guild-only **without** hard-coding that into contracts |
| Commands | Model CHAT_INPUT, USER, MESSAGE, autocomplete, interaction + installation contexts — not “guild slash only” |
| Interaction delivery | Normalized interaction independent of Gateway vs HTTP endpoint |

## 4. Conceptual responsibilities

These are **logical** modules — not a mandated `src/` layout (no implementation yet).

| Responsibility | Role |
|---|---|
| **accounts** | Lifecycle of 0..N Discord Application/Bot credentials and configs |
| **gateway** | WebSocket lifecycle, reconnect, resume, intent subscription per account |
| **rest** | Discord HTTP API **v10** client with bucket-aware rate limits |
| **rate-limit** | Global + per-route buckets, `Retry-After`, queue/backoff |
| **components** | V2-native component tree codec + legacy message shape compat |
| **messages** | Send / reply / edit / delete / history; references; mentions; nonce/`enforce_nonce` |
| **channels / threads** | Channel + thread metadata and create/list where permitted |
| **interactions** | Delivery-agnostic interaction model; ack, defer, follow-up |
| **events** | Typed `discord.*` + bounded unknown Gateway event envelope |
| **tools** | `discord.*` / `discord.admin.*` + policy-gated low-level REST escape hatch |
| **bindings** | Build `provider/scope/external_id` → call `conversationBinding` |
| **routing adapter** | Resolve session + hand off inbound content to DSH session/agent seams |
| **delivery/state** | Outbox, operation IDs, Create Message nonce map, inbound dedupe |
| **observability adapter** | Emit via `observability` using **allowed** Core event types + payloads |

## 5. Components V2 as architecture primitive (LOCKED)

Renderer/transport must **not** be centered on legacy:

```text
content + embeds + ActionRow
```

with Components V2 bolted later.

Native model must represent (at least as opaque/typed nodes): Action Row, Button,
String/User/Role/Mentionable/Channel Select, Section, Text Display, Thumbnail,
Media Gallery, File, Separator, Container, Label, Text Input, File Upload,
Radio Group, Checkbox Group, Checkbox.

Legacy messages remain supported for compatibility.
V1 ships typed helpers for a subset; the **codec/envelope** must not require redesign
for remaining families.

## 6. Forward compatibility (LOCKED)

The plugin must **not** need an architecture update every time Discord adds an
event, component, or REST feature.

Use three layers:

1. **Typed / high-level** support for known stable capabilities.
2. **Normalized envelopes** with bounded, redacted raw Discord metadata.
3. **Controlled low-level REST escape hatch** for unsupported/new endpoints.

The escape hatch **MUST** still enforce:

- account credentials
- rate limiting
- audit
- policy classification
- permissions / allowlists
- redaction

It **MUST NOT** bypass DSH policy.

## 7. Multi-account model (LOCKED)

```text
1 plugin process
  → Account A (token ref secrets:…)
  → Account B (token ref secrets:…)
  → …
```

Each account has its own Gateway connection, REST identity, guild memberships,
and binding rules. There is **no** singleton `ONE_PLUGIN = ONE_BOT` assumption.

Account ids are config labels. Those labels are **config aliases**, not Core
business logic branches (`if vega` is forbidden in Core code).

## 8. Inbound path (PROPOSED over OBSERVED seams)

```text
Discord interaction/event (Gateway now; HTTP later)
  → account_id attach
  → authorize (guild/channel/user allowlists; `[]` = deny all)  [plugin config LOCKED]
  → inbound dedupe
  → normalize → DiscordNormalizedEvent | UnknownDiscordEvent
  → ConversationBinding.resolveOrCreate(...)     [OBSERVED]
  → mint/resume DSH session_id via ctx.agents.create|get|resume  [LOCKED — ADR-0008]
  → observability.mint/bind + emit request.received  [OBSERVED closed types]
  → consumer routing (agent.followup / session/event)  [LOCKED — ADR-0008]
  → outbound replies via delivery queue (Components V2 capable)
```

Consumers must not depend on whether the interaction arrived via Gateway or HTTP.

## 9. Outbound path (PROPOSED)

```text
DSH consumer / tool / notification
  → discord.message.send (legacy and/or Components V2 tree)
  → policy tools/pre-execute gate (if tool call)   [OBSERVED]
  → outbox accept → queued → sending
  → Create Message with deterministic nonce + enforce_nonce when applicable
  → REST v10 with rate-limit / Retry-After
  → delivered | retry_wait | failed_terminal
  → observability tool.returned / tool.failed
```

**Idempotency (LOCKED principle):**

- Create Message → Discord `nonce` + `enforce_nonce=true` where applicable.
- Do **not** invent a generic Discord HTTP `Idempotency-Key`.
- Other operations → durable operation IDs + returned Discord resource IDs + reconciliation.

## 10. Policy boundary (LOCKED)

Discord buttons, selects, and commands are **inputs / intents**, not authorization.

```text
Discord interaction
  → dsh-piblox-discord (normalize + transport)
  → consumer / domain plugin
  → dsh-policy-engine (AUTO | APPROVAL | DENY)
  → executor (only if allowed)
```

**OBSERVED gap:** `policy.requestApproval()` currently returns a stub advising
use of the `tools/pre-execute` park path (`ctx.approval`). Direct Discord UI
integration with that approval surface is **NON-BLOCKING / V2** — V1 transports
generic interactions/intents only; no parallel approval store
([DSH-INTEGRATION.md](DSH-INTEGRATION.md)).

## 11. Observability boundary (LOCKED for V1)

**OBSERVED:** `observability.emit(type, …)` accepts a **closed** `EVENT_TYPES`
set. Unknown types are rewritten to `request.aborted` with
`E_CONTRACT_VIOLATION_EVENT_TYPE`.

Discord-specific names such as `discord.message.created` are a
**plugin-normalized event model** (see [EVENT-CONTRACT.md](EVENT-CONTRACT.md)).
Bridging into Core JSONL **must** use existing allowed types + structured
payloads. Extending Core EVENT_TYPES with `discord.*` is **Rejected for V1**.

## 12. What we deliberately do not copy

| Source | Use |
|---|---|
| Atlas Python / discord.py seat | REFERENCE — failure modes (429, partial thread) inform reliability design; **not** legacy message architecture |
| Community `dsh-discord` | REFERENCE — thin transport + FakeTransport; reject StateStore session map and product AgentController; do not inherit legacy-only component model |
| Hermes Discord gateway | REFERENCE — multi-channel ops experience; not a dependency |
| Satori / `@satorijs/adapter-discord` | REFERENCE / rejected V1 transport — Cordis 3.x incompatible; Components V2 gap (ADR-0009) |

## 13. Implementation structure

File layout and package lockfile remain unspecified until the coding mission.

**Client direction is LOCKED** to current `discord.js` 14.x
(`TRANSPORT_DECISION = LOCKED_DIRECT_DISCORDJS`). Exact compatible pin is chosen
when the package/lockfile is created (implementation detail, not architecture blocker).
