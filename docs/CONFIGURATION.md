# Configuration — dsh-piblox-discord

**STATUS:** DESIGN / NOT IMPLEMENTED  
Schema is **PROPOSED**. Credential mechanism is **OBSERVED** (`secrets` service).

## Principles

1. **Multi-account first** — top-level `accounts` map; zero accounts = plugin idle.
2. **No inline secrets** — only credential **references** resolved via `secrets.resolve`.
3. **Allowlists default-deny** for guilds/channels unless explicitly opened.
4. **Account labels are opaque aliases** — not product branch names in code.

## Conceptual schema (PROPOSED)

```yaml
# Cordis plugin config block (illustrative — not live)
discord:
  # Optional plugin-wide defaults
  defaults:
    chunk_limit: 2000
    mention_parse: none
    outbound:
      max_attempts: 8
      base_backoff_ms: 500
    inbound:
      dedupe_ttl_hours: 72

  accounts:
    # Labels are config aliases only (examples, not Core branches)
    account_alpha:
      enabled: true
      credentials: DISCORD_BOT_TOKEN_ALPHA   # secrets vault key name
      intents:
        - Guilds
        - GuildMessages
        - GuildMessageReactions
        - DirectMessages
        - MessageContent                 # privileged — enable only if required
      allowed_guilds:
        - "123456789012345678"
      allowed_channels: []               # empty = all channels in allowed_guilds (PROPOSED)
      denied_channels: []
      dm:
        enabled: true
        allowed_users: []                # empty + enabled may mean deny-all — OPEN
      bindings:
        - kind: dm
          # uses ConversationBinding keys — see DSH-INTEGRATION.md
        - kind: channel
        - kind: thread
      inbound:
        require_mention_in_guild: true
        ignore_bots: true
      proactive_targets:
        ops_channel:
          guild_id: "123456789012345678"
          channel_id: "234567890123456789"
      routing:
        # hints only — not dsh-router replacement
        default_agent_alias: null
      observability:
        source_label: discord.account_alpha
      # policy references stay at tool/risk registry level — not duplicated here

    account_beta:
      enabled: false
      credentials: DISCORD_BOT_TOKEN_BETA
      intents:
        - Guilds
        - GuildMessages
        - DirectMessages
      allowed_guilds: []
      bindings: []
      proactive_targets: {}
```

## Field notes

| Field | Required | Notes |
|---|---|---|
| `account_id` (map key) | yes | Opaque label; encoded into ConversationBinding `scope` |
| `credentials` | yes | Vault key; resolved via OBSERVED `secrets.resolve` |
| `enabled` | yes | Soft disable without deleting config |
| `intents` | yes | Least privilege per account |
| `allowed_guilds` | yes | Empty + enabled → no guild traffic (PROPOSED fail-closed) |
| `allowed_channels` / `denied_channels` | no | Channel allow/deny |
| `dm.enabled` / `allowed_users` | no | DM policy |
| `bindings` | yes | Which conversation kinds create bindings |
| `inbound.*` | no | Mention gates, bot ignore |
| `proactive_targets` | no | Named aliases for notifications |
| `routing.default_agent_alias` | no | Consumer hint only |
| `observability.source_label` | no | Appears in emit meta/payload |

## Credentials (OBSERVED)

- Store tokens in `dsh-piblox-secrets` vault (or seat jumelage later).
- Plugin boots account only if `resolve(credentials).ok`.
- Never log token values; rely on observability redaction patterns.
- Invalid token → account state `failed_auth` (see STATE-RELIABILITY) without crashing other accounts.

## What is not configuration

- Compiled policy risk for `discord.*` tools → `dsh-policy-engine` / registries
- Session store path → ConversationBinding config
- Discord Application creation in Developer Portal → operator runbook (future)

## OPEN

1. Exact Cordis `Config` / Schemastery shape for the plugin package.
2. Whether `allowed_channels: []` means “all” or “none” — **must lock before coding** (fail-closed recommended).
3. Privileged intent documentation for operators (Message Content).
