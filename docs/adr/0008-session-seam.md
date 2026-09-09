# ADR-0008: In-process agents.create/resume/followup session seam

- Status: Accepted
- Date: 2026-09-09
- Deciders: Florian (session-seam resolution mission)

## Context

`dsh-piblox-discord` must bind Discord conversations to DSH sessions via
`conversationBinding.resolveOrCreate`. The remaining blocker was the exact
runtime API to mint, resume, and prompt sessions on harness `0.1.2-rc.1`.

## Decision

Use the **in-process Cordis AgentRegistry** path (same pattern as
`@deepseek-ai/dsh-webhook`):

1. `createSessionId` → mint `SessionId` → `ctx.agents.create({ sessionId, meta, setup })` → return id string.
2. Later inbound → `ctx.agents.get(id)` or `ctx.agents.resume({ resumeSessionId })`.
3. Submit text → `agent.followup(createUserMessage(…))`.
4. Observe output → `session/event` (`assistant/chunk`, `assistant/message`, `tool/*`, `turn/*`).
5. Missing/unloadable session → unbind ConversationBinding and recreate (CB contract).

Do **not** require Host HTTP `session.create` / `session.prompt` for the provider Core.
Do **not** require `dsh-router` on the chat path.

## Consequences

- Plugin must retain/dispose `AgentHandle`s carefully (dispose removes session).
- Inject minimum includes `agents`, `conversationBinding`, `secrets`.
- READY_FOR_IMPLEMENTATION may flip YES for the session seam; Discord approval
  channel and Core event-type extension remain separate OPEN items.

## Rejected alternatives

| Alternative | Why rejected |
|---|---|
| Only Host RPC `session.prompt` | Extra auth/gateway surface; webhook shows in-process is first-class |
| Invent plugin-local session runtime | Violates CB / session ownership |
| Require router on every Discord message | Router not on harness session path; headless-only optional plugin |

## Evidence

- `@deepseek-ai/dsh-agent` / `dsh-agent-loop` / `dsh-webhook` / `dsh-api-session-controller` @ `0.1.2-rc.1` (`a66e470204`)
- `docs/DSH-INTEGRATION.md` §3–5
