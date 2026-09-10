# Design status — dsh-piblox-discord

**STATUS:** **V1 PRODUCTION_READY=YES** (2026-09-10) — semantic surface closed; freeze pending operator tag/release  
**TRANSPORT_DECISION:** **LOCKED_DIRECT_DISCORDJS**  
**TRANSPORT_CLOSURE:** **PASS**  
**CAPABILITY_MATRIX:** [`docs/CAPABILITY-MATRIX.md`](docs/CAPABILITY-MATRIX.md) (authoritative coverage)  
**DISCORD_CONFIG_PLANE:** **PASS**  
**ALL_NORMAL_OUTBOUND_VIA_OUTBOX:** **LOCKED**  
**CREDENTIAL_OWNER:** **dsh-piblox-secrets** (LOCKED — ADR-0012)  
**MODERN_DISCORD_BASELINE:** **LOCKED** (ADR-0007)  
**LIVE_DISCORD_READY:** **YES**  
**PRODUCTION_READY:** **YES** (V1 semantic; `discord.rest.raw` ACCEPTED_DEFER)

Statuses: `LOCKED` | `IMPLEMENTED` | `TESTED` | `DESIGNED_FOR_LIVE` | `PROPOSED` | `OPEN` | `BLOCKED` | `LATER`

| DECISION | STATUS | EVIDENCE |
|---|---|---|
| Generic Discord provider | LOCKED | ADR-0001 |
| Cordis first-party plugin | LOCKED + IMPLEMENTED | `src/index.js` |
| Multi-account `0..N` | LOCKED + TESTED | accounts service + Settings |
| **Modern Discord API / Components V2 baseline** | **LOCKED** | **ADR-0007** |
| Components V2 foundation in V1 MUST | LOCKED + **IMPLEMENTED** | `src/components/` + live Button/Select |
| Interaction normalize / ACK / dedupe | **IMPLEMENTED** | Gateway + outbox |
| Message delete + attachments | **IMPLEMENTED + LIVE** | semantic + outbox; CAPABILITY-MATRIX |
| MESSAGE_UPDATE / DELETE normalize | **IMPLEMENTED** | transport + bridge (no transcript mutation) |
| Durable outbox + crash recovery | LOCKED + TESTED | ADR-0011 + reliability tests |
| Fail-closed allowlists | LOCKED + TESTED + LIVE | LAB scopes unchanged |
| `discord.rest.raw` | **DEFERRED** (non-blocking) | Policy blockers; semantic sufficient |
| Live Gateway/REST | **PASS** | LAB web profile |
| npm publish / git tag | **OPERATOR** | No publish without authorization |

## Feature-tier reminder (LOCKED)

| Tier | Intent |
|---|---|
| **V1 MUST** | Modern Gateway/REST; Components V2 foundation; legacy compat; send/reply/edit/**delete**/attachments; buttons; basic selects; defer/follow-up; event normalization |
| **V2** | Full V2 convenience; modals; File Upload; Radio/Checkbox; polls; commands; USER_INSTALL ops; HTTP interactions; webhooks |
| **LATER** | Voice/audio; stage; Activities/Social SDK; scale sharding |

## Operator surfaces

```text
Settings → Discord  ← domain facade (this plugin)
Settings → Secrets  ← dsh-piblox-secrets vault
```

## Runtime honesty

```text
DSH API contract = OBSERVED
adapter tests = 185 PASS
LAB Gateway = CONNECTED (vega, allowlists fail-closed)
PRODUCTION_READY = YES (V1 semantic surface)
discord.rest.raw = DEFERRED_WITH_BLOCKER (accepted non-blocking)
```
