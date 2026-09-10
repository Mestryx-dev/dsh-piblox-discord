# Design status — dsh-piblox-discord

**STATUS:** V1 TRANSPORT CLOSURE + CONFIG PLANE PASS / UI FROZEN FOR LIVE SMOKE  
**TRANSPORT_DECISION:** **LOCKED_DIRECT_DISCORDJS**  
**TRANSPORT_CLOSURE:** **PASS**  
**DISCORD_CONFIG_PLANE:** **PASS** (2026-09-09)  
**DISCORD_SETTINGS_LAYOUT:** **PASS** (2026-09-09)  
**UI_FROZEN_FOR_LIVE_SMOKE:** **YES**  
**ALL_NORMAL_OUTBOUND_VIA_OUTBOX:** **LOCKED**  
**CREDENTIAL_OWNER:** **dsh-piblox-secrets** (LOCKED — ADR-0012)  
**MODERN_DISCORD_BASELINE:** **LOCKED** (ADR-0007)  
**LIVE_DISCORD_READY:** **YES** (transport)  
**LIVE_DISCORD_CREDENTIAL_READY:** **YES** (controlled real dev token may be used next)

Statuses: `LOCKED` | `IMPLEMENTED` | `TESTED` | `DESIGNED_FOR_LIVE` | `PROPOSED` | `OPEN` | `BLOCKED` | `LATER`

| DECISION | STATUS | EVIDENCE |
|---|---|---|
| Generic Discord provider | LOCKED | ADR-0001 |
| Cordis first-party plugin | LOCKED + IMPLEMENTED | `src/index.js` |
| Multi-account `0..N` | LOCKED + TESTED | accounts service + Settings |
| **Modern Discord API / Components V2 baseline** | **LOCKED** | **ADR-0007** — HTTP `v10`, discord.js 14.x, Components V2 first-class, delivery-agnostic interactions, `nonce`/`enforce_nonce`, lossless bitfields, forward-compatible envelopes |
| Components V2 foundation in V1 MUST | LOCKED + **IMPLEMENTED** (encode + opaque nodes) | FEATURE-CONTRACT + `src/components/` |
| Interaction normalize / ACK / dedupe | **IMPLEMENTED** (Gateway) | bridge + outbox interaction ops |
| Legacy message compatibility | LOCKED + **IMPLEMENTED** | FEATURE-CONTRACT (compat path, not design center) |
| Application command / install contexts (model) | LOCKED | FEATURE-CONTRACT — CHAT_INPUT/USER/MESSAGE + GUILD_INSTALL/USER_INSTALL; V1 ops may be guild-only without hard-coding |
| Interaction delivery independence | LOCKED | EVENT-CONTRACT — Gateway now; HTTP endpoint V2 adapter |
| Webhooks (incoming + Webhook Events) | LOCKED (V2 target) | FEATURE-CONTRACT — not architecturally excluded |
| Credential ownership = piblox-secrets | **LOCKED** | ADR-0012 |
| Settings → Discord section | **IMPLEMENTED + TESTED** | `src/client/index.js` |
| Accounts ledger SSOT | **IMPLEMENTED + TESTED** | `discord-accounts.json` |
| Write-only token UX | **IMPLEMENTED + TESTED** | canary asserts |
| Fail-closed allowlists | LOCKED + TESTED | |
| Durable outbox | LOCKED + TESTED | ADR-0011 |
| Inbound dedupe | LOCKED + TESTED | |
| Live Gateway/REST | BLOCKED / LATER | operator authorize |
| Profile activation | BLOCKED | operator authorize |

## Feature-tier reminder (LOCKED — not an implementation order)

| Tier | Intent |
|---|---|
| **V1 MUST** | Modern Gateway/REST; Components V2 foundation; legacy compat; basic message model; buttons; basic selects; defer/follow-up; File/attachments; event normalization; forward-compatible envelope |
| **V2** | Full V2 convenience; modern modals; File Upload; Radio/Checkbox groups; polls; user/message commands; USER_INSTALL ops; HTTP interactions; webhooks; richer media |
| **LATER** | Voice/audio; stage; Activities/Social SDK; scale sharding |

Contract-closure pass: **documentation only** — deferred features are not implemented by this lock.

## Operator surfaces

```text
Settings
├── General
├── Models
├── Secrets          ← generic vault (dsh-piblox-secrets)
├── Discord          ← domain facade (this plugin)
├── Plugins
└── Agent presets
```

## Runtime honesty

```text
DSH API contract = OBSERVED
adapter tests = TESTED against deterministic facade
full profile AgentLoop integration = NOT YET LIVE-SMOKED
live Discord Gateway = NOT CONNECTED
Modern Discord / Components V2 baseline = LOCKED (target architecture)
```
