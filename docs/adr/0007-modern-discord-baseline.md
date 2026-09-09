# ADR-0007: Modern Discord API / Components V2 baseline

- Status: **LOCKED**
- Date: 2026-09-09
- Deciders: Florian (architecture lock + contract-closure reinforcement)

## Context

`dsh-piblox-discord` is a **new** Discord provider created in **2026**.

It must be designed against the **current Discord Developer Platform**, not against
legacy bot patterns (content + embeds + ActionRow as the primary render model,
guild-slash-only commands, signed 32-bit flag assumptions, inventing HTTP
`Idempotency-Key` headers). Designing legacy-first would force architecture
redesigns as Discord evolves.

## Decision

**`Modern Discord API / Components V2 baseline = LOCKED`.**

1. Discord HTTP API **`v10`**, isolated in the **transport layer** (must not leak into DSH contracts, ConversationBinding keys, Core event types, or tool names).
2. Client direction: current **`discord.js` 14.x** (exact pin is an implementation detail within 14.x).
3. No legacy/deprecated Discord API endpoint as an architectural dependency.
4. Gateway intents / reconnect / resume semantics.
5. REST rate-limit headers / buckets / `Retry-After`.
6. **Components V2** are a first-class transport/render primitive. Do **not** design around legacy `content + embeds + ActionRow` and bolt V2 later. Legacy messages remain supported for compatibility.
7. Transport/render model must be able to **represent** current component families (Action Row, Button, selects, Section, Text Display, Thumbnail, Media Gallery, File, Separator, Container, Label, Text Input, File Upload, Radio Group, Checkbox Group, Checkbox) without redesign — even when V1 only ships typed helpers for a subset.
8. Target modal contract supports modern modal components (Label, Text Input, selects, File Upload, Radio/Checkbox groups) — not text-input-only. Implementation may remain V2.
9. Application commands target model: `CHAT_INPUT`, `USER`, `MESSAGE`, autocomplete, interaction contexts, installation contexts. Do **not** assume `command = guild slash command`.
10. Installation model: understand `GUILD_INSTALL` and `USER_INSTALL`. V1 production config may use GUILD_INSTALL only — **do not hard-code that restriction into plugin contracts**.
11. Normalized interactions are **delivery-agnostic** (Gateway and HTTP interaction endpoint). V1 may implement Gateway only; HTTP delivery is a later adapter. Consumers must not care which mode produced the interaction.
12. Feature contract includes incoming webhooks and Discord Webhook Events as transport capabilities (not mandatory V1).
13. Modern message model accounts for replies, references, forwarding/snapshots, attachments, Components V2, polls, voice-message metadata, `nonce`, `enforce_nonce`, allowed mentions — without claiming V1 implements all of them.
14. Create Message idempotency via Discord **`nonce` + `enforce_nonce=true`** where applicable. Do **not** invent a generic Discord HTTP `Idempotency-Key`. Other operations use durable operation IDs + returned Discord resource IDs + reconciliation.
15. Preserve Discord bitfields **losslessly**; do not assume signed 32-bit is enough; account for extended/string-serialized flag representations where Discord uses them.
16. Forward compatibility: typed known surface + bounded redacted raw envelopes + policy-gated low-level REST escape hatch. Unknown Gateway events must not be silently discarded when surfacing is enabled. Escape hatch still respects credentials, rate limits, audit, policy, permissions, and redaction — and **must not** bypass DSH policy.

### Feature tiers (LOCKED approximation)

| Tier | Includes |
|---|---|
| **V1 MUST** | Modern Gateway/REST foundation; Components V2 foundation; legacy message compatibility; basic current message model; buttons; basic selects; defer/follow-up; attachments/File; event normalization; forward-compatible transport envelope |
| **V2** | Complete Components V2 convenience API; modern modal framework; File Upload; Radio Group; Checkbox Group / Checkbox; polls; user/message commands; user-install ops support; HTTP interactions; incoming/event webhooks; richer media surfaces |
| **LATER** | Voice transport/audio; stage; Activities/Social SDK if justified; scale-driven sharding enhancements |

This ADR does **not** authorize implementing deferred features in a contract-only pass.

## Consequences

- V1 MUST include a Components V2 foundation (typed subset) even if full convenience APIs wait for V2.
- Feature docs (`FEATURE-CONTRACT`, `ARCHITECTURE`, `EVENT-CONTRACT`, `DESIGN-STATUS`) must stay aligned with this lock.
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
| Exclude webhooks from the Feature Contract | Architecturally erases a Discord transport capability |

## Evidence

- Operator additional lock (2026-09-09) — Modern Discord Platform Baseline
- Contract-closure reinforcement (2026-09-09) — same lock reaffirmed
- [FEATURE-CONTRACT.md](../FEATURE-CONTRACT.md) / [ARCHITECTURE.md](../ARCHITECTURE.md) / [EVENT-CONTRACT.md](../EVENT-CONTRACT.md) / [DESIGN-STATUS.md](../../DESIGN-STATUS.md)
- Discord Developer Platform direction (REFERENCE: official Discord docs; API v10)
