# Architecture — dsh-piblox-discord

**STATUS:** V1 TRANSPORT + CONFIG PLANE + COMPONENTS/INTERACTIONS + **SEMANTIC SERVICE/TOOLS** IMPLEMENTED  
(FakeTransport + Gateway LAB) / **PRODUCTION_READY = YES** (V1 semantic, 2026-09-10)  
Coverage SSOT: [`CAPABILITY-MATRIX.md`](CAPABILITY-MATRIX.md).  
**Labels:** LOCKED intents from mission; OBSERVED DSH seams; IMPLEMENTED reliability + operator Settings + Components V2 encode + interaction path + semantic `ctx.discord` + policy-gated `discord_*` tools.

**LOCKED:** `Modern Discord API / Components V2 baseline = LOCKED` ([ADR-0007](adr/0007-modern-discord-baseline.md)) — Discord HTTP **`v10`**, **`discord.js` 14.x** direction, Components V2 as first-class transport/render primitive (not legacy ActionRow-first).

**LOCKED:** `ALL_NORMAL_OUTBOUND_VIA_OUTBOX` — bridge + `messages` API + **semantic service/tools** enqueue only; transport writes are outbox-worker / test-only.

**LOCKED:** Credential ownership = **dsh-piblox-secrets** (ADR-0012). Account config SSOT = plugin `discord-accounts.json` ledger (Cordis patch is boot seed only).

**LOCKED:** Proactive notifications = **`ctx.discord` service** (`notify` / `messageSend`). Model-facing actions = **`ctx.tools` → tools/pre-execute → policy → discord_*** wrappers. Both share DeliveryOutbox. `discord.rest.raw` = deferred.

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
  ├── tools (discord_* model wrappers via ctx.tools; admin REST escape hatch deferred)
  ├── semantic service (ctx.discord — guild/channel/message/thread + notify)
  ├── bindings adapter → conversationBinding
  ├── routing adapter → sessions / router (consumer-driven)
  ├── delivery / state (transport only; nonce / operation IDs)
  └── observability adapter → observability
        ↕
DSH Core
├── conversationBinding   (OBSERVED service)
├── router / sessions / agents
├── tools                 (OBSERVED — dsh-tools runtime)
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
| **semantic** | Cordis `discord` service — normalized DTO reads + mutating outbox ops + `notify` |
| **tools** | Model-facing `discord_*` wrappers via `ctx.tools` (policy-gated); `discord.rest.raw` deferred |
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

**Suggested V1 typed primitives:** Text Display, Container, Section, Button,
basic selects, File/attachments.

Legacy messages remain supported for compatibility.
V1 ships typed helpers for a subset; the **codec/envelope** must not require redesign
for remaining families. Full advanced convenience APIs (including modern modals,
File Upload, Radio/Checkbox groups, richer media) may remain **V2**.

**IMPLEMENTED (foundation):** `src/components/` — `ComponentNode` tree → Discord transport encode
(`encodeOutboundComponents`), opaque `raw` nodes for future families, `mintCustomId` /
`parseCustomId` (`dsh1.<intent>.<nonce>`, ≤100 chars, no secrets), default
`allowed_mentions: { parse: [] }`. Legacy `content`/`embeds`/ActionRow-only payloads remain
a compatibility path; V2 top-level kinds set `MESSAGE_FLAG_IS_COMPONENTS_V2`.

## 5.1 Modern message + modal + webhook targets (LOCKED representation)

Target message contract accounts for (where applicable): replies, message
references, forwarding/message snapshots, attachments, Components V2, polls,
voice-message metadata, `nonce`, `enforce_nonce`, allowed mentions.

Target modal contract supports modern fields (Label, Text Input, selects,
File Upload, Radio Group, Checkbox Group, Checkbox) — not text-input-only.

Incoming webhooks and Discord Webhook Events are **Feature Contract** capabilities
(V2) — not architectural exclusions.

Do **not** claim V1 implements every target field.

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

## 8. Inbound path (IMPLEMENTED + TESTED over OBSERVED seams)

```text
Discord interaction/event (FakeTransport inject today; Gateway later)
  → account_id attach
  → authorize (guild / channel|PARENT channel for threads / user; `[]` = deny all)
  → inbound dedupe claim (account_id + message_id | interaction_id)
  → [thread_per_conversation + top-level] outbox createThread from parent message
       → rewrite event to thread_id (parent message remains dedupe identity)
  → ConversationBinding.resolveOrCreate(...)     [OBSERVED]
  → mint/resume DSH session_id via ctx.agents.create|get|resume  [LOCKED — ADR-0008]
  → observability.mint/bind + emit request.received  [OBSERVED closed types]
  → consumer routing (agent.followup / session/event)  [LOCKED — ADR-0008]
  → mark inbound completed
  → assistant output → DeliveryOutbox → transport (targets thread when bound)
```

### Interaction inbound (IMPLEMENTED foundation)

```text
interactionCreate (Gateway today; HTTP endpoint later — same normalized shape)
  → normalizeInteractionCreate (no discord.js Interaction leak)
  → authorize (identical security boundary; threads use parent_channel_id)
  → best-effort ACK on deny (no consumer)
  → inbound dedupe claim (account_id + interaction_id)   # NOT message_id
  → outbox deferInteraction (deferUpdate|deferReply) BEFORE consumer / AgentLoop
  → optional ConversationBinding.resolve (reuse; never mint solely for a click)
  → generic intent dispatch (LAB smoke_* or onInteractionIntent)
  → followUp / edit / update via outbox
```

**LOCKED:** Interaction = authenticated transport **intent**, **not** authorization.
Gateway vs HTTP delivery is an adapter detail (`delivery_mode`); consumer contract unchanged.

Ordering note: **authorize before claim** so denied traffic never enters the durable dedupe store.

**Conversation topology (ADR-0013):**

| Mode | Entry surface | Conversation surface | Binding |
|---|---|---|---|
| `channel` (default) | parent channel | same channel | `discord:<acct>.channel:<channel_id>` |
| `thread_per_conversation` | launcher channel | Discord thread from starter message | `discord:<acct>.thread:<thread_id>` |

Channel = durable entry surface. Thread = conversation surface. ConversationBinding = session identity SSOT.
Both modes remain supported; accounts default to `channel` (no silent migration).

Thread authorization uses **parent_channel_id** against `allowedChannels` — dynamic thread ids are never manually listed.
Missing/unverifiable parent → fail closed.

Consumers must not depend on whether the interaction arrived via Gateway or HTTP.

## 9. Outbound path (IMPLEMENTED + TESTED)

```text
assistant/chunk|message | DSH consumer / messages API | interaction ACK/follow-up
  → coalesce stream buffer (no per-token enqueue) | immediate interaction ops
  → outbox.enqueue (sendMessage | replyMessage | editMessage | createThread
                    | deferInteraction | followUpInteraction | editInteractionReply
                    | updateInteraction)
  → outbox.tick → DiscordTransport
  → delivered | retry_wait | failed_terminal (receipt)
```

Component trees travel as `payload.components` (ComponentNode[]); transport encodes to Discord.
**LOCKED:** transport failure ≠ DSH/domain failure. A 429 leaves the DSH turn successful and the delivery op in `retry_wait`.

**Idempotency (LOCKED principle):**

- Create Message → Discord `nonce` + `enforce_nonce=true` where applicable.
  Nonce must be ≤ **25** characters (`nonceFromOperationId` → SHA-256 hex slice). Observed live failure when a longer derived nonce blocked inaugural thread `sendMessage` while `replyMessage` (no nonce) still worked.
- Thread create → durable `operation_id` = `thread:create:<account_id>:<parent_message_id>`; reconcile via outbox receipt / Discord starter-message thread (no invented HTTP Idempotency-Key).
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

V1 spike / transport closure / config plane already exist under `src/`
(FakeTransport default; live Gateway blocked until operator authorize).

**Client direction is LOCKED** to current `discord.js` 14.x
(`TRANSPORT_DECISION = LOCKED_DIRECT_DISCORDJS`). Exact compatible pin is an
implementation detail within 14.x (currently `14.27.0` in package metadata).

API version **`v10`** stays inside the transport/REST layer — never as a DSH
consumer contract field.
