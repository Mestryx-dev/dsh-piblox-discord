# Event contract — dsh-piblox-discord

**STATUS:** DESIGN / NOT IMPLEMENTED  
Normalized events are **PROPOSED**. Discord Gateway names are **REFERENCE** to current Discord docs.  
Core `observability.emit` types are **OBSERVED** (closed set).  
**LOCKED:** Modern Discord baseline + forward-compatible unknown events (ADR-0007).

## 1. Normalized event envelope (PROPOSED)

```text
provider          # always "discord"
account_id        # config label
event_type        # discord.* namespace OR discord.gateway.unknown
event_id          # stable dedupe id (prefer Discord snowflake ids)

guild_id          # nullable
channel_id        # nullable
thread_id         # nullable (set when channel is a thread)

user_id           # nullable
message_id        # nullable
interaction_id    # nullable

# Installation / context (LOCKED model — even when V1 ops are guild-only)
installation_context   # GUILD_INSTALL | USER_INSTALL | null when N/A
interaction_context    # guild | bot_dm | private_channel | … as Discord provides
delivery_mode          # gateway | http_endpoint  (consumers SHOULD ignore)

session_id        # after binding resolve (nullable until bound)
correlation_id    # from observability (nullable until minted)

timestamp         # ISO-8601
payload           # type-specific structured fields
raw               # optional bounded Discord payload excerpt (redacted)
```

API version (`v10`) belongs in transport metadata only — **not** as a consumer contract field that DSH Core must understand.

### Stability & dedupe

| Concern | Rule (PROPOSED) |
|---|---|
| Stable IDs | Prefer Discord snowflakes; for synthetic events use `account_id` + deterministic hash |
| Dedupe key | `account_id` + `event_id` (or `message_id`/`interaction_id` when event_id absent) |
| Ordering | Per-channel best-effort Gateway order; **not** a global total order across accounts |
| Replay | Plugin may re-emit from durable inbound log after crash; consumers must be idempotent |
| Raw metadata | Optional; bounded size; must pass redaction; never store bot tokens |
| Bitfields | Preserve Discord flag/permission fields losslessly in payload/raw |

## 2. Forward compatibility for events (LOCKED)

| Case | Behaviour |
|---|---|
| Known Gateway / interaction events | Typed normalized `discord.*` events |
| Unknown / new Gateway events | Surfaced as `discord.gateway.unknown` (or equivalent) when enabled — **do not silently discard** merely because a local enum is older |
| Unknown component nodes inside known interactions | Retain as bounded raw component nodes in payload |
| Raw persistence | Always bounded + redacted |

Config may disable unknown-event surfacing for noise control; default for lab/debug should prefer visibility.

## 3. Target normalized event types

Map **real** Discord events → normalized names. Do not invent Discord capabilities.

| Normalized type | Typical Discord source | V1 |
|---|---|---|
| `discord.message.created` | `MESSAGE_CREATE` | MUST |
| `discord.message.updated` | `MESSAGE_UPDATE` | SHOULD |
| `discord.message.deleted` | `MESSAGE_DELETE` | SHOULD |
| `discord.interaction.created` | `INTERACTION_CREATE` (any delivery mode) | MUST |
| `discord.button.clicked` | component button | MUST |
| `discord.select.changed` | string/user/role/mentionable/channel select | MUST (basic) |
| `discord.modal.submitted` | modal submit (modern fields) | V2 |
| `discord.thread.created` | `THREAD_CREATE` | SHOULD |
| `discord.thread.updated` | `THREAD_UPDATE` | SHOULD |
| `discord.reaction.added` | `MESSAGE_REACTION_ADD` | V2 |
| `discord.reaction.removed` | `MESSAGE_REACTION_REMOVE` | V2 |
| `discord.member.joined` | `GUILD_MEMBER_ADD` | V2 |
| `discord.member.updated` | `GUILD_MEMBER_UPDATE` | V2 |
| `discord.webhook.event` | Discord Webhook Events | V2 |
| `discord.gateway.unknown` | unrecognized Gateway dispatch | MUST (when enabled) |
| `discord.ready` | Gateway READY (per account) | MUST (internal) |
| `discord.disconnected` | Gateway close | MUST (internal) |
| `discord.rate_limited` | REST 429 observation | MUST (internal) |

## 4. Interaction delivery independence (LOCKED)

```text
Gateway INTERACTION_CREATE  ─┐
                             ├→ same normalized discord.interaction.* contract
HTTP interaction endpoint   ─┘
```

Consumer plugins and ConversationBinding **must not** branch on `delivery_mode`
for authorization or session identity. V1 may implement Gateway only.

## 5. Relationship to Core observability (LOCKED for V1)

Plugin-normalized `discord.*` events are **owned by this plugin** and are
**not** automatically valid `observability.emit` types (closed Core set).

**V1 LOCKED:**

- Do **not** extend `dsh-observability` `EVENT_TYPES` with `discord.*`
- Bridge relevant operations to **existing** closed Core event types + payloads

```text
discord.message.created
  → (after binding) observability.emit('request.received', { …hashes… })
discord.button.clicked / discord.select.changed → consumer intent
  → may later emit approval.* only when wired to real approval path (V2)
discord.* tool side effects
  → tool.called / tool.returned / tool.failed
discord.gateway.unknown
  → plugin log + optional observability request.aborted/system note (mapping PROPOSED)
```

Core schema extension with first-class `discord.*` EVENT_TYPES remains **out of
scope for V1** (Rejected for V1; revisit only with an observability Core change).

## 6. Payload sketches (PROPOSED, non-normative)

### `discord.message.created`

```text
content_hash, content_size
has_attachments, attachment_meta[]
components_present: boolean
component_tree_summary?: { types[], count }   # V2-aware
message_reference?
allowed_mentions_echo?
nonce?
author: { user_id, bot, roles[]? }
mention_ids[]
poll_present?: boolean                        # V2 target
voice_message_meta?: { … }                    # V2 target metadata
forward/snapshot refs?: …                     # V2 target
```

Full message / component tree may be passed to session/render paths separately;
prefer hashes in durable observability payloads (OBSERVED redaction doctrine).

### `discord.button.clicked` / `discord.select.changed`

```text
custom_id, message_id, values?
component_type
intent_kind?   # consumer-defined string, opaque to Core
installation_context, interaction_context, delivery_mode
```

Interactions transport **intent**, never authorization.

### `discord.gateway.unknown`

```text
discord_event_name
payload_keys[]
raw_size
raw_sha256
```
