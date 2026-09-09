# ADR-0012: Discord credential ownership = dsh-piblox-secrets

**Status:** LOCKED  
**Date:** 2026-09-09

## Context

Discord bot tokens must not live in Cordis patch YAML, the Discord accounts ledger,
outbox, dedupe, ConversationBinding, browser Settings responses, or logs.

`dsh-piblox-secrets` already provides an embedded AES-256-GCM vault with:

- `POST /api/piblox-secrets` create-or-replace
- `DELETE /api/piblox-secrets/:name`
- `GET /api/piblox-secrets/names` (configured without value)
- `ctx.secrets.resolve` / `materialize` (credential plane, not model tools)

Secret names are constrained to `/^[A-Z][A-Z0-9_]*$/`.

## Decision

1. **Token values** are owned exclusively by **dsh-piblox-secrets**.
2. **Account config** (allowlists, intents, enabled, credentials *reference*) is owned
   by **dsh-piblox-discord** durable ledger `discord-accounts.json` (SSOT), because
   Cordis/profile plugin config is not a safe mutable runtime API.
3. Secret reference format (LOCKED):

   ```text
   DISCORD_<ACCOUNT_ID>_BOT_TOKEN
   ```

   Example: account `lab` → `DISCORD_LAB_BOT_TOKEN`.

   The preferred dotted form `discord.<account_id>.bot_token` is **rejected** by the
   vault naming rules; UPPER_SNAKE encoding is mandatory.

4. Dashboard **Settings → Discord** is a domain facade over `/api/discord/*`.
   Generic vault management remains **Settings → Secrets**.
5. Admin `discordAccounts` service is **not** registered as model tools.

## Consequences

- Token rotation = vault upsert + ACCOUNT_RESTART_REQUIRED for live Gateway (later).
- Token removal = vault delete; account remains → `missing_credentials`.
- Account delete does not auto-destroy ConversationBinding / outbox; secret delete is opt-in.
- Dashboard config == runtime plugin config via the accounts ledger.
