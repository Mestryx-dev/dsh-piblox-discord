# ADR-0009: Satori Discord transport evaluation

- Status: Accepted (operator-approved)
- Date: 2026-09-09
- Deciders: Florian (transport audit mission; transport decision APPROVED 2026-09-09)

## Context

Before implementing `dsh-piblox-discord`, we evaluated whether
`@satorijs/core` + `@satorijs/adapter-discord` could replace a direct
`discord.js` transport while sharing the DSH Cordis runtime with first-party
plugins. ADR-0007 already locks a **`discord.js` 14.x** client direction;
this ADR records evidence for or against Satori without reopening the DSH
session seam (ADR-0008).

## Evidence summary

### DSH Cordis runtime (OBSERVED)

| Package | Version | Path | Resolution |
|---|---|---|---|
| `@deepseek-ai/cordis` | **4.0.2** | `~/dsh-lab/runtime/deepseek-harness/vendor/cordis` | workspace link → profile `node_modules/.pnpm/@deepseek-ai+cordis@4.0.2` |
| `@deepseek-ai/cordis-plugin-loader` | **1.0.3** | `vendor/loader` | harness vendor |
| `@deepseek-ai/cordis-plugin-include` | **1.0.7** | `vendor/include` | harness vendor |
| `cordis` (npm) | — | **not present** in web/headless profile lockfiles | — |
| `@cordisjs/core` | — | **not present** | — |
| `@cordisjs/plugin-http` | — | **not vendored** in harness (documented as intentionally unvendored) | — |
| `@cordisjs/plugin-server` | — | **not present** | — |

Harness: `@deepseek-ai/dsh-root@0.1.2-rc.1` · commit `a66e470204`.  
Profiles `web` + `headless` resolve a **single** `@deepseek-ai/cordis@4.0.2` tree
(OBSERVED via `pnpm-lock.yaml`). First-party plugins (`conversationBinding`,
`policy`, `secrets`, …) register services on the **same** boot `Context`
(OBSERVED: `apps/cli/src/profile-boot.ts` → `boot(...)`).

### Satori packages (OBSERVED — npm metadata + extracted `@4.6.0` / `@4.6.2` tarballs)

| Package | Version | Cordis requirement | Other deps |
|---|---|---|---|
| `@satorijs/core` | **4.6.0** | **`cordis ^3.18.1`** (peer + bundled dep) | `@cordisjs/plugin-http ^0.6.3`, `@satorijs/element`, `@satorijs/protocol` |
| `@satorijs/adapter-discord` | **4.6.2** | via `@satorijs/core` | none runtime (peer `@satorijs/core`) |

- **Cordis-native:** yes — plugins extend `cordis` Context, provide `satori` service.
- **Koishi-specific:** no runtime Koishi dependency; docs/homepage reference Koishi ecosystem.
- **Node:** not explicitly pinned in manifests (standard Node ESM).
- **Multi-account:** OBSERVED pattern — `ctx.plugin(discord, { token })` per account;
  `Bot.reusable = true`; dispose via plugin fork (`fork.dispose()`).
- **HTTP dependency:** `DiscordBot.inject = ['http']` — requires `@cordisjs/plugin-http` service.

### Same-context compatibility: **FAIL**

| Check | Result |
|---|---|
| Cordis package identity | **FAIL** — DSH uses `@deepseek-ai/cordis@4.0.2`; Satori hard-depends on npm `cordis@^3.18.1` |
| Duplicate trees | **Fatal if both installed** — separate `Service.tracker`, `Context.session`, module augmentation (`declare module 'cordis'`) |
| HTTP service | **FAIL** — Satori needs `@cordisjs/plugin-http@0.6.3` (Cordis 3.x peer); DSH does not ship it |
| Upstream Cordis 4 Satori | **UNKNOWN / not available** — `@satorijs/core@4.6.0` latest on npm still pins Cordis 3.x |

Co-loading Satori into the DSH profile Context without a harness-level port of
the entire Satori stack to `@deepseek-ai/cordis@4.x` is **not evidence-backed**.

### Call graphs (OBSERVED from source)

**Inbound**

```text
Discord Gateway (v=10)
  → WsClient (@satorijs/adapter-discord/src/ws.ts)
  → Gateway.Payload parse / HELLO / IDENTIFY|RESUME / DISPATCH
  → bot.dispatch(session)
      → ctx.emit('internal/session', session)
      → ctx.emit('discord/<event-kebab>', raw, bot)   [raw passthrough]
      → adaptSession() → normalized Session
      → ctx.emit('message' | 'interaction/button' | …, session)
```

**Outbound**

```text
Consumer (Cordis listener / Bot API)
  → bot.createMessage / sendMessage / internal.* REST
  → DiscordMessageEncoder (@satorijs/adapter-discord/src/message.ts)
  → bot.http ( @cordisjs/plugin-http via ctx.http.extend )
  → Discord REST https://discord.com/api/v10/...
```

Key types: `DiscordBot`, `WsClient`, `Internal`, `Session` (`@satorijs/core`),
`ctx.satori`, `ctx.bots[sid]`.

### Feature gaps vs FEATURE-CONTRACT (strict)

| Area | Satori + adapter-discord | Gap class |
|---|---|---|
| API v10 REST/Gateway | IMPLEMENTED | — |
| Gateway reconnect/resume | IMPLEMENTED (WsClient + adapter base retry) | — |
| Multi-account | IMPLEMENTED (plugin fork per token) | maps to `account_id` is PROPOSED adapter concern |
| Legacy components (ActionRow, buttons, selects, text input) | IMPLEMENTED | — |
| **Components V2** (Section, Container, Text Display, File, Media Gallery, Separator, Label, Radio/Checkbox groups, flag `1<<15`) | **MISSING** in types + encoder | **BLOCKER** vs ADR-0007 |
| Create Message `nonce` + `enforce_nonce` | **MISSING** in encoder paths | **BLOCKER** vs STATE-RELIABILITY |
| REST rate-limit buckets / Retry-After | **PARTIAL** — webhook 429 comment only; no bucket engine in adapter | plugin still owns queue |
| Durable outbox / inbound dedupe / delivery receipts | **MISSING** | plugin ownership unchanged |
| Sharding runtime | **MISSING** (types only; ws.ts no shard identify) | LATER for us |
| Install contexts (`GUILD_INSTALL` / `USER_INSTALL`) | **MISSING** in normalization | model gap |
| HTTP interaction endpoint delivery | **MISSING** | V2 for us |
| Raw event escape hatch | **IMPLEMENTED** (`discord/<gateway-event>` + `session.discord`) | useful but not sufficient |

Modern Discord gap strategy if Satori were used anyway:

| Gap | Strategy | Practical? |
|---|---|---|
| Components V2 | RAW_ADAPTER_ACCESS (`bot.internal` / raw REST) + EXTENSION layer | awkward — bypasses Satori render path |
| nonce/enforce_nonce | WRAPPER on `internal.createMessage` | yes, but defeats “thin Satori layer” |
| Cordis 4 coexistence | UPSTREAM_PATCH / harness vendor port | **no upstream release observed** |
| Rate-limit + outbox | dsh-piblox-discord owns regardless | yes |

### Session naming boundary (OBSERVED)

| Term | Owner | Meaning |
|---|---|---|
| `Session` (`@satorijs/core`) | Satori | Ephemeral inbound platform event wrapper (`session.sn`, `session.event`) |
| `session_id` / DSH session | DSH `ctx.agents` | Persistent agent conversation store |
| Recommended docs names | — | **PlatformEvent** / **SatoriSession** vs **DSHSession** / **session_id**; **DiscordConversationIdentity** for binding keys |

### Reliability ownership split

| Concern | Satori / adapter-discord | dsh-piblox-discord (still owns) |
|---|---|---|
| Gateway reconnect/resume | yes (WsClient) | account lifecycle orchestration |
| WS retry/backoff (connect) | yes (Adapter.WsClientConfig) | — |
| REST 429 / buckets | **no durable engine** | outbox, Retry-After, queue |
| Create Message idempotency | **no** | nonce + enforce_nonce |
| Inbound dedupe | **no** | yes |
| Crash recovery | **no** | durable outbox |
| Delivery state / receipts | **no** | yes |

## Decision

**Reject Satori as the V1 Discord transport** for `dsh-piblox-discord`.

**Operator-approved final state (2026-09-09):**

```text
TRANSPORT_DECISION = LOCKED_DIRECT_DISCORDJS
TRANSPORT_DECISION_READY = YES
READY_FOR_IMPLEMENTATION = YES
```

Retain ADR-0007 direction: **direct `discord.js` 14.x** inside the plugin
transport layer, sharing the existing DSH `@deepseek-ai/cordis@4.0.2` Context
with first-party services. Exact `discord.js` patch pin is an **implementation
detail** (set when package/lockfile is created) — not an architecture blocker.

Satori evaluation evidence in this ADR is **retained** as a rejected alternative
(reference for IM abstractions / Gateway passthrough patterns), not a V1 dependency.

Closed with this transport lock (operator):

| Item | Lock |
|---|---|
| Allowlist empty lists | `allowed_guilds/channels/users: []` = **deny all**; broad access needs explicit opt-in |
| Core `EVENT_TYPES` | V1: plugin owns `discord.*`; bridge to closed observability types; **do not** extend Core schema |
| `approvalChannel` / `ctx.approval` | **NON-BLOCKING / V2** — V1 transports generic interactions; no parallel approval store |

## Consequences

- `TRANSPORT_DECISION = LOCKED_DIRECT_DISCORDJS`
- `TRANSPORT_DECISION_READY = YES`
- `READY_FOR_IMPLEMENTATION = YES` (session seam + transport + closed stale contracts)
- Implementation mission may proceed with `discord.js` 14.x (exact pin at package creation)
- No Satori dependencies in V1; no harness Cordis 3.x fork required
- Components V2, nonce idempotency, outbox, and DSH bridge remain first-party work
- Satori ADR body remains evidence; do not delete

## Rejected alternatives

| Alternative | Why rejected |
|---|---|
| B — Satori native in same Context | Cordis 3.x vs `@deepseek-ai/cordis` 4.x **FAIL**; missing `@cordisjs/plugin-http`; Components V2 **MISSING** |
| C — Satori + Discord extension layer | Same Cordis blocker; extension layer would reimplement most of ADR-0007 surface via raw REST — net complexity ≈ direct discord.js |
| D — Separate Satori subprocess | Out of scope; breaks in-process `conversationBinding` / `ctx.agents` seam |

## References

- npm: `@satorijs/core@4.6.0`, `@satorijs/adapter-discord@4.6.2`
- Source tarballs inspected under `/tmp/satori-core`, `/tmp/satori-discord`
- DSH harness `vendor/cordis@4.0.2`, profile lockfile `~/dsh-lab/runtime/dsh-home/profiles/web/pnpm-lock.yaml`
