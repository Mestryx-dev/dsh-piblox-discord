# Design status — dsh-piblox-discord

**STATUS:** DESIGN / NOT IMPLEMENTED  
**READY_FOR_IMPLEMENTATION:** NO

Statuses: `LOCKED` | `PROPOSED` | `OPEN` | `BLOCKED`

| DECISION | STATUS | EVIDENCE |
|---|---|---|
| Generic Discord provider (not product bot) | LOCKED | Mission §1–2; ADR-0001 |
| Cordis / DSH first-party plugin | LOCKED | O-05=c plugins path; mission §2.1 |
| Multi-account `0..N` | LOCKED | Mission §2.3; ADR-0002 |
| **Modern Discord API / Components V2 baseline** | **LOCKED** | **ADR-0007; API v10; discord.js 14.x; V2-native render** |
| Discord HTTP API `v10` (transport-isolated) | LOCKED | ADR-0007 |
| Client direction `discord.js` 14.x | LOCKED | ADR-0007 (exact pin OPEN at impl time) |
| Components V2 first-class (not legacy-first) | LOCKED | FEATURE-CONTRACT; ARCHITECTURE §5 |
| Legacy message compatibility | LOCKED | FEATURE-CONTRACT |
| Installation contexts modeled (`GUILD_INSTALL` / `USER_INSTALL`) | LOCKED | contracts; V1 ops may be guild-only |
| Interaction delivery-agnostic (Gateway now / HTTP later) | LOCKED | EVENT-CONTRACT §4 |
| Create Message `nonce` + `enforce_nonce` (no HTTP Idempotency-Key) | LOCKED | FEATURE + STATE-RELIABILITY |
| Lossless Discord bitfields | LOCKED | ADR-0007 |
| Forward-compatible events/components/REST escape hatch | LOCKED | ADR-0007; ARCHITECTURE §6 |
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
| Event contract (normalized) | PROPOSED | EVENT-CONTRACT.md (baseline LOCKED; field shapes PROPOSED) |
| Tool contract namespaces | PROPOSED | TOOL-CONTRACT.md |
| State ownership (no CB duplicate) | LOCKED | ADR-0005; OBSERVED CB store |
| Outbox / retry / 429 model | PROPOSED | STATE-RELIABILITY.md |
| Idempotency model (nonce vs operation IDs) | LOCKED principle / PROPOSED store shape | STATE-RELIABILITY + TOOL-CONTRACT |
| V1 feature set (incl. Components V2 foundation) | PROPOSED tiers / LOCKED baseline | FEATURE-CONTRACT.md (pending human lock of remaining OPEN) |
| V2 / LATER feature set | PROPOSED | FEATURE-CONTRACT.md |
| Voice strategy | OPEN | Explicitly LATER; no design commitment |
| Exact `discord.js` 14.x version pin | OPEN | Within LOCKED 14.x direction |
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
