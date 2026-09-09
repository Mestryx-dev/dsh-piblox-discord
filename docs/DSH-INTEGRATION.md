# DSH integration — dsh-piblox-discord

**STATUS:** DESIGN / NOT IMPLEMENTED  
Every API claim is tagged **OBSERVED** or **PROPOSED**. Gaps are **OPEN CONTRACT**.

## 1. Inspected first-party plugins (OBSERVED)

| Plugin | Cordis service | Lab path |
|---|---|---|
| `dsh-conversation-binding` | `conversationBinding` | `~/dsh-lab/plugins/dsh-conversation-binding` |
| `dsh-policy-engine` | `policy` | `~/dsh-lab/plugins/dsh-policy-engine` |
| `dsh-observability` | `observability` | `~/dsh-lab/plugins/dsh-observability` |
| `dsh-router` | `router` (heuristic MVP) | `~/dsh-lab/plugins/dsh-router` |
| `dsh-piblox-secrets` | `secrets` | `~/dsh-lab/plugins/dsh-piblox-secrets` |
| `dsh-protocols` | `protocols` | `~/dsh-lab/plugins/dsh-protocols` |

Contract dossier SSOT: `WorkSpace/cockpit/piblox/dsh/50-contracts/CONVERSATION-BINDING.md`.

---

## 2. ConversationBinding (OBSERVED)

### Service

- Key: `conversationBinding`
- Does **not** create sessions, know chat products, or own Task/`correlation_id`
- Persistence: durable JSON ledger (default under operator home); file lock on create

### API (OBSERVED)

```text
canonicalKey(identity) → "provider:scope:external_id"
resolve(identity) → record | null
resolveOrCreate(identity, { createSessionId }) → { binding, created, key }
listBySession(session_id) → record[]
touch(identity)
unbind(identity)
dump()
```

### Identity constraints (OBSERVED)

- Fields: `provider`, `scope`, `external_id` — all non-empty strings
- **No `:` allowed** in any field (canonical key uses `:`)
- Core treats fields as **opaque** — Discord adapter chooses encodings

### Binding record (OBSERVED)

`provider`, `scope`, `external_id`, `session_id`, `created_at`, `last_activity_at`

### Discord key proposals (PROPOSED)

Account id must be encoded inside `scope` or `external_id` (no fourth field exists).

Convention (no colons):

| Conversation kind | `provider` | `scope` | `external_id` |
|---|---|---|---|
| DM | `discord` | `<account_id>.dm` | `<user_id>` |
| Guild text channel | `discord` | `<account_id>.channel` | `<channel_id>` |
| Thread | `discord` | `<account_id>.thread` | `<thread_id>` |
| Channel + user (optional) | `discord` | `<account_id>.channel_user` | `<channel_id>.<user_id>` |

Notes:

- Discord snowflakes are globally unique; channel vs thread ids do not collide in practice, but **scope still distinguishes** conversation kind for GC/TTL and human audit.
- `account_id` is the plugin config label (not the Discord application id), so two bots in the same guild do not share bindings.
- Guild id is **context metadata**, not part of the binding identity (per ConversationBinding non-goals).

### Adapter duties (PROPOSED)

1. Build identity as above.
2. `resolveOrCreate(identity, { createSessionId })` where `createSessionId` calls the **DSH session mint seam** (OPEN — exact SDK/ACP/`ctx.agents` API to use must be confirmed before coding).
3. On session load failure: `unbind` + recreate (explicit policy, OBSERVED contract).
4. Never invent a second binding store.

---

## 3. Policy engine (OBSERVED)

### Service API surface (OBSERVED from `src/index.js`)

```text
evaluate(input) → Decision
preview(agent, tools[]) 
thresholds()
killSwitchActive()
resolveCorrelationId(sessionId, task)
parkForApproval / markExecuted / explain / …
requestApproval() → stub: use tools/pre-execute park path (ctx.approval)
resume() → stub: upstream approval answerer
```

### Behaviour relevant to Discord

- Tool calls go through Cordis `tools/pre-execute` waterfall → AUTO / APPROVAL / DENY.
- APPROVAL park reuses upstream `ctx.approval` (`@deepseek-ai/dsh-user-approval`).
- Config: `onApproval: park | deny`.
- Discord interactions must **not** bypass this path for sensitive tools.

### OPEN CONTRACT — Discord as approval channel

Product dossiers mention future `approvalChannel: "chat-gateway"`. Today park/resume is WebUI/ACP-oriented. Relaying APPROVAL prompts to Discord buttons requires an explicit design against `ctx.approval` — **do not invent a parallel grant store**.

---

## 4. Observability (OBSERVED)

### Service API

```text
mint(sessionId) → correlation_id
bind(sessionId, correlationId)
current(sessionId)
emit(type, payload, meta)
redact(obj)
replay(correlation_id)
metrics(window)
ledger()
isDegraded() / flushBuffer()
```

### Closed event types (OBSERVED)

Includes: `request.received`, `tool.called`, `tool.returned`, `tool.failed`,
`policy.evaluated`, `approval.*`, `task.*`, `router.decided`, …
**Does not include** `discord.*` types.

### PROPOSED bridging

| Discord normalized event | Core emit |
|---|---|
| Inbound message → session turn | `request.received` (+ payload hashes) |
| Tool send/reply | `tool.called` / `tool.returned` / `tool.failed` |
| Approval button outcome | `approval.granted` / `approval.denied` (only when wired to real approval) |
| Transport abort | `request.aborted` |

Keep full Discord-normalized stream in plugin-local durable log if needed
(**PROPOSED**, transport state — not a second correlation system).

**OPEN CONTRACT:** whether Core event schema should gain `discord.*` types later.

---

## 5. Router / sessions (OBSERVED + OPEN)

### Router MVP (OBSERVED)

```text
router.route(request, sessionCtx) → decision { correlation_id, agents, handToPlanner, … }
router.dispatch(decision, goalText) → { mode: simple|planner, task? }
```

Injects: `tools`, `observability`, `protocols`, `policy`.

Discord must **not** reimplement router. PROPOSED options for inbound text:

1. Adapter resolves binding → prompts existing session (SDK/ACP/`session.prompt`) — preferred for chat continuity.
2. Optionally call `router.route` when a consumer profile wants multi-agent classification.

Exact session prompt / agent followup seam for Cordis plugins: **OPEN CONTRACT**
(confirm against harness version used in lab before implementation).

### Multi-agent (LOCKED intent)

Plugin may expose **routing primitives** (account, guild, channel → target agent alias
in config). It must not become the DSH router.

---

## 6. Secrets / credentials (OBSERVED)

`dsh-piblox-secrets` provides Cordis `secrets`:

```text
resolve(ref) → { ok, value? }
materialize(keys, target)
secretsGet(key, reason)  # break-glass gated
```

**PROPOSED:** each Discord account config references a secret name, e.g.
`credentials: DISCORD_BOT_TOKEN_VEGA`, resolved at account start — never inline
tokens in YAML or docs examples with real values.

Sibling pattern in community REFERENCE used `tokenRef` + credentials plane;
first-party Mestryx path prefers `secrets.resolve`.

---

## 7. End-to-end flows

### Inbound (PROPOSED)

```text
normalized Discord event
  → binding resolveOrCreate
  → session_id
  → observability mint/bind
  → session prompt / agent followup
  → (optional) router for multi-agent profiles
  → outbound Discord delivery
```

### Outbound (PROPOSED)

```text
DSH / tool / consumer
  → discord.* tool or proactive API
  → policy pre-execute (tools)
  → outbox
  → Discord REST
  → delivery state + observability
```

---

## 8. OPEN CONTRACT checklist (blockers before coding)

1. Exact DSH session create/resume/prompt API for `createSessionId` + inbound text.
2. Discord approval channel vs existing `ctx.approval` park path.
3. Whether Core `EVENT_TYPES` gains Discord types or stays payload-bridged.
4. Cordis `inject` list for this plugin (`conversationBinding`, `observability`, `secrets`, `tools`, …).
5. Profile wiring strategy (new discord profile vs headless/web) — out of scope to activate now.
