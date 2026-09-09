# Tool contract — dsh-piblox-discord

**STATUS:** DESIGN / NOT IMPLEMENTED  
Tool names and shapes are **PROPOSED**. Policy gating is **LOCKED**.  
Risk classes must be registered with `dsh-policy-engine` before enablement (**OPEN** registry rows).

## Namespaces

| Namespace | Purpose | Default policy posture |
|---|---|---|
| `discord.*` | Normal messaging / read / mild mutation | Mostly L0–L2 |
| `discord.admin.*` | Guild administration / moderation | L2–L4, always audited |

All tools take `account_id` (or resolve a default only if exactly one account enabled — PROPOSED).

---

## Normal tools `discord.*`

### `discord.guild.list`

| | |
|---|---|
| Purpose | List guilds visible to account |
| Inputs | `account_id` |
| Output | `guilds[] { id, name }` |
| Discord perms | Bot membership |
| Policy | L0 read |
| Idempotency | read-only |
| Audit | optional |

### `discord.channel.list` / `discord.channel.get`

| | |
|---|---|
| Purpose | List/get channels in a guild |
| Inputs | `account_id`, `guild_id`, optional filters |
| Output | channel metadata |
| Discord perms | ViewChannel |
| Policy | L0 |
| Idempotency | read-only |

### `discord.message.get` / `discord.message.history`

| | |
|---|---|
| Purpose | Fetch message(s) |
| Inputs | `account_id`, `channel_id`, `message_id` / cursor / limit |
| Output | message DTOs (redacted in logs) |
| Discord perms | Read Message History |
| Policy | L0–L1 |
| Idempotency | read-only |

### `discord.message.send`

| | |
|---|---|
| Purpose | Send message to channel/DM (legacy and/or Components V2 tree) |
| Inputs | `account_id`, `channel_id`, `content`? / embeds? / `components`? / files, optional durable `operation_id` |
| Output | `message_id`, delivery state, `nonce` used |
| Discord perms | SendMessages (+ AttachFiles / component-related as required) |
| Policy | L1–L2 (PROPOSED) |
| Idempotency | Map `operation_id` → Discord **`nonce`** + **`enforce_nonce=true`** where applicable. Do **not** send a fabricated HTTP `Idempotency-Key`. |
| Audit | yes for non-ephemeral ops traffic |

### `discord.rest.raw` (escape hatch — V1 MUST capability)

| | |
|---|---|
| Purpose | Call an unsupported/new Discord REST `v10` endpoint without architecture rewrite |
| Inputs | `account_id`, method, path, body?, durable `operation_id` |
| Output | status, bounded/redacted body, rate-limit metadata |
| Discord perms | whatever the endpoint requires |
| Policy | **always classified** (default high / APPROVAL for unknown mutating paths) |
| Idempotency | durable `operation_id` + Discord resource reconciliation when applicable |
| Audit | **required** |
| Guards | credentials, rate-limit, allowlists, redaction — **must not** bypass DSH policy |

### `discord.message.reply` / `edit` / `delete`

| | |
|---|---|
| Purpose | Reply / edit / delete |
| Inputs | account, channel, message ids + content |
| Output | message id / ok |
| Discord perms | SendMessages / ManageMessages as applicable |
| Policy | reply/edit L1–L2; delete L2 |
| Idempotency | edit/delete keyed by target message + op |

### `discord.thread.create` / `discord.thread.list`

| | |
|---|---|
| Purpose | Create/list threads |
| Inputs | channel, name, message_id?, auto_archive |
| Output | `thread_id` |
| Discord perms | Create Public/Private Threads |
| Policy | L1–L2 |
| Idempotency | create with client key — avoid partial multi-step without outbox group |

### `discord.reaction.add` / `remove` (V2)

Policy L1; idempotent on emoji+message.

### `discord.member.get` / `discord.role.list`

Read-only L0–L1.

---

## Administrative tools `discord.admin.*`

**All policy-gated. Compromise of bot token ≠ automatic allow.**

### Channel admin

| Tool | Purpose | Policy (PROPOSED) | Audit |
|---|---|---|---|
| `discord.admin.channel.create` | Create channel | L3 APPROVAL | required |
| `discord.admin.channel.edit` | Edit channel | L3 | required |
| `discord.admin.channel.delete` | Delete channel | L4 | required |

### Role admin

| Tool | Purpose | Policy | Audit |
|---|---|---|---|
| `discord.admin.role.create` | Create role | L3 | required |
| `discord.admin.role.edit` | Edit role | L3 | required |
| `discord.admin.role.assign` | Assign/remove role | L3 | required |

### Permissions

| Tool | Purpose | Policy | Audit |
|---|---|---|---|
| `discord.admin.permissions.inspect` | Inspect overwrites | L1 | optional |
| `discord.admin.permissions.edit` | Edit overwrites | L4 | required |

### Moderation

| Tool | Purpose | Policy | Audit |
|---|---|---|---|
| `discord.admin.member.timeout` | Timeout member | L3 | required |
| `discord.admin.member.kick` | Kick | L4 | required |
| `discord.admin.member.ban` | Ban | L4 | required |

Inputs always include `account_id`, target snowflakes, reason string, and
`idempotency_key` for mutating ops.

---

## Classification for V1 vs later

**V1 MUST tools:** `channel.get`, `message.send` (V2-capable), `message.reply`,
`message.edit`, `thread.create` (basic), `guild.list` (basic), `rest.raw` (gated).

**V1 SHOULD:** `message.history`, `message.delete`, `permissions.inspect`.

**V2+:** full `discord.admin.*`, reactions, modal helpers, webhook tools,
richer select/media convenience APIs.

## OPEN

1. Exact tool id strings in `tools.yaml` / compiled policy `tool_risk`.
2. Mapping DSH tool names → policy `toolNameMap` entries.
3. Whether proactive notification API is a tool, a service method, or both.
