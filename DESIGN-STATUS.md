# Design status — dsh-piblox-discord

**STATUS:** DESIGN / NOT IMPLEMENTED  
**TRANSPORT_DECISION:** **LOCKED_DIRECT_DISCORDJS** (ADR-0007 + ADR-0009; operator-approved 2026-09-09)  
**TRANSPORT_DECISION_READY:** **YES**  
**READY_FOR_IMPLEMENTATION:** **YES** (session seam + transport + closed stale contracts; no `src/` yet)

Statuses: `LOCKED` | `PROPOSED` | `OPEN` | `BLOCKED`

| DECISION | STATUS | EVIDENCE |
|---|---|---|
| Generic Discord provider (not product bot) | LOCKED | Mission §1–2; ADR-0001 |
| Cordis / DSH first-party plugin | LOCKED | O-05=c plugins path; mission §2.1 |
| Multi-account `0..N` | LOCKED | Mission §2.3; ADR-0002 |
| **Modern Discord API / Components V2 baseline** | **LOCKED** | **ADR-0007** |
| Discord HTTP API `v10` (transport-isolated) | LOCKED | ADR-0007 |
| Client direction `discord.js` 14.x | LOCKED | ADR-0007; Satori evaluated → rejected (ADR-0009) |
| Exact `discord.js` 14.x version pin | LOCKED (impl detail) | Pin when package/lockfile created; not an architecture blocker |
| **Transport layer** | **LOCKED_DIRECT_DISCORDJS** | ADR-0009 — operator-approved |
| Satori (`@satorijs/core` + adapter-discord) | Rejected (evidence retained) | Cordis 3.x vs DSH 4.x FAIL; Components V2 gap (ADR-0009) |
| Components V2 first-class (not legacy-first) | LOCKED | FEATURE-CONTRACT; ARCHITECTURE |
| Legacy message compatibility | LOCKED | FEATURE-CONTRACT |
| Installation contexts modeled | LOCKED | contracts |
| Interaction delivery-agnostic | LOCKED | EVENT-CONTRACT |
| Create Message `nonce` + `enforce_nonce` | LOCKED | FEATURE + STATE-RELIABILITY |
| Lossless Discord bitfields | LOCKED | ADR-0007 |
| Forward-compatible transport | LOCKED | ADR-0007 |
| Reuse `conversationBinding` | LOCKED | OBSERVED + ADR-0003 |
| Discord binding key encoding | PROPOSED | DSH-INTEGRATION §2 |
| Policy boundary (intent ≠ auth) | LOCKED | ADR-0004 |
| Observability integration | LOCKED | Mission §2.6 |
| Plugin owns normalized `discord.*` events | LOCKED | EVENT-CONTRACT; V1 |
| Bridge `discord.*` → closed Core EVENT_TYPES | LOCKED | V1 — do **not** extend dsh-observability schema |
| Extend Core EVENT_TYPES with `discord.*` | Rejected for V1 | Deferred; bridge only |
| Credential ownership via `secrets` | LOCKED | OBSERVED |
| **Session create/resume/followup seam** | **LOCKED** | **ADR-0008; `ctx.agents` + `followup` + `session/event` @ 0.1.2-rc.1** |
| Session mint via Host RPC only | Rejected | ADR-0008 |
| Routing model (adapter, not router) | LOCKED | Router not on harness session path |
| Exact session mint / prompt seam | **LOCKED** | Was OPEN; resolved ADR-0008 |
| Discord as `approvalChannel` / `ctx.approval` | NON-BLOCKING / V2 | Generic interactions in V1; no parallel approval store; direct UI seam deferred |
| Event contract (normalized) | PROPOSED | EVENT-CONTRACT.md |
| Tool contract namespaces | PROPOSED | TOOL-CONTRACT.md |
| Tool registration path | LOCKED (observed) | `ctx.tools.register` + `tools/pre-execute` waterfall |
| State ownership (no CB duplicate) | LOCKED | ADR-0005 |
| Outbox / retry / 429 model | PROPOSED | STATE-RELIABILITY.md |
| Idempotency model | LOCKED principle | nonce / operation IDs |
| V1 feature set | PROPOSED tiers / LOCKED baseline | FEATURE-CONTRACT.md |
| V2 / LATER feature set | PROPOSED | FEATURE-CONTRACT.md |
| Voice strategy | OPEN | LATER |
| FakeTransport | PROPOSED | FEATURE + STATE-RELIABILITY |
| Config allowlist empty-list semantics | **LOCKED** | `[]` = deny all; broad access requires explicit opt-in (CONFIGURATION.md) |
| Profile activation / wiring | BLOCKED | Needs operator authorize |
| Live Discord Application / tokens | BLOCKED | Until implementation spike authorized |
| Implementation `src/` | BLOCKED until coding mission | READY + TRANSPORT unlock coding mission only |

## Term audit (bootstrap docs)

| Term | Allowed use in docs |
|---|---|
| vega / infra | Config **aliases** / consumer examples — never Core branches |
| maintenance / cursor | Non-goals / REFERENCE Atlas lessons only |
| DISCORD_BOT_TOKEN | Credential **reference naming** examples — no real secrets |
| singleton | Rejected (`ONE_PLUGIN = ONE_BOT`) |
| execute / approve / policy / session / state | Architecture vocabulary with explicit owners |
