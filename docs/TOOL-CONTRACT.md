# Tool contract — dsh-piblox-discord

**STATUS:** SEMANTIC TOOLS + SERVICE **IMPLEMENTED** (FakeTransport + Gateway LAB) / `discord.rest.raw` **DEFERRED**  
**LOCKED:** Model tools are policy-gated wrappers over the Cordis `discord` semantic service; both share DeliveryOutbox.

## Ownership (LOCKED)

| Surface | Role |
|---|---|
| `ctx.discord` (Cordis service) | Transport/domain API for trusted plugins + **proactive notifications** |
| `discord_*` model tools | Wrappers registered via `ctx.tools.register(definition)` → `tools/pre-execute` → policy → service → outbox |

Proactive notifications are **service methods** (`discord.notify` / `messageSend`). They are **not** fake LLM tool calls.  
Model actions remain **tools** and must traverse policy.

```text
domain plugin / proactive producer
  → ctx.discord.notify | messageSend | …
  → DeliveryOutbox → Discord transport

Agent / model
  → ctx.tools
  → tools/pre-execute
  → dsh-policy-engine
  → discord_* tool execute
  → ctx.discord semantic service
  → DeliveryOutbox → Discord
```

No direct REST from tool wrappers. No token arguments. No Vega-specific tool branches.

## Registration (OBSERVED DSH contract)

- Package: `@deepseek-ai/dsh-tools` — **one-arg** `register(definition)` with mandatory `output: { schema, render }`
- Hard-inject `tools` (secrets cookbook) when registering model tools; `exposeTools !== false` (default)
- Tool **ids use underscores** (`discord_message_send`) for policy/Vega id compatibility  
  Conceptual namespace `discord.*` maps via `tool_name_map` (e.g. `discord.message.send` → `discord_message_send`)

## V1 registered tools

| Tool id | Policy action | Risk | Notes |
|---|---|---|---|
| `discord_guild_list` | `discord.guild.list` | L0 | read |
| `discord_channel_get` | `discord.channel.get` | L0 | allowlisted |
| `discord_channel_list` | `discord.channel.list` | L0 | bounded |
| `discord_message_get` | `discord.message.get` | L0 | bounded content |
| `discord_message_history` | `discord.message.history` | L1 | bounded |
| `discord_message_send` | `discord.message.send` | L2 → AUTO override | outbox + nonce ≤25 |
| `discord_message_reply` | `discord.message.reply` | L2 → AUTO override | outbox |
| `discord_message_edit` | `discord.message.edit` | L2 → AUTO override | outbox |
| `discord_thread_create` | `discord.thread.create` | L2 → AUTO override | reuses durable `thread:create:…` op |

V1 compiled overrides map Discord mutation actions → **AUTO** because account allowlists are the scope gate; Core HITL park still requires an open agent turn (approval-channel V2). Risk remains **L2** for observability.

All tools require explicit `account_id` (no silent “only online account” default).

### Inputs (semantic)

Mutating tools accept semantic `target` and/or channel/message ids — **not** tokens, Authorization headers, Discord API URLs, discord.js objects, or raw outbox ledger shapes.

`operation_id` (optional): durable idempotency for the **plugin outbox**.  
Mapped to Discord Create Message **`nonce` + `enforce_nonce`** where applicable.  
**Not** a Discord HTTP `Idempotency-Key` header.

### Receipt (semantic)

```text
operation_id, account_id, state, discord_resource_id?, attempts, error_class?, correlation_id?
```

Default service path: durable **acceptance** (`queued`/`accepted`).  
Optional `wait: true` bounds outbox ticks until delivered / retry_wait / failed_terminal.  
Tools currently wait (bounded) for LAB ergonomics.

## Target model

```text
{ kind: "channel"|"thread"|"dm"|"alias", id?, alias?, guildId?, parentChannelId?, userId? }
```

Alias resolution is **account-local** via `proactiveTargets` on the account ledger.  
Authorization after resolve: guild allowlist → channel|parent allowlist → DM policy. Fail closed.  
Bot outbound skips guild-user allowlist (bot is the actor).

## Proactive notifications

```js
await ctx.discord.notify({
  accountId: '…',
  target: { alias: 'notifications' },
  content: '…',
  components?: [/* ComponentNode */],
  operationId?: '…',
})
```

- Does **not** mint ConversationBinding / DSH session / AgentLoop
- Later component clicks use the existing interaction contract

## `discord.rest.raw`

**DEFERRED_WITH_BLOCKER:** policy engine lacks method/path classification, allowlisted REST routes, redaction/rate-limit op type, and transport raw escape. Semantic tools are the V1 priority. Do not register until those guards exist — unknown mutating raw would be an authorization bypass risk.

## Admin tools `discord.admin.*`

Unchanged — V2 / not registered in this mission.

## Idempotency note

| Field | Meaning |
|---|---|
| `operation_id` | Plugin outbox durable identity |
| Discord `nonce` | Derived ≤25 chars from `operation_id` for Create Message |
| HTTP `Idempotency-Key` | **Not used** — do not invent |
