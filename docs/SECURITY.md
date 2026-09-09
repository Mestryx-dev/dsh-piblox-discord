# Security — dsh-piblox-discord

**STATUS:** IMPLEMENTED (credential plane) / LIVE GATEWAY NOT ACTIVATED

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
dsh-piblox-secrets          ← token vault SSOT (LOCKED — ADR-0012)
```

## 2. Core axiom (LOCKED)

```text
Discord interaction = input / intent
Discord interaction ≠ authorization
```

> Compromise of the Discord bot token must not automatically grant authorization
> to domain executors.

## 3. Token & credential handling (LOCKED)

| Rule | Detail |
|---|---|
| Storage | **dsh-piblox-secrets** only (ADR-0012) |
| Config | credential **references** only (`DISCORD_<ID>_BOT_TOKEN`) |
| Settings API | `credentials.configured` boolean; optional admin `ref`; **never** value |
| Browser | write-only token field; after save shows Configured / Replace / Remove |
| Process env | avoid materializing into `process.env` unless secrets policy allows |
| Logs | never log tokens; canary tests assert absence |
| Rotation | vault upsert; old value remains until upsert succeeds; Gateway restart later |
| Removal | vault delete; account stays → `missing_credentials`; no empty login attempt |
| Multi-account | one secret per account; compromise ≠ all accounts |

### Forbidden storage

Raw tokens must never appear in: cordis.patch.yml, accounts ledger, outbox, inbound dedupe,
ConversationBinding, localStorage, observability payloads, Git, or model-facing tools.

## 4. Allowlists & intents

- Guild / channel / user allowlists (**LOCKED** fail-closed: `[]` = deny all).
- Privileged intents labeled in Settings; defaults least-privilege.
- Bot Discord permissions least-privilege per account role.

## 5. DSH permissions vs Discord permissions

| Layer | Question |
|---|---|
| Discord permission | Can the **bot** perform the API call? |
| Plugin allowlist | Is this guild/channel accepted by config? |
| DSH policy | May this **agent/tool/action** run? |
| Domain policy | Is this maintenance/ops action allowed now? |

## 6. Agent boundary

`discordAccounts` / credential ops are **operator admin only** — not model tools.

Agent tools remain semantic (`discord.message.send`), never `discord.authenticate(token)`.

## 7. Audit & redaction

- Public account objects pass canary leak asserts in tests.
- Prefer content hashes in Core events; full text stays in session store as appropriate.
