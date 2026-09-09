# Feature contract — dsh-piblox-discord

**STATUS:** DESIGN / NOT IMPLEMENTED  
Target surface = what the plugin is meant to become.  
V1 = first shippable increment that proves the architecture.

**LOCKED:** Modern Discord API / Components V2 baseline (ADR-0007).  
Designed against the **current Discord Developer Platform (2026)**, not legacy bot patterns.

## Classification legend

| Class | Meaning |
|---|---|
| **V1 MUST** | Required for first useful Discord ↔ DSH loop |
| **V1 SHOULD** | Strongly preferred in V1 if cost stays bounded |
| **V2** | Planned after V1 proves Core contracts |
| **LATER** | Explicitly deferred; document only |

---

## Platform baseline (LOCKED)

| Item | Lock |
|---|---|
| Discord HTTP API | explicit **`v10`** (transport-layer only; must not leak into DSH contracts) |
| Client direction | current **`discord.js` 14.x** |
| Deprecated Discord endpoints | not architectural dependencies |
| Gateway | intents / reconnect / resume semantics |
| REST | rate-limit headers / buckets / `Retry-After` |
| Components V2 | first-class transport/render primitive (not a later bolt-on) |
| Bitfields | lossless; do not assume signed 32-bit is enough |
| Forward compatibility | typed known surface + raw envelope + policy-gated REST escape hatch |

---

## Connectivity

| Feature | Class | Notes |
|---|---|---|
| Multiple Discord accounts / bots | V1 MUST | LOCKED multi-account |
| Modern Gateway foundation | V1 MUST | intents, reconnect, resume |
| Modern REST foundation (`v10`) | V1 MUST | API version isolated in transport |
| Rate-limit buckets + Retry-After | V1 MUST | |
| Intents configuration | V1 MUST | least-privilege per account |
| Credential references (no inline tokens) | V1 MUST | via `secrets.resolve` OBSERVED |
| FakeTransport / test doubles | V1 MUST | inject 429 / Components V2 payloads |
| Forward-compatible transport envelope | V1 MUST | typed + bounded raw metadata |
| Policy-gated low-level REST escape hatch | V1 MUST | new Discord endpoints without arch rewrite |
| Application command registration automation | V1 SHOULD | target model includes all command types |
| HTTP interaction endpoint delivery | V2 | V1 may be Gateway-only; contract is delivery-agnostic |
| Incoming webhooks | V2 | transport capability; not excluded |
| Discord Webhook Events | V2 | |
| Sharding enhancements | LATER | scale-driven |

## Installation & command contexts (LOCKED model)

| Feature | Class | Notes |
|---|---|---|
| Understand `GUILD_INSTALL` | V1 MUST | typical V1 production config |
| Understand `USER_INSTALL` | V1 MUST (model) / V2 (ops support) | **do not hard-code GUILD_INSTALL-only into contracts** |
| Interaction contexts (guild, bot DM, private channel where supported) | V1 MUST (model) | |
| CHAT_INPUT / slash commands | V1 SHOULD | do not assume `command = guild slash` |
| USER commands | V2 | represent in target contract now |
| MESSAGE commands | V2 | |
| Autocomplete | V2 | |
| Installation context metadata on interactions | V1 MUST | normalized field even if V1 config is guild-only |

## Guild / channel model

| Feature | Class | Notes |
|---|---|---|
| Guild context on events | V1 MUST | |
| Text / voice channel metadata | V1 MUST | text + thread focus |
| DM support | V1 MUST | |
| Threads (create / list / context) | V1 MUST | |
| Categories | V1 SHOULD | admin tools primarily |
| Forums | V2 | if Discord API support validated |
| Stage channels | LATER | |
| Voice join / audio pipeline | LATER | |

## Modern message model

Target contract accounts for current Discord capabilities. V1 implements a subset.

| Feature | Class | Notes |
|---|---|---|
| Send / reply / edit | V1 MUST | |
| Message references | V1 MUST | |
| Allowed mentions control | V1 MUST | default suppress unsafe parsing |
| Attachments + File component | V1 MUST | |
| Components V2 foundation | V1 MUST | see below — **not** legacy-first |
| Legacy `content` + embeds + ActionRow compatibility | V1 MUST | supported, not the primary design center |
| Chunking / truncation strategy | V1 MUST | platform limits for content + component trees |
| Deterministic `nonce` + `enforce_nonce=true` on Create Message | V1 MUST | Discord-native idempotency; **no** invented HTTP `Idempotency-Key` |
| Delete | V1 SHOULD | policy-gated |
| History / read | V1 SHOULD | |
| Embeds (legacy) | V1 SHOULD | compatibility |
| Forwarding / message snapshots | V2 | represent in target model |
| Polls | V2 | |
| Voice-message metadata | V2 | metadata only; not voice transport |
| Message search | LATER | only if Discord API allows for bot |

## Components V2 (LOCKED — first-class)

Do **not** design the renderer around legacy `content + embeds + ActionRow` and bolt V2 later.
Transport/render contract must natively represent current component families:

| Component family | Contract representation | Convenience API |
|---|---|---|
| Action Row | V1 MUST | V1 |
| Button | V1 MUST | V1 typed primitive |
| String Select | V1 MUST | V1 basic |
| User Select | V1 MUST (model) | V1 basic / V2 richer |
| Role Select | V1 MUST (model) | V1 basic / V2 richer |
| Mentionable Select | V1 MUST (model) | V2 convenience |
| Channel Select | V1 MUST (model) | V1 basic / V2 richer |
| Section | V1 MUST | V1 typed primitive |
| Text Display | V1 MUST | V1 typed primitive |
| Thumbnail | V1 MUST (model) | V2 convenience |
| Media Gallery | V1 MUST (model) | V2 convenience |
| File | V1 MUST | V1 typed primitive |
| Separator | V1 MUST (model) | V2 convenience |
| Container | V1 MUST | V1 typed primitive |
| Label | V1 MUST (model) | V2 (esp. modals) |
| Text Input | V1 MUST (model) | V2 modals |
| File Upload | V1 MUST (model) | V2 |
| Radio Group | V1 MUST (model) | V2 |
| Checkbox Group | V1 MUST (model) | V2 |
| Checkbox | V1 MUST (model) | V2 |

**V1 typed primitives (suggested):** Text Display, Container, Section, Button, basic selects, File/attachments.  
Full advanced convenience APIs → V2.  
Unknown/future component types → bounded raw component nodes (forward-compatible).

## Interaction framework

| Feature | Class | Notes |
|---|---|---|
| Normalized interaction contract (delivery-agnostic) | V1 MUST | Gateway now; HTTP endpoint later |
| Buttons | V1 MUST | intent transport only |
| Basic selects | V1 MUST | |
| Deferred replies / follow-ups | V1 MUST | Discord ack window |
| Ephemeral responses | V1 SHOULD | |
| Modern modal framework (Label, Text Input, selects, File Upload, Radio/Checkbox groups) | V2 | target contract must support; not text-input-only |
| Autocomplete | V2 | |

## Interaction delivery modes

| Mode | Class | Notes |
|---|---|---|
| Gateway interactions | V1 MUST | |
| HTTP interaction endpoint | V2 | adapter; consumers ignore delivery mode |

## Reactions

| Feature | Class | Notes |
|---|---|---|
| Add / remove reaction | V2 | |
| Inbound reaction events | V2 | |

## Members / security metadata

| Feature | Class | Notes |
|---|---|---|
| User / member / role / permission context | V1 MUST | lossless permission bitfields |
| Member list tooling | V1 SHOULD | |
| Role list tooling | V1 SHOULD | |

## Admin capabilities (`discord.admin.*`)

All **policy-gated**. Never claim Discord-impossible operations.

| Feature | Class | Notes |
|---|---|---|
| Channel create / edit / delete | V2 | |
| Category ops | V2 | |
| Role create / edit / assign | V2 | |
| Permissions inspect | V1 SHOULD | lossless bitfields |
| Permissions edit | V2 | |
| Member timeout / kick / ban | V2 | high audit |

## Webhooks (target — not excluded)

| Feature | Class | Notes |
|---|---|---|
| Incoming webhooks | V2 | Discord transport capability |
| Discord Webhook Events | V2 | |

## DSH integration

| Feature | Class | Notes |
|---|---|---|
| ConversationBinding adapter | V1 MUST | OBSERVED — no parallel store |
| Inbound session resolution | V1 MUST | |
| Outbound targeting (channel/thread/DM) | V1 MUST | |
| Proactive notifications | V1 MUST | target aliases in config |
| Event normalization + unknown-event envelope | V1 MUST | do not silently drop new Gateway events |
| Tool surface basic | V1 MUST | |
| Multi-agent binding primitives | V1 SHOULD | routing hints only |
| Observability integration | V1 MUST | plugin `discord.*` + bridge to closed Core EVENT_TYPES (LOCKED — no Core schema extension in V1) |
| Approval intent relay to `ctx.approval` | V2 | NON-BLOCKING; no parallel approval store; deferred until stable DSH approval-channel seam |

## Reliability

| Feature | Class | Notes |
|---|---|---|
| Rate-limit buckets + Retry-After | V1 MUST | |
| Retry / backoff | V1 MUST | |
| Outbound queue / outbox | V1 MUST | |
| Inbound dedupe | V1 MUST | |
| Create Message: `nonce` + `enforce_nonce` | V1 MUST | Discord-native; no generic HTTP Idempotency-Key |
| Other ops: durable operation IDs + Discord resource IDs + reconciliation | V1 MUST | |
| Delivery state machine | V1 MUST | |
| Correlation ids | V1 MUST | via observability |
| Crash / restart recovery of outbox | V1 MUST | |
| Partial failure recovery (multi-step / component trees) | V1 MUST | |
| Delivery receipts to callers | V1 SHOULD | |

## LATER

| Feature | Class | Notes |
|---|---|---|
| Voice transport / audio | LATER | |
| STT / TTS | LATER | domain/media plugins |
| Stage | LATER | |
| Activities / Social SDK | LATER | only if justified |
| Scale-driven sharding enhancements | LATER | |

---

## V1 summary (justified)

V1 proves modern Discord ↔ DSH without becoming full Discord coverage:

```text
Discord → ConversationBinding → DSH session → Discord
```

**V1 MUST includes:** multi-account; Gateway+REST `v10` foundation; secrets refs;
guild/channel/thread/DM; Components V2 foundation + legacy compatibility;
basic modern message model (send/reply/edit, references, mentions, attachments/File);
buttons + basic selects; defer/follow-up; event normalization + forward-compatible
envelope; `nonce`/`enforce_nonce`; rate-limit/429; outbox/retry/dedupe; observability
adapter; FakeTransport; installation/context fields in the model (even if ops start
GUILD_INSTALL-only).

**V1 excludes (implementation):** full Components V2 convenience API; modern modals;
polls; user/message commands ops; USER_INSTALL ops; HTTP interactions; webhooks;
voice; full admin surface; product-specific agents.

This remains enough to demonstrate architecture without redesign when Discord adds
components, events, or REST features.
