# Event contract — dsh-piblox-discord

**STATUS:** DESIGN / NOT IMPLEMENTED  
Normalized events are **PROPOSED**. Discord Gateway names are **REFERENCE** to Discord docs.  
Core `observability.emit` types are **OBSERVED** (closed set).

## 1. Normalized event envelope (PROPOSED)

```text
provider          # always "discord"
account_id        # config label
event_type        # discord.* namespace below
event_id          # stable dedupe id (prefer Discord snowflake event/message/interaction id)

guild_id          # nullable
channel_id        # nullable
thread_id         # nullable (set when channel is a thread)

user_id           # nullable
message_id        # nullable
interaction_id    # nullable

session_id        # after binding resolve (nullable until bound)
correlation_id    # from observability (nullable until minted)

timestamp         # ISO-8601
payload           # type-specific structured fields
raw               # optional bounded Discord payload excerpt (redacted)
```

### Stability & dedupe

| Concern | Rule (PROPOSED) |
|---|---|
| Stable IDs | Prefer Discord snowflakes; for synthetic events use `account_id` + deterministic hash |
| Dedupe key | `account_id` + `event_id` (or `message_id`/`interaction_id` when event_id absent) |
| Ordering | Per-channel best-effort Gateway order; **not** a global total order across accounts |
| Replay | Plugin may re-emit from durable inbound log after crash; consumers must be idempotent |
| Raw metadata | Optional; must pass redaction; never store bot tokens |

## 2. Target normalized event types

Map **real** Discord events → normalized names. Do not invent Discord capabilities.

| Normalized type | Typical Discord source | V1 |
|---|---|---|
| `discord.message.created` | `MESSAGE_CREATE` | MUST |
| `discord.message.updated` | `MESSAGE_UPDATE` | SHOULD |
| `discord.message.deleted` | `MESSAGE_DELETE` | SHOULD |
| `discord.interaction.created` | `INTERACTION_CREATE` | MUST |
| `discord.button.clicked` | interaction `component` type button | MUST |
| `discord.select.changed` | select menu interaction | V2 |
| `discord.modal.submitted` | modal submit | V2 |
| `discord.thread.created` | `THREAD_CREATE` | SHOULD |
| `discord.thread.updated` | `THREAD_UPDATE` | SHOULD |
| `discord.reaction.added` | `MESSAGE_REACTION_ADD` | V2 |
| `discord.reaction.removed` | `MESSAGE_REACTION_REMOVE` | V2 |
| `discord.member.joined` | `GUILD_MEMBER_ADD` | V2 |
| `discord.member.updated` | `GUILD_MEMBER_UPDATE` | V2 |
| `discord.ready` | Gateway READY (per account) | MUST (internal) |
| `discord.disconnected` | Gateway close | MUST (internal) |
| `discord.rate_limited` | REST 429 observation | MUST (internal) |

## 3. Relationship to Core observability (OBSERVED + OPEN)

Plugin-normalized `discord.*` events are **not** automatically valid
`observability.emit` types (closed set). Bridging:

```text
discord.message.created
  → (after binding) observability.emit('request.received', { …hashes… })
discord.button.clicked → consumer intent
  → may later emit approval.* only when wired to real approval path
discord.* tool side effects
  → tool.called / tool.returned / tool.failed
```

**OPEN CONTRACT:** extend Core event schema with `discord.*` vs keep dual-layer
(plugin log + Core bridge).

## 4. Payload sketches (PROPOSED, non-normative)

### `discord.message.created`

```text
content_hash, content_size, has_attachments, attachment_meta[]
author: { user_id, bot, roles[]? }
mention_ids[], referenced_message_id?
```

Full message content may be passed to the session prompt path separately;
prefer hashes in durable observability payloads (OBSERVED redaction doctrine).

### `discord.button.clicked`

```text
custom_id, message_id, values? 
intent_kind?   # consumer-defined string, opaque to Core
```

Buttons transport **intent**, never authorization.
