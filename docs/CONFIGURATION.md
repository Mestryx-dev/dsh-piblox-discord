# Configuration — dsh-piblox-discord

**STATUS:** IMPLEMENTED (accounts ledger + Settings UI) / LIVE GATEWAY NOT ACTIVATED  

## Principles

1. **Multi-account first** — top-level `accounts` map; zero accounts = plugin idle.
2. **No inline secrets** — only credential **references** resolved via `dsh-piblox-secrets`.
3. **Allowlists default-deny** for guilds / channels / guild users / DM users unless explicitly opened.
4. **Account labels are opaque aliases** — not product branch names in code.
5. **Dashboard config == runtime plugin config** — SSOT = `discord-accounts.json` ledger.
6. **Guild user auth ≠ DM user auth** — top-level `allowAllUsers` / `allowedUsers` gate guild MESSAGE_CREATE; `dm.*` remains independent.

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
      allowed_users: []                  # LOCKED: guild MESSAGE_CREATE users; empty = deny all
      allow_all_users: false             # distinct from dm.allow_all_users
      dm:
        enabled: false
        allowed_users: []                # LOCKED: empty = deny all (DM only)
        allow_all_users: false
      ignore_bots: true
```

Guild MESSAGE_CREATE authorization order (LOCKED):

```text
account → guild → channel → guild user → bot rejection → dedupe → ConversationBinding / AgentLoop
```

Denied guild users never claim dedupe, create bindings, open sessions, follow up, or enqueue outbound.
There is **no** Discord Administrator / permission-bit implicit bypass.

## Public Settings API (redacted)

`GET /api/discord/accounts` returns sanitized objects:

```json
{
  "account_id": "lab",
  "enabled": true,
  "credentials": { "configured": true, "ref": "DISCORD_LAB_BOT_TOKEN" },
  "status": "stopped",
  "scope_summary": { "guilds": "deny_all", "channels": "deny_all", "users": "deny_all", "dm": "disabled" }
}
```

Never returns `token`, materialized secrets, or canary values.

## Admin HTTP

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/discord/accounts` | List sanitized accounts |
| POST | `/api/discord/accounts` | Create (+ optional token) — admin session required |
| PATCH | `/api/discord/accounts/:id` | Update config (no token) — admin session required |
| DELETE | `/api/discord/accounts/:id` | Delete config (`?deleteSecret=true` optional) — admin session required |
| POST | `/api/discord/accounts/:id/credential` | Set/replace token — admin session required |
| DELETE | `/api/discord/accounts/:id/credential` | Remove token — admin session required |
| GET | `/api/discord/meta` | Intents catalog + fail-closed hints |

**PLUGIN_HTTP_ADMIN_AUTH = PLUGIN_REQUIRED.** `dsh-host-webserver` has no server-wide auth; longer plugin prefixes bypass Connection’s `/api` bridge. Mutations use `ctx.connection.requestRejection` (fail closed 503 if Connection missing). Same-origin remains CSRF defense.

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
| Vault write (`secrets.set` / `secrets.delete`) | HOT_RELOAD_SUPPORTED (`resolve()` immediate) |
| Apply token to live Gateway | ACCOUNT_RESTART_REQUIRED |
| Accounts ledger mutation | HOT_RELOAD_SUPPORTED (in-process) |
| Cordis patch seed only | PROFILE_RESTART_REQUIRED |

## Credentials (OBSERVED)

- Write: `ctx.secrets.set(name, value)` (preferred) — encrypted store + in-memory vault atomically
- Delete: `ctx.secrets.delete(name)`
- Resolve for live login: `ctx.secrets.resolve(ref)` (no restart required after set/delete)
- HTTP admin: `POST|DELETE /api/piblox-secrets` (also hot-updates vault)
- Fallback: `secrets.store.*` for older secrets installs without `set`/`delete`
- Never put tokens in `process.env` or Discord account config

## Fail-closed UI

Empty allowlist text boxes mean **deny all**. Broad access requires explicit checkboxes:

- Allow all guilds
- Allow all channels
- Allow all DM users

## Ledger path

Default: `~/dsh-lab/runtime/dsh-home/ledger/discord-accounts.json`

Cordis `accounts` is a **first-install seed only** (no ledger file yet). After the file exists,
the operator owns it: deleting all accounts must stay empty across plugin restart — boot config
must not rehydrate accounts. Profile boot still refreshes `transport` / `allowConnect` each start.
