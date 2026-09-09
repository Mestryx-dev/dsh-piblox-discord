# Feature contract — dsh-piblox-discord

**STATUS:** DESIGN / NOT IMPLEMENTED  
Target surface = what the plugin is meant to become.  
V1 = first shippable increment that proves the architecture.

## Classification legend

| Class | Meaning |
|---|---|
| **V1 MUST** | Required for first useful Discord ↔ DSH loop |
| **V1 SHOULD** | Strongly preferred in V1 if cost stays bounded |
| **V2** | Planned after V1 proves Core contracts |
| **LATER** | Explicitly deferred; document only |

---

## Connectivity

| Feature | Class | Notes |
|---|---|---|
| Multiple Discord accounts / bots | V1 MUST | LOCKED multi-account |
| Gateway connect per account | V1 MUST | |
| REST client per account | V1 MUST | |
| Intents configuration | V1 MUST | least-privilege per account |
| Reconnect / resume | V1 MUST | |
| Credential references (no inline tokens) | V1 MUST | via `secrets.resolve` OBSERVED |
| FakeTransport / test doubles | V1 MUST | design + testability without live Discord |
| Application command registration automation | V2 | optional manual register in V1 SHOULD |
| Sharding | LATER | only if account scale requires |

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
| Voice join / audio pipeline | LATER | see Future |

## Messaging

| Feature | Class | Notes |
|---|---|---|
| Send | V1 MUST | |
| Reply | V1 MUST | |
| Edit | V1 MUST | |
| Delete | V1 SHOULD | policy-gated |
| History / read | V1 SHOULD | |
| Mentions (parse control) | V1 MUST | default suppress unsafe mention parsing |
| Chunking / truncation strategy | V1 MUST | Discord 2000 char limit |
| Attachments basic (inbound + outbound) | V1 MUST | size ceilings TBD |
| Embeds | V1 SHOULD | |
| Components V2 / rich layout | V2 | |
| Message search | LATER | only if Discord API allows for bot |

## Interaction framework

| Feature | Class | Notes |
|---|---|---|
| Buttons | V1 MUST | intent transport only |
| Deferred replies / follow-ups | V1 MUST | Discord 3s ack window |
| Ephemeral responses | V1 SHOULD | |
| Slash commands | V1 SHOULD | basic set |
| Select menus | V2 | |
| Modals | V2 | |
| Autocomplete | V2 | |
| User / message context commands | V2 | |

## Reactions

| Feature | Class | Notes |
|---|---|---|
| Add / remove reaction | V2 | |
| Inbound reaction events | V2 | |

## Members / security metadata

| Feature | Class | Notes |
|---|---|---|
| User / member / role / permission context on events | V1 MUST | for allowlists + consumer policy |
| Member list tooling | V1 SHOULD | |
| Role list tooling | V1 SHOULD | |

## Admin capabilities (`discord.admin.*`)

All **policy-gated**. Never claim Discord-impossible operations.

| Feature | Class | Notes |
|---|---|---|
| Channel create / edit / delete | V2 | |
| Category ops | V2 | |
| Role create / edit / assign | V2 | |
| Permissions inspect | V1 SHOULD | |
| Permissions edit | V2 | |
| Member timeout / kick / ban | V2 | high audit |
| Webhooks | LATER | |

## DSH integration

| Feature | Class | Notes |
|---|---|---|
| ConversationBinding adapter | V1 MUST | OBSERVED service — no parallel store |
| Inbound session resolution | V1 MUST | |
| Outbound targeting (channel/thread/DM) | V1 MUST | |
| Proactive notifications | V1 MUST | target aliases in config |
| Event normalization | V1 MUST | |
| Tool surface basic | V1 MUST | |
| Multi-agent binding primitives | V1 SHOULD | routing hints only — not become dsh-router |
| Observability integration | V1 MUST | map into closed Core event types (OPEN mapping) |
| Approval intent relay to `ctx.approval` | V1 SHOULD | OPEN park API gap |

## Reliability

| Feature | Class | Notes |
|---|---|---|
| Rate-limit buckets + Retry-After | V1 MUST | prevent Atlas-class partial failure |
| Retry / backoff | V1 MUST | |
| Outbound queue / outbox | V1 MUST | |
| Inbound dedupe | V1 MUST | |
| Outbound idempotency keys | V1 MUST | |
| Delivery state machine | V1 MUST | |
| Correlation ids | V1 MUST | via observability |
| Crash / restart recovery of outbox | V1 MUST | durable outbox PROPOSED |
| Partial failure recovery (multi-message builds) | V1 MUST | transactional outbox groups |
| Delivery receipts to callers | V1 SHOULD | |

## Future (evaluate, do not force into V1)

| Feature | Class | Notes |
|---|---|---|
| Voice | LATER | |
| STT / TTS | LATER | domain/media plugins |
| Stage | LATER | |
| Advanced media / streaming | LATER | |
| Marketplace / Activities | LATER | |

---

## V1 summary (justified)

V1 proves:

```text
Discord → ConversationBinding → DSH session → Discord
```

and leaves room for later:

```text
Domain plugin → discord.* tools → Discord
Discord button → ApprovalIntent → domain → policy → executor
```

**Included:** multi-account, Gateway+REST, credentials refs, guild/channel/thread/DM
context, inbound messages, outbound send/reply/edit, basic attachments, binding,
session routing adapter, proactive outbound, basic buttons, event normalization,
basic tools, rate-limit/429, retry/backoff, dedupe/idempotency, delivery state,
observability adapter, FakeTransport design.

**Excluded from V1:** voice, full admin surface, select/modals, reaction-driven
flows, Components V2, product-specific agents.

This is enough to demonstrate architecture without becoming “all of Discord”.
