# ADR-0007: Modern Discord API / Components V2 baseline

- Status: Accepted
- Date: 2026-09-09
- Deciders: Florian (additional architecture lock)

## Context

`dsh-piblox-discord` is a new Discord provider created in 2026. Legacy bot patterns
(content + embeds + ActionRow as the primary render model, guild-slash-only
commands, signed 32-bit flag assumptions, inventing HTTP Idempotency-Key headers)
would force redesigns as Discord’s Developer Platform evolves.

## Decision

Lock the **current Discord Developer Platform** as the architectural baseline:

1. Discord HTTP API **`v10`**, isolated in the transport layer (must not leak into DSH contracts).
2. Client direction: current **`discord.js` 14.x** (exact pin at implementation time).
3. No legacy/deprecated Discord API endpoints as architectural dependencies.
4. Gateway intents / reconnect / resume and REST rate-limit headers / buckets / `Retry-After`.
5. **Components V2** are a first-class transport/render primitive; legacy messages remain compatibility only.
6. Application commands model CHAT_INPUT, USER, MESSAGE, autocomplete, interaction + installation contexts (`GUILD_INSTALL` / `USER_INSTALL`) — V1 ops may use guild-only without hard-coding that into contracts.
7. Normalized interactions are **delivery-agnostic** (Gateway now; HTTP endpoint later).
8. Create Message idempotency via Discord **`nonce` + `enforce_nonce`** — do not invent a generic HTTP `Idempotency-Key`.
9. Preserve Discord bitfields losslessly.
10. Forward compatibility: typed known surface + bounded redacted raw envelopes + policy-gated REST escape hatch; unknown Gateway events must not be silently discarded when surfacing is enabled.

## Consequences

- V1 MUST include Components V2 foundation (typed subset) even if full convenience APIs wait for V2.
- Feature tiers updated: modals/webhooks/HTTP interactions/USER_INSTALL ops → V2; voice/stage/Activities → LATER.
- Escape hatch cannot bypass DSH policy, rate limits, audit, or redaction.
- Exact `discord.js` patch version remains an implementation choice within 14.x.

## Rejected alternatives

| Alternative | Why rejected |
|---|---|
| Design for legacy ActionRow-first, add V2 later | Guarantees render/transport redesign |
| Hard-code GUILD_INSTALL-only into contracts | Blocks USER_INSTALL / modern install model |
| Assume command = guild slash command | Ignores USER/MESSAGE commands and contexts |
| Invent HTTP `Idempotency-Key` for Discord | Not a Discord Create Message mechanism |
| Fit all flags in signed 32-bit integers | Loses modern/extended bitfields |
| Closed local enum drops unknown Gateway events | Breaks forward compatibility |
| Unscoped raw REST pass-through | Bypasses policy / audit / rate limits |

## Evidence

- Operator additional lock (2026-09-09) — Modern Discord Platform Baseline
- FEATURE-CONTRACT.md / ARCHITECTURE.md / EVENT-CONTRACT.md updates
- Discord Developer Platform direction (REFERENCE: official Discord docs; API v10)
