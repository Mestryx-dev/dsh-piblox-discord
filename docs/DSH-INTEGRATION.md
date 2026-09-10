# DSH integration — dsh-piblox-discord

**STATUS:** DESIGN / NOT IMPLEMENTED  
Every API claim is tagged **OBSERVED** or **PROPOSED**. Gaps are **OPEN CONTRACT**.

**Harness (lab):** `@deepseek-ai/dsh-root` **`0.1.2-rc.1`** · commit `a66e470204` · tag `dsh-v0.1.2-rc.1`  
Checkout: `~/dsh-lab/runtime/deepseek-harness/`

**Session seam:** **RESOLVED** (2026-09-09) — in-process Cordis path mirrors upstream webhook.

---

## 1. Inspected first-party plugins (OBSERVED)

| Plugin | Cordis service | Lab path |
|---|---|---|
| `dsh-conversation-binding` | `conversationBinding` | `~/dsh-lab/plugins/dsh-conversation-binding` |
| `dsh-policy-engine` | `policy` | `~/dsh-lab/plugins/dsh-policy-engine` |
| `dsh-observability` | `observability` | `~/dsh-lab/plugins/dsh-observability` |
| `dsh-router` | `router` (heuristic MVP) | `~/dsh-lab/plugins/dsh-router` (**headless only**) |
| `dsh-piblox-secrets` | `secrets` | `~/dsh-lab/plugins/dsh-piblox-secrets` |
| `dsh-protocols` | `protocols` | `~/dsh-lab/plugins/dsh-protocols` |

Contract dossier SSOT: `WorkSpace/cockpit/piblox/dsh/50-contracts/CONVERSATION-BINDING.md`.

---

## 2. ConversationBinding (OBSERVED)

### Service

- Key: `conversationBinding`
- Does **not** create sessions, know chat products, or own Task/`correlation_id`
- Persistence: durable JSON ledger; file lock on create

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
- **No `:` allowed** in any field
- Core treats fields as **opaque**

### Discord key encoding (LOCKED — ADR-0010)

| Conversation kind | `provider` | `scope` | `external_id` |
|---|---|---|---|
| DM | `discord` | `<account_id>.dm` | `<user_id>` |
| Guild text channel | `discord` | `<account_id>.channel` | `<channel_id>` |
| Thread | `discord` | `<account_id>.thread` | `<thread_id>` |
| Channel + user (optional) | `discord` | `<account_id>.channel_user` | `<channel_id>.<user_id>` |

**Topology modes (ADR-0013):** account field `conversationMode` = `channel` (default) | `thread_per_conversation`.
In thread mode, each top-level launcher message creates/reconciles one Discord thread from that message, then binds `…thread:<thread_id>` and mints a new DSH session with `account.agentPreset`. Follow-ups inside the thread reuse the same binding/session. Assistant output targets the thread id only (never the launcher channel).

---

## 3. Session integration seam (OBSERVED — RESOLVED)

Primary in-process path for a Cordis Discord provider (same family as upstream webhook):

| Step | API | Package |
|---|---|---|
| Create | `ctx.agents.create(CreateAgentOptions)` | `@deepseek-ai/dsh-agent` → factory `@deepseek-ai/dsh-agent-loop` |
| Resume | `ctx.agents.resume(ResumeAgentOptions)` | same |
| Live lookup | `ctx.agents.get(sessionId)` | `@deepseek-ai/dsh-agent` |
| Prompt | `agent.followup(UserMessage)` | Agent face from `@deepseek-ai/dsh-agent-loop` |
| Message mint | `createUserMessage({ content, source })` | `@deepseek-ai/dsh-llm` |

### CREATE (OBSERVED)

```text
package: @deepseek-ai/dsh-agent (+ factory @deepseek-ai/dsh-agent-loop)
version: 0.1.2-rc.1
path: packages/core/agent/src/index.ts → AgentRegistry.create
      packages/core/agent-loop/src/index.ts → AgentLoop.createAgent
class/function: AgentRegistry.create / AgentFactory.createAgent
signature: async create(options: CreateAgentOptions): Promise<AgentHandle>
  CreateAgentOptions {
    sessionId: SessionId          // caller-supplied shared agent/session id
    meta?: { cwd?, parentSession?, agentPreset?, … }
    agentOptions?: AgentOptions
    signal?: AbortSignal
    setup?: AgentSetup            // compose unpublished scope BEFORE publication
    seed?: readonly SessionEvent[]
  }
returns: AgentHandle { agent: Agent; dispose(): Promise<void> }
caller evidence:
  packages/webhook/webhook/src/session.ts createWebhookSession()
    sessionId = brandString<SessionId>(`webhook-${randomUUID()}`)
    handle = await ctx.agents.create({ sessionId, signal, meta: { cwd, agentPreset }, setup })
    handle.agent.followup(createUserMessage({ … }))
```

Host/WebUI alternative (OBSERVED, same runtime):

```text
package: @deepseek-ai/dsh-api-session-controller 0.1.2-rc.1
path: packages/api/session-controller/src/commands.ts
function: SessionCommands.create / SessionCommands.prompt
  create → agents.ensureSession(sessionId, cwd, …) → { sessionId, agentPreset? }
  prompt → resolveAgent(sessionId) → agent.followup|steer(createUserMessage(…))
```

Discord plugin SHOULD use the **in-process `ctx.agents`** path (webhook pattern), not HTTP Host RPC.

### RESUME / LOAD (OBSERVED)

```text
ctx.agents.resume({ resumeSessionId, agentOptions?, signal?, setup? }) → AgentHandle
```

- Requires `sessionPersistence` service (throws if missing).
- Loads via `persistence.prepare(id)` then publishes like create.
- Host path: `ApiSessionAgents.resolveAgent` → live `agents.get` else resume; missing cold session → `ApiSessionNotFound` → RemoteError `session/not-found`.

Evidence: `packages/core/agent-loop/src/index.ts` `resume` / `resumeWith`; `packages/api/session-controller/src/agent.ts` `resolve` / `resume`.

### PROMPT / FOLLOWUP (OBSERVED)

```text
agent.followup(message: UserMessage): void
```

- Queues an ordinary next-turn inbox item and wakes the driver.
- Also: `steer` (next-step), `inject` (no wake), `send(message, target, wakeup)`.
- Host `session.prompt` builds `createUserMessage` then calls `followup` (or `steer` when `mode === 'steer'`).

Evidence: `packages/core/agent/src/runtime-types.ts`; `session-controller/src/commands.ts` `prompt`.

### OUTPUT (OBSERVED)

Durable firehose: Cordis event **`session/event`** on the Session scope.

| Concern | Session event types (core) |
|---|---|
| Streaming deltas | `assistant/chunk` |
| Final assistant text | `assistant/message` |
| Tool activity | `tool/call`, `tool/result` |
| Turn lifecycle | `turn/start`, `turn/end`, `step/start`, `step/end` |
| Errors / cancel | turn end reasons + agent cancel; request failures via loop (see session.md) |

Live coordination also emits `agent/status`, `agent/inbox/*` (not a substitute for durable `session/event`).

Evidence: `docs/subsystems/session.md`, `docs/subsystems/core.md`.

**PROPOSED Discord adapter:** subscribe to `session/event` for the bound session; map committed `assistant/message` (+ optional coalesced progress from chunks) to outbound Discord delivery. Do not invent a parallel transcript store.

**LOCKED (delivery):** mutable Discord `sentId` is **per-turn**, not per-session. `turn/start` opens a fresh delivery window; `turn/end` clears `sentId`. Session reuse via ConversationBinding must still produce a **new** Discord response each DSH turn. Intra-turn streaming may edit only that turn's message.

### SESSION FAILURE / RECOVERY (OBSERVED + PROPOSED adapter policy)

| Situation | OBSERVED runtime | Adapter SHOULD (PROPOSED, aligns CB contract) |
|---|---|---|
| Binding exists, agent live | `agents.get(id)` → `followup` | use live agent |
| Binding exists, agent cold, persistence OK | `agents.resume({ resumeSessionId })` | resume then `followup` |
| Binding exists, session not found / unloadable | `ApiSessionNotFound` / resume throw | `conversationBinding.unbind` → `resolveOrCreate` with new create |
| Corrupt inbox on resume | Inbox ctor throws on invalid splice | treat as load failure → unbind + recreate |
| `dispose()` on handle | removes agent **and** session from store | never dispose casually while binding still points at id |

### CONCURRENCY (OBSERVED)

- Multiple `followup` calls on the same agent are **queued** in the durable next-turn inbox.
- A `running` driver may span consecutive queued turns; later followups wake/queue rather than requiring adapter mutex for agent correctness.
- Host `session.prompt` maps rejection to `session/agent-busy` only for certain admission failures — ordinary queueing is the happy path.

**PROPOSED:** adapter may still serialize **outbound Discord delivery** per conversation; that is transport concern, not a substitute for the agent inbox.

### ROUTER (OBSERVED)

- No harness package calls `router.route` / `router.dispatch` during session create/prompt.
- `dsh-router` is a **first-party optional** plugin (wired on **headless**, not required on **web**).
- Session execution does **not** automatically invoke the router.

**PROPOSED:** Discord chat path does not inject/call `router`. Optional consumer config may call it later; never required for the provider Core.

### AGENT TARGETING (OBSERVED)

| Mechanism | How |
|---|---|
| Default model | `ctx.agentDefaultModel.currentSelection()` (webhook when model omitted) |
| Explicit agent preset | `meta.agentPreset` + `setup: (agentCtx) => ctx.agentPresets.mount(agentCtx, preset.id)` |
| Permission preset | `ctx.permissionPresets.set(session, id)` (webhook) |
| Routed multi-agent | **not** part of session create — would be explicit `dsh-router` call (optional, separate) |

---

## 4. ConversationBinding `createSessionId` (OBSERVED recipe)

`resolveOrCreate` calls `createSessionId` **only when the binding is missing**, under lock, and stores the returned string as `session_id`.

**SHOULD call (conceptual — OBSERVED primitives):**

```text
async createSessionId() {
  const sessionId = brandString<SessionId>(`discord-${randomUUID()}`)  // or account-scoped prefix
  const handle = await ctx.agents.create({
    sessionId,
    meta: {
      cwd: <configured absolute workspace>,
      agentPreset: <optional preset id from account routing hints>,
    },
    agentOptions: { provider, model, … },  // or rely on default model via setup
    setup: async (agentCtx) => {
      if (preset) await ctx.agentPresets.mount(agentCtx, preset.id)
      // optional: installInitialModelSelection like webhook
    },
  })
  // PROPOSED: retain handle in plugin AccountSessionRegistry[sessionId] = handle
  return String(sessionId)
}
```

**After first creation (inbound message):**

```text
const { binding } = await conversationBinding.resolveOrCreate(identity, { createSessionId })
const sessionId = binding.session_id
// CRITICAL (dsh-agent 0.1.2-rc.1):
//   agents.create/resume → AgentHandle { agent, dispose }
//   agents.get(id)       → bare Agent (NOT a handle)
// Never do: agents.get(id).agent.followup  → always undefined → silent agent_unavailable
const owned = accountSessionRegistry.get(sessionId)          // Handle from create/resume
const agent =
  owned?.agent
  ?? ctx.agents.get(sessionId)
  ?? (await ctx.agents.resume({ resumeSessionId: sessionId, setup: … })).agent
agent.followup(createUserMessage({
  content: [{ type: 'text', text: <normalized content> }],
  source: { kind: 'user' /* or a dedicated source kind if/when allowed */ },
}))
// followup is sync void (inbox wake). Do not await turn completion on the admission path.
```

Source `kind` values are constrained by LLM message types — webhook uses `kind: 'webhook'`. Discord may use `kind: 'user'` initially (**PROPOSED** until a dedicated source kind exists upstream).

---

## 5. Real call graph

```text
discord.message.created                         [PROPOSED normalize]
  → ConversationBinding.resolve                 [OBSERVED]
  → (no binding) prepareDiscordSessionCreate    [OBSERVED webhook-parity]
      account.agentPreset → agentPresets.resolve + mount
      sessionCwd → meta.cwd · agentDefaultModel → agentOptions
  → ConversationBinding.resolveOrCreate         [OBSERVED]
      → createSessionId → ctx.agents.create     [OBSERVED]  (first time / remint only)
  → session_id
  → ctx.agents.get | ctx.agents.resume          [OBSERVED]
  → agent.followup(createUserMessage(…))        [OBSERVED]
  → AgentLoop driver / tools / LLM              [OBSERVED]
  → session/event (assistant/chunk|message, tool/*, turn/*)  [OBSERVED]
  → Discord outbound adapter                    [PROPOSED]
```

**Account → agent mapping (LOCKED):** Discord account field `agentPreset` stores the canonical DSH preset id. Changing assignment applies to **new** bindings / remints only — existing ConversationBinding sessions are not remounted.

Parallel Host path (WebUI / API gateway — OBSERVED, not preferred for in-process plugin):

```text
session.create → ensureSession → agents.create
session.prompt → resolveAgent → followup
```

---

## 6. Cordis inject (minimum)

| Service | Class | Why |
|---|---|---|
| `agents` | **REQUIRED** | create / resume / get / followup |
| `conversationBinding` | **REQUIRED** | binding SSOT |
| `secrets` | **REQUIRED** | Discord token refs |
| `agentPresets` | **REQUIRED** | resolve / mount / standingKeyFor (new Discord session mint; fail-closed) |
| `agentDefaultModel` | **REQUIRED** | LLM route (`agentOptions`); orthogonal to preset composition |
| `permissionPresets` | **OPTIONAL** | session permission preset |
| `workspaceRegistry` | **OPTIONAL** | workspace attach (webhook); Discord uses plugin `sessionCwd` → `meta.cwd` |
| `sessionTitle` | **OPTIONAL** | human titles |
| `observability` | **OPTIONAL** (recommended) | Core event bridge; soft-get OK if absent |
| `tools` | **OPTIONAL** soft-inject | registers `discord_*` when `exposeTools !== false` (default) |
| `router` | **NOT_REQUIRED** | not on session path |
| `policy` | **NOT_REQUIRED** as inject | when loaded in profile, `tools/pre-execute` applies globally |
| `protocols` | **NOT_REQUIRED** | Task ledger not required for chat provider Core |

Upstream analogue inject (OBSERVED webhook):  
`agents`, `agentDefaultModel`, `agentPresets`, `permissionPresets`, `sessionTitle`, `workspaceRegistry`.

---

## 7. Tool registration (OBSERVED — semantic tools registered)

| Concern | Evidence |
|---|---|
| Registration API | `ctx.tools.register(definition)` — **one-arg object** with mandatory `output: { schema, render }` (`@deepseek-ai/dsh-tools`) |
| Inject | Hard `inject: […, 'tools']` then `ctx.effect(() => ctx.tools.register(def))` (secrets cookbook — soft inject does not catalog tools) |
| Schema | `name`, `description`, `parameters` (JSON Schema), `output`, `async execute` |
| Tool ids | Underscore (`discord_message_send`); dotted `discord.*` via policy `tool_name_map` |
| Policy path | Cordis waterfall **`tools/pre-execute`** — `dsh-policy-engine` + observability |
| Auto traversal | **Yes** — `tools.execute` goes through pre-execute |
| V1 mutation decision | Risk **L2**; compiled override → **AUTO** (Discord allowlists = scope gate). Default L2 without override = APPROVAL (+ park on web). |
| Service vs tools | Proactive = `ctx.discord.notify`. Model = `discord_*` → semantic service → outbox |
| Raw REST | `discord.rest.raw` **not registered** (DEFERRED_WITH_BLOCKER) |

Manifest: Cordis bundle row via `cordis.patch.yml` / `package.json` `dsh.bundle.patch` (sibling plugins).

**Presets:** registering tools does **not** auto-expose them to every agent. Permission / preset allowlists still apply.

---

## 8. Policy / observability (unchanged summary)

### Policy (OBSERVED)

- Service `policy`; APPROVAL park via `tools/pre-execute` + `ctx.approval`.
- `policy.requestApproval()` remains a stub.
- Discord semantic reads L0–L1; mutations L2 with V1 AUTO overrides (see §7).

**NON-BLOCKING / V2:** Discord as `approvalChannel` / direct UI integration with
`ctx.approval` is deferred until DSH exposes a stable approval-channel seam.
V1 transports generic Discord interactions/intents only — **no** parallel
approval store in this plugin.

### Observability (OBSERVED + LOCKED for V1)

- Closed Core `EVENT_TYPES`; bridge Discord via allowed Core types + payloads.
- Plugin owns normalized `discord.*` events.
- Do **not** extend `dsh-observability` EVENT_TYPES in V1.

---

## 9. Secrets / credentials (OBSERVED)

```text
secrets.resolve(ref) → { ok, value? }
```

---

## 10. Remaining OPEN (non-session)

1. Profile wiring / activation (forbidden until operator authorizes).
2. Dedicated `MessageSource.kind` for Discord (may start as `user`).
3. Exact Cordis Config / Schemastery shape (including explicit allowlist opt-in field names).
4. Exact `discord.js` 14.x pin — **implementation detail** at package/lockfile creation (architecture remains 14.x).

**Closed (2026-09-09):** allowlist empty-list = deny all; V1 observability
bridge-only (no Core EVENT_TYPES extension); approvalChannel = V2 / non-blocking;
transport = `LOCKED_DIRECT_DISCORDJS` (ADR-0009).

**Closed (2026-09-10):** proactive API = service; model tools = policy-gated `discord_*`;
both share DeliveryOutbox; `discord.rest.raw` deferred.
