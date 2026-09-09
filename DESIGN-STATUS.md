# Design status — dsh-piblox-discord

**STATUS:** V1 TRANSPORT CLOSURE + CONFIG PLANE PASS / LIVE_DISCORD_CREDENTIAL_READY=YES (dev token next; not prod)  
**TRANSPORT_DECISION:** **LOCKED_DIRECT_DISCORDJS**  
**TRANSPORT_CLOSURE:** **PASS**  
**DISCORD_CONFIG_PLANE:** **PASS** (2026-09-09)  
**ALL_NORMAL_OUTBOUND_VIA_OUTBOX:** **LOCKED**  
**CREDENTIAL_OWNER:** **dsh-piblox-secrets** (LOCKED — ADR-0012)  
**LIVE_DISCORD_READY:** **YES** (transport)  
**LIVE_DISCORD_CREDENTIAL_READY:** **YES** (controlled real dev token may be used next)

Statuses: `LOCKED` | `IMPLEMENTED` | `TESTED` | `DESIGNED_FOR_LIVE` | `PROPOSED` | `OPEN` | `BLOCKED` | `LATER`

| DECISION | STATUS | EVIDENCE |
|---|---|---|
| Generic Discord provider | LOCKED | ADR-0001 |
| Cordis first-party plugin | LOCKED + IMPLEMENTED | `src/index.js` |
| Multi-account `0..N` | LOCKED + TESTED | accounts service + Settings |
| Credential ownership = piblox-secrets | **LOCKED** | ADR-0012 |
| Settings → Discord section | **IMPLEMENTED + TESTED** | `src/client/index.js` |
| Accounts ledger SSOT | **IMPLEMENTED + TESTED** | `discord-accounts.json` |
| Write-only token UX | **IMPLEMENTED + TESTED** | canary asserts |
| Fail-closed allowlists | LOCKED + TESTED | |
| Durable outbox | LOCKED + TESTED | ADR-0011 |
| Inbound dedupe | LOCKED + TESTED | |
| Live Gateway/REST | BLOCKED / LATER | operator authorize |
| Profile activation | BLOCKED | operator authorize |

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
```
