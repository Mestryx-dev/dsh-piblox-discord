# Design status — dsh-piblox-discord

**STATUS:** DESIGN / NOT IMPLEMENTED  
**READY_FOR_IMPLEMENTATION:** NO

Statuses: `LOCKED` | `PROPOSED` | `OPEN` | `BLOCKED`

| DECISION | STATUS | EVIDENCE |
|---|---|---|
| Generic Discord provider (not product bot) | LOCKED | Mission §1–2; ADR-0001 |
| Cordis / DSH first-party plugin | LOCKED | O-05=c plugins path; mission §2.1 |
| Multi-account `0..N` | LOCKED | Mission §2.3; ADR-0002 |
| Reuse `conversationBinding` | LOCKED | OBSERVED service + ADR-0003 |
| Discord binding key encoding | PROPOSED | DSH-INTEGRATION §2 |
| Policy boundary (intent ≠ auth) | LOCKED | Mission §2.5; ADR-0004; OBSERVED policy park path |
| Observability integration (no parallel Core telemetry) | LOCKED | Mission §2.6; OBSERVED `observability` service |
| Bridge `discord.*` → closed Core event types | PROPOSED | EVENT-CONTRACT; OBSERVED closed EVENT_TYPES |
| Extend Core EVENT_TYPES with `discord.*` | OPEN | Requires observability/schema change |
| Credential ownership via `secrets` | LOCKED | OBSERVED `dsh-piblox-secrets`; ADR-0005 adjacent |
| Routing model (adapter, not router) | PROPOSED | DSH-INTEGRATION §5 |
| Exact session mint / prompt seam | OPEN | Need harness API confirmation |
| Discord as `approvalChannel` | OPEN | `policy.requestApproval` stub; WebUI park today |
| Event contract (normalized) | PROPOSED | EVENT-CONTRACT.md |
| Tool contract namespaces | PROPOSED | TOOL-CONTRACT.md |
| State ownership (no CB duplicate) | LOCKED | ADR-0005; OBSERVED CB store |
| Outbox / retry / 429 model | PROPOSED | STATE-RELIABILITY.md |
| Idempotency model | PROPOSED | STATE-RELIABILITY + TOOL-CONTRACT |
| V1 feature set | PROPOSED | FEATURE-CONTRACT.md (pending human lock) |
| V2 / LATER feature set | PROPOSED | FEATURE-CONTRACT.md |
| Voice strategy | OPEN | Explicitly LATER; no design commitment |
| Discord library choice (discord.js vs other) | OPEN | Not required for docs bootstrap |
| FakeTransport | PROPOSED | FEATURE + STATE-RELIABILITY |
| Config allowlist empty-list semantics | OPEN | CONFIGURATION.md |
| Profile activation / wiring | BLOCKED | Mission forbids modifying profiles now |
| Live Discord Application / tokens | BLOCKED | Mission forbids |
| Implementation `src/` | BLOCKED | Until OPEN material items reviewed |

## Term audit (bootstrap docs)

Occurrences of sensitive terms are intentional and scoped:

| Term | Allowed use in docs |
|---|---|
| vega / infra | Config **aliases** / consumer examples — never Core branches |
| maintenance / cursor | Non-goals / REFERENCE Atlas lessons only |
| DISCORD_BOT_TOKEN | Credential **reference naming** examples — no real secrets |
| singleton | Rejected (`ONE_PLUGIN = ONE_BOT`) |
| execute / approve / policy / session / state | Architecture vocabulary with explicit owners |
