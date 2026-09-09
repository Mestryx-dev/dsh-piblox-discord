# Design status — dsh-piblox-discord

**STATUS:** V1 SPIKE IMPLEMENTED (FakeTransport) / NOT PRODUCTION-ACTIVATED  
**TRANSPORT_DECISION:** **LOCKED_DIRECT_DISCORDJS** (ADR-0007 + ADR-0009)  
**TRANSPORT_DECISION_READY:** **YES**  
**READY_FOR_IMPLEMENTATION:** **YES**  
**V1_SPIKE:** **PASS** (2026-09-09)

Statuses: `LOCKED` | `IMPLEMENTED` | `TESTED` | `PROPOSED` | `OPEN` | `BLOCKED` | `LATER`

| DECISION | STATUS | EVIDENCE |
|---|---|---|
| Generic Discord provider (not product bot) | LOCKED | ADR-0001 |
| Cordis / DSH first-party plugin | LOCKED + IMPLEMENTED | `src/index.js` apply/inject |
| Multi-account `0..N` | LOCKED + TESTED | FakeTransport + lifecycle tests |
| Modern Discord / Components V2 baseline | LOCKED | ADR-0007; model kinds in `types.js` (renderer LATER) |
| Discord HTTP API `v10` | LOCKED | ADR-0007 |
| Client `discord.js` **14.27.0** | LOCKED + IMPLEMENTED | `package.json` pin; skeleton only |
| Transport `LOCKED_DIRECT_DISCORDJS` | LOCKED | ADR-0009 |
| Satori | Rejected | ADR-0009 (evidence retained) |
| FakeTransport | IMPLEMENTED + TESTED | `src/transport/fake.js` |
| DiscordJsTransport live connect | LATER | skeleton validates import; no Gateway |
| Allowlist `[]` = deny all + explicit opt-in | LOCKED + TESTED | `src/config.js` |
| Cordis Config shape | IMPLEMENTED | `normalizePluginConfig` (plain object; Schemastery optional later) |
| Binding key encoding | **LOCKED** + TESTED | ADR-0010 |
| MessageSource.kind | LOCKED (V1) | `kind: 'user'` — no Core `discord` kind |
| Session seam agents.create/resume/followup | LOCKED + TESTED | bridge + deterministic agents facade |
| ConversationBinding reuse | LOCKED + TESTED | real `dsh-conversation-binding` |
| Observability bridge (no Core EVENT_TYPES discord.*) | LOCKED + TESTED | `request.received` emit |
| approvalChannel / ctx.approval | NON-BLOCKING / V2 | |
| Durable outbox / rate-limit engine | PROPOSED / LATER | FakeTransport failure hooks only |
| Full Components V2 renderer | LATER | kinds reserved |
| Profile activation / live tokens | BLOCKED | operator authorize |

## Spike call graph (TESTED)

```text
FakeTransport.injectMessage
  → DiscordSessionBridge.handleInbound
  → authorizeInbound (allowlists)
  → buildBindingIdentity
  → conversationBinding.resolveOrCreate(+ agents.create)
  → agent.followup(createDiscordUserMessage / kind:user)
  → session/event (assistant/chunk|message|turn/end)
  → FakeTransport.send/reply/edit
```
