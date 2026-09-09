# Security — dsh-piblox-discord

**STATUS:** DESIGN / NOT IMPLEMENTED

## 1. Trust boundaries

```text
Discord user
    ↓ (untrusted input)
Discord bot / application
    ↓ (platform auth of bot token)
dsh-piblox-discord          ← transport + normalization
    ↓
DSH runtime
    ↓
policy engine               ← authorization SSOT for tools
    ↓
domain plugin / consumer
    ↓
executor                    ← side effects
credential store (secrets)  ← token vault
```

## 2. Core axiom (LOCKED)

```text
Discord interaction = input / intent
Discord interaction ≠ authorization
```

> Compromise of the Discord bot token must not automatically grant authorization
> to domain executors.

A stolen token can spam channels or click-looking traffic into DSH as **input**.
Destructive domain actions still require `dsh-policy-engine` AUTO/APPROVAL paths
and domain checks.

## 3. Token & credential handling

| Rule | Detail |
|---|---|
| Storage | OBSERVED `secrets` vault (`dsh-piblox-secrets`) |
| Config | credential **references** only |
| Process env | avoid materializing into `process.env` unless explicitly allowed by secrets policy |
| Logs | redaction via observability patterns; never log Authorization headers |
| Rotation | account restart after vault update; no token in git |
| Multi-account | compromise of one token ≠ all accounts (isolate credentials) |

## 4. Allowlists & intents

- Guild / channel / user allowlists (PROPOSED fail-closed defaults).
- Privileged intents (e.g. Message Content) only when required.
- Bot Discord permissions least-privilege per account role.

## 5. DSH permissions vs Discord permissions

| Layer | Question |
|---|---|
| Discord permission | Can the **bot** perform the API call? |
| Plugin allowlist | Is this guild/channel accepted by config? |
| DSH policy | May this **agent/tool/action** run? |
| Domain policy | Is this maintenance/ops action allowed now? |

All four can deny. Discord allow ≠ DSH allow.

## 6. Policy gates for tools

- `discord.*` mutating tools: policy-evaluated via `tools/pre-execute` (OBSERVED).
- `discord.admin.*`: high risk (L3/L4 PROPOSED), audit required.
- Buttons that mean “approve reboot” must emit an **ApprovalIntent** to the
  domain/policy path — never call an executor from the Discord plugin.

## 7. Audit & redaction

- Mutating admin tools: mandatory audit fields (actor, account, targets, reason).
- Observability redacts token-like values (OBSERVED).
- Prefer content hashes in Core events; full text stays in session store as appropriate.

## 8. Unsafe admin actions

Explicitly dangerous: ban, kick, delete channel, permission edit, role assign with
admin privileges. Require APPROVAL or hard DENY in compiled policy until operators
open them.

## 9. Compromise scenarios

| Scenario | Impact | Mitigation |
|---|---|---|
| Bot token leaked | Attacker acts as bot on Discord; can inject messages/interactions into DSH as input | Rotate token; allowlists; policy still gates executors |
| Malicious Discord user | Prompt injection / social engineering via messages | Treat as untrusted text; no ambient admin |
| Plugin RCE | Full DSH seat risk | Normal host hardening; secrets break-glass controls |
| Confused deputy (button) | UI suggests power the bot lacks in policy | custom_id → intent only; policy re-check |

## 10. Forbidden patterns

- Inline `DISCORD_BOT_TOKEN` in repo or examples with real values
- `if` product branches that embed domain authorization in Core
- Parallel approval stores that skip `ctx.approval` / policy park path
- Singleton shared token across unrelated trust domains without isolation
