# Configuration — dsh-piblox-discord

**STATUS:** IMPLEMENTED (accounts ledger + Settings UI) / LIVE GATEWAY NOT ACTIVATED  

## Principles

1. **Multi-account first** — top-level `accounts` map; zero accounts = plugin idle.
2. **No inline secrets** — only credential **references** resolved via `dsh-piblox-secrets`.
3. **Allowlists default-deny** for guilds/channels unless explicitly opened.
4. **Account labels are opaque aliases** — not product branch names in code.
5. **Dashboard config == runtime plugin config** — SSOT = `discord-accounts.json` ledger.

## Operator workflow (LOCKED)

```text
Settings → Discord → Add account → paste bot token → Save
  → token stored by dsh-piblox-secrets as DISCORD_<ACCOUNT_ID>_BOT_TOKEN
  → account config stores only the reference

Settings → Secrets
  → generic vault UI (unchanged)
```

Discord Settings is a **domain facade**, not a second vault.

## Secret references (LOCKED)

Vault names must match `/^[A-Z][A-Z0-9_]*$/` (dsh-piblox-secrets constraint).

| account_id | credentials ref |
|---|---|
| `lab` | `DISCORD_LAB_BOT_TOKEN` |
| `infra` | `DISCORD_INFRA_BOT_TOKEN` |
| `vega` | `DISCORD_VEGA_BOT_TOKEN` |

`account_id` must match `/^[a-z][a-z0-9_]{0,47}$/`.

## Conceptual schema

```yaml
# Cordis boot seed (optional) — runtime SSOT is the accounts ledger
discord:
  transport: fake  # or discordjs (skeleton; no live connect without authorize)
  uiEnabled: true
  accounts:
    lab:
      enabled: true
      label: Lab bot
      credentials: DISCORD_LAB_BOT_TOKEN   # reference only
      intents:
        - Guilds
        - GuildMessages
        - DirectMessages
        - MessageContent                 # privileged — enable only if required
      allowed_guilds: []                 # LOCKED: empty = deny all
      allow_all_guilds: false
      allowed_channels: []               # LOCKED: empty = deny all
      allow_all_channels: false
      dm:
        enabled: false
        allowed_users: []                # LOCKED: empty = deny all
        allow_all_users: false
      ignore_bots: true
```

## Public Settings API (redacted)

`GET /api/discord/accounts` returns sanitized objects:

```json
{
  "account_id": "lab",
  "enabled": true,
  "credentials": { "configured": true, "ref": "DISCORD_LAB_BOT_TOKEN" },
  "status": "stopped",
  "scope_summary": { "guilds": "deny_all", "channels": "deny_all", "dm": "disabled" }
}
```

Never returns `token`, materialized secrets, or canary values.

## Admin HTTP

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/discord/accounts` | List sanitized accounts |
| POST | `/api/discord/accounts` | Create (+ optional token) |
| PATCH | `/api/discord/accounts/:id` | Update config (no token) |
| DELETE | `/api/discord/accounts/:id` | Delete config (`?deleteSecret=true` optional) |
| POST | `/api/discord/accounts/:id/credential` | Set/replace token |
| DELETE | `/api/discord/accounts/:id/credential` | Remove token |
| GET | `/api/discord/meta` | Intents catalog + fail-closed hints |

## Runtime status

| Status | Meaning |
|---|---|
| `disabled` | `enabled: false` |
| `missing_credentials` | No vault entry for credentials ref |
| `stopped` | Enabled + credentials; transport not started |
| `disconnected` | Transport started; **no** live Gateway session |
| `connected` | Live Gateway only (not faked) |
| `failed_auth` | Account isolated after auth failure |

## Reload classification

| Change | Classification |
|---|---|
| Vault write (`setSecret`) | HOT_RELOAD_SUPPORTED (store immediate) |
| Apply token to live Gateway | ACCOUNT_RESTART_REQUIRED |
| Accounts ledger mutation | HOT_RELOAD_SUPPORTED (in-process) |
| Cordis patch seed only | PROFILE_RESTART_REQUIRED |

## Credentials (OBSERVED)

- Write: `secrets.store.setSecret` / `POST /api/piblox-secrets` (create-or-replace)
- Delete: `secrets.store.deleteSecret` / `DELETE /api/piblox-secrets/:name`
- Resolve for live login (later): store `getSecretValue` or `secrets.resolve` after vault refresh
- There is **no** `ctx.secrets.set()` — use store/HTTP admin plane

## Fail-closed UI

Empty allowlist text boxes mean **deny all**. Broad access requires explicit checkboxes:

- Allow all guilds
- Allow all channels
- Allow all DM users

## Ledger path

Default: `~/dsh-lab/runtime/dsh-home/ledger/discord-accounts.json`
