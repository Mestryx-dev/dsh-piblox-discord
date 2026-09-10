# Discord capability matrix — dsh-piblox-discord

**STATUS:** Authoritative coverage audit (2026-09-10)  
**Repo truth:** `fec4aab` on `master` · **174/174** tests PASS · **PRODUCTION_READY = NO**  
**Primary sources:** [Discord Developer Docs](https://discord.com/developers/docs/intro) (API v10, Gateway intents, permissions) · [discord.js 14.27.0](https://discord.js.org/) (pinned in `package.json`) · this repository (`src/`, `test/`)

This matrix compares **Discord platform capabilities** against **observed plugin implementation**. Design docs (`FEATURE-CONTRACT.md`, ADRs) inform **Tier** and **Architecture** columns only — **Implemented / Unit / Live** come from code and tests.

---

## Status legend

| Status | Meaning |
|---|---|
| **PASS** | Implemented, unit-tested, and live-proven in LAB (where a live path exists) |
| **IMPLEMENTED_UNTESTED** | Runtime code path exists; missing dedicated unit test and/or live proof |
| **REPRESENTED_ONLY** | Typed model / contract / partial encoder; no end-to-end runtime |
| **NOT_IMPLEMENTED** | No meaningful runtime path in `src/` |
| **NOT_APPLICABLE** | Out of plugin scope or not a bot REST/Gateway concern |
| **DEFERRED** | Explicitly deferred with documented blocker |

## DSH surface legend

| Surface | Meaning |
|---|---|
| **service** | `ctx.discord` semantic API (`notify`, `messageSend`, …) |
| **tool** | Model-facing `discord_*` via `ctx.tools` → policy → service |
| **inbound** | Normalized Gateway event → bridge |
| **components** | `ComponentNode` encode/decode |
| **transport** | Internal `DiscordJsTransport` / outbox only |
| **admin** | Future `discord.admin.*` (not registered V1) |
| **none** | Not exposed |

## Risk legend (policy / security)

| Risk | Meaning |
|---|---|
| **L0** | Read / metadata |
| **L1** | Bounded read or low-impact |
| **L2** | Mutating external side effect |
| **L3+** | Secrets, moderation, destructive admin |
| **n/a** | Transport-internal or not exposed |

---

## Summary

### V1 COMPLETE (implemented + tested; live where exercised)

- Multi-account config plane + fail-closed allowlists + proactive target aliases
- Gateway connect (`discordjs`) + `MESSAGE_CREATE` inbound + inbound dedupe
- Outbound send / reply / edit via durable outbox + Create Message nonce ≤25
- Thread-from-message (`createThread` + `thread_per_conversation` topology)
- Components V2 foundation: encode (typed subset) + Button + String Select interactions
- Interaction ACK path: defer / followUp / edit / update via outbox
- Semantic service + `discord_*` tools (reads + mutations) sharing outbox
- Proactive `notify` (no ConversationBinding) + policy-gated tool send

### V1 GAPS (contract V1 SHOULD/MUST still open)

- Message **delete** (outbox op + tool/service)
- Inbound `MESSAGE_UPDATE` / `MESSAGE_DELETE` normalization
- Attachment **upload** pipeline (File component encode exists; no upload helper)
- Read tools live-smoke on Gateway (`guildList`, `channelGet`, `messageHistory`)
- DM outbound live proof (config exists; LAB account has `dm.enabled=false`)
- `discord.rest.raw` escape hatch (policy blockers unsolved)
- Crash/restart recovery live evidence · rate-limit matrix · permission error matrix

### V2 CANDIDATES

- Full Components V2 convenience (modals, File Upload, Radio/Checkbox groups)
- User/Role/Channel/Mentionable select **outbound** smoke beyond normalize unit tests
- Slash / user / message commands + autocomplete registration
- HTTP interaction endpoint delivery
- Incoming webhooks + Discord Webhook Events
- Channel/category admin · role/member admin · reactions
- Polls · forwarding/snapshots · richer media convenience
- `USER_INSTALL` ops (model already delivery-agnostic)

### LATER

- Voice / stage / Activities (Social SDK)
- Scale-driven custom sharding
- Message search (if/when bot API allows)

### SECURITY-SENSITIVE (defer or strict policy)

- `discord.rest.raw` — **DEFERRED** (no method/path classifier)
- Moderation (kick/ban/timeout) — not implemented; would be L3+
- Permission **edit** — not implemented
- Privileged intents (`GuildMembers`, `GuildPresences`, `MessageContent`) — operator opt-in only; LAB uses `MessageContent`

### LIVE TESTS STILL WORTH DOING (no LAB scope change)

- Read path smoke: `discord_channel_get` + `discord_message_history` on allowlisted channel
- DM send with dedicated test user (requires explicit `dm.enabled` + user allowlist)
- Message delete on bot-owned message in LAB thread
- Gateway disconnect/reconnect observation (no privileged intents)
- Outbox recovery after `systemctl`/process kill mid-`sending`

---

## CONNECTIVITY

| Capability | Discord surface | Intent | Permission | discord.js | Architecture | Implemented | Unit | Live | DSH surface | Tier | Risk | Gap |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Gateway WebSocket | Gateway | Guilds (+ message intents for traffic) | Bot token | Yes | Yes | **PASS** | Yes | Yes | transport | V1 | n/a | Resume/session handled by djs; no custom resume metrics |
| Reconnect (automatic) | Gateway | — | — | Yes (Client) | Yes | **IMPLEMENTED_UNTESTED** | Partial | Partial | transport | V1 | n/a | `shardDisconnect` → status only; no dedicated reconnect test |
| Resume / session restore | Gateway | — | — | Yes (internal) | Yes | **IMPLEMENTED_UNTESTED** | No | No | transport | V1 | n/a | Rely on discord.js; no explicit `RESUME` observability |
| Intent configuration | Gateway | Per-intent (see Discord docs) | Portal + privileged review | Yes | Yes | **PASS** | Yes | Yes | config | V1 | n/a | `src/intents.js` + Settings UI |
| Guild install (GUILD_INSTALL) | Gateway + REST | Guilds | Invite bot to guild | Yes | Yes | **PASS** | Yes | Yes | inbound | V1 | n/a | Typical LAB config |
| User install (USER_INSTALL) | Gateway + REST | DM-related | User adds app | Yes | Yes | **REPRESENTED_ONLY** | Partial | No | inbound | V2 | L1 | `deliveryMode` / install fields in interaction normalize; no USER_INSTALL ops |
| Application command contexts (model) | Interactions | — | — | Yes | Yes | **REPRESENTED_ONLY** | Partial | No | inbound | V1 model | L1 | Types in contracts; no command registration |
| Sharding (library default) | Gateway | — | — | Yes | Yes | **IMPLEMENTED_UNTESTED** | No | No | transport | V1 | n/a | Single-process Client; no custom shard manager |
| Scale sharding enhancements | Gateway | — | — | Yes | Yes | **NOT_IMPLEMENTED** | No | No | none | LATER | n/a | FEATURE-CONTRACT LATER |
| Rate-limit observation | REST | — | — | Yes | Yes | **IMPLEMENTED_UNTESTED** | Partial | Partial | transport | V1 | n/a | `rest.on('rateLimited')` buffer; outbox 429 handling unit-tested |
| FakeTransport test double | — | — | — | n/a | Yes | **PASS** | Yes | n/a | transport | V1 | n/a | 429 / failure injection |

**LAB intents (vega):** `Guilds`, `GuildMessages`, `MessageContent`, `DirectMessages` (see ledger).  
**Not enabled in LAB:** privileged `GuildMembers`, `GuildPresences`; reaction/typing/member intents.

---

## MESSAGES

| Capability | Discord surface | Intent | Permission | discord.js | Architecture | Implemented | Unit | Live | DSH surface | Tier | Risk | Gap |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Send message | REST | GuildMessages / DirectMessages | SEND_MESSAGES | Yes | Yes | **PASS** | Yes | Yes | service + tool | V1 | L2 | Outbox `sendMessage`; live proactive + tool |
| Reply to message | REST | Same | SEND_MESSAGES + READ_MESSAGE_HISTORY (reply ref) | Yes | Yes | **PASS** | Yes | Yes | service + tool | V1 | L2 | Agent followup + semantic `messageReply` |
| Edit message | REST | Same | SEND_MESSAGES (own msg) | Yes | Yes | **PASS** | Yes | Partial | service + tool | V1 | L2 | Unit + agent path; no dedicated live edit smoke |
| Delete message | REST | Same | MANAGE_MESSAGES (others) / own | Yes | Yes | **NOT_IMPLEMENTED** | No | No | tool (planned) | V1 SHOULD | L2 | No outbox op / transport method |
| Message history (read) | REST | MESSAGE_CONTENT for body | READ_MESSAGE_HISTORY | Yes | Yes | **IMPLEMENTED_UNTESTED** | Yes | No | service + tool | V1 SHOULD | L0 | `listMessages` in transport + `messageHistory` |
| Message get (single) | REST | MESSAGE_CONTENT | READ_MESSAGE_HISTORY | Yes | Yes | **IMPLEMENTED_UNTESTED** | Partial | No | service + tool | V1 SHOULD | L0 | FakeTransport + discordjs transport method |
| Attachments (upload) | REST multipart | — | SEND_MESSAGES | Yes | Partial | **NOT_IMPLEMENTED** | No | No | service | V1 MUST | L2 | No `files`/attachment builder in `toDiscordMessageBody` |
| Embeds (legacy) | REST | — | SEND_MESSAGES | Yes | Yes | **IMPLEMENTED_UNTESTED** | Partial | No | service | V1 SHOULD | L1 | `payload.embeds` passed through; not primary path |
| Allowed mentions (safe default) | REST | — | — | Yes | Yes | **PASS** | Yes | Yes | service + components | V1 | n/a | `{ parse: [] }` default |
| Components V2 outbound | REST | — | SEND_MESSAGES | Yes | Yes | **PASS** | Yes | Yes | service + components | V1 | L2 | V2 flag + encode; live smoke |
| Legacy content + ActionRow | REST | — | SEND_MESSAGES | Yes | Yes | **PASS** | Yes | Yes | service | V1 | L2 | Non-V2 encode path |
| Create Message nonce + enforce_nonce | REST | — | — | Yes | Yes | **PASS** | Yes | Yes | transport | V1 | n/a | ≤25 chars; live thread send fixed |
| Forwarding / message snapshots | REST | — | — | Yes | Yes | **NOT_IMPLEMENTED** | No | No | none | V2 | L1 | Contract only |
| Polls (create/vote) | REST + Gateway | GUILD_MESSAGE_POLLS | SEND_MESSAGES | Yes | Yes | **NOT_IMPLEMENTED** | No | No | none | V2 | L2 | Intent listed in Settings; no handler |
| Voice-message metadata | REST | — | — | Yes | Yes | **REPRESENTED_ONLY** | No | No | none | V2 | L1 | No metadata handling |

---

## CHANNELS

| Capability | Discord surface | Intent | Permission | discord.js | Architecture | Implemented | Unit | Live | DSH surface | Tier | Risk | Gap |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Channel get (metadata) | REST | Guilds | VIEW_CHANNEL | Yes | Yes | **IMPLEMENTED_UNTESTED** | Yes | No | service + tool | V1 | L0 | Allowlist-gated |
| Channel list (guild) | REST | Guilds | VIEW_CHANNEL | Yes | Yes | **IMPLEMENTED_UNTESTED** | Partial | No | service + tool | V1 | L0 | Bounded limit 100 |
| Guild list | REST | Guilds | — | Yes | Yes | **IMPLEMENTED_UNTESTED** | Yes | No | service + tool | V1 | L0 | `listGuilds` |
| Channel create | REST | Guilds | MANAGE_CHANNELS | Yes | Yes | **NOT_IMPLEMENTED** | No | No | admin | V2 | L3 | Admin tools not registered |
| Channel edit | REST | Guilds | MANAGE_CHANNELS | Yes | Yes | **NOT_IMPLEMENTED** | No | No | admin | V2 | L3 | — |
| Channel delete | REST | Guilds | MANAGE_CHANNELS | Yes | Yes | **NOT_IMPLEMENTED** | No | No | admin | V2 | L3 | — |
| Categories (parent channels) | REST + Gateway | Guilds | VIEW_CHANNEL | Yes | Yes | **REPRESENTED_ONLY** | Partial | Yes | inbound | V1 SHOULD | L0 | Parent ID on threads; category auth fix for outbound |
| Permission overwrites (inspect) | REST | Guilds | VIEW_CHANNEL | Yes | Yes | **NOT_IMPLEMENTED** | No | No | admin | V1 SHOULD | L0 | Lossless bitfields locked in contract |
| DM channels | REST + Gateway | DirectMessages | — | Yes | Yes | **IMPLEMENTED_UNTESTED** | Yes | No | service | V1 | L2 | `resolveDmChannel`; LAB dm disabled |

---

## THREADS

| Capability | Discord surface | Intent | Permission | discord.js | Architecture | Implemented | Unit | Live | DSH surface | Tier | Risk | Gap |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Create thread from message | REST | Guilds (+ messages) | CREATE_PUBLIC_THREADS, SEND_MESSAGES_IN_THREADS | Yes | Yes | **PASS** | Yes | Yes | service + tool | V1 | L2 | `thread:create:…` outbox idempotency |
| Create standalone thread | REST | Guilds | CREATE_PUBLIC_THREADS | Yes | Yes | **NOT_IMPLEMENTED** | No | No | service | V1 | L2 | Transport requires `messageId` |
| Public vs private threads | REST | Guilds | CREATE_PUBLIC / PRIVATE_THREADS | Yes | Partial | **NOT_IMPLEMENTED** | No | No | service | V2 | L2 | Only public path via message starter |
| Thread list / sync | Gateway | Guilds | VIEW_CHANNEL | Yes | Yes | **NOT_IMPLEMENTED** | No | No | inbound | V1 | L0 | No THREAD_* inbound handlers |
| Archive / unarchive | REST | Guilds | MANAGE_THREADS | Yes | Yes | **NOT_IMPLEMENTED** | No | No | admin | V2 | L2 | — |
| Locked threads | REST | Guilds | MANAGE_THREADS | Yes | Yes | **NOT_IMPLEMENTED** | No | No | admin | V2 | L2 | — |
| Auto-archive duration | REST | Guilds | — | Yes | Partial | **NOT_IMPLEMENTED** | No | No | transport | V2 | n/a | — |
| Thread members | Gateway | GuildMembers* | — | Yes | Yes | **NOT_IMPLEMENTED** | No | No | none | V2 | L1 | Privileged intent |
| Forum channels / posts | REST + Gateway | Guilds | VIEW_CHANNEL | Yes | Yes | **NOT_IMPLEMENTED** | No | No | none | V2 | L1 | FEATURE-CONTRACT V2 |
| thread_per_conversation topology | App + REST | Same as threads | Same | Yes | Yes | **PASS** | Yes | Yes | bridge | V1 | L2 | Binding + session per top-level msg |

---

## COMPONENTS V2

Encoder: `src/components/encode.js` · Interaction normalize: `src/components/normalize-interaction.js`.

| Component | Discord | discord.js type | Architecture | Implemented | Unit | Live | DSH surface | Tier | Gap |
|---|---|---|---|---|---|---|---|---|---|
| Action Row | Yes | 1 | Yes | **PASS** | Yes | Yes | components | V1 | Legacy + V2 wrapper |
| Button | Yes | 2 | Yes | **PASS** | Yes | Yes | components + inbound | V1 | Live button smoke |
| String Select | Yes | 3 | Yes | **PASS** | Yes | Yes | components + inbound | V1 | Live select smoke |
| User Select | Yes | 5 | Yes | **REPRESENTED_ONLY** | Partial | No | components + inbound | V1/V2 | Encode + normalize unit; no live |
| Role Select | Yes | 6 | Yes | **REPRESENTED_ONLY** | Partial | No | components + inbound | V1/V2 | Same |
| Mentionable Select | Yes | 7 | Yes | **REPRESENTED_ONLY** | Partial | No | components + inbound | V2 | Same |
| Channel Select | Yes | 8 | Yes | **REPRESENTED_ONLY** | Partial | No | components + inbound | V1/V2 | Same |
| Section | Yes | 9 | Yes | **IMPLEMENTED_UNTESTED** | Partial | No | components | V1 | Encoder only |
| Text Display | Yes | 10 | Yes | **PASS** | Yes | Yes | components | V1 | V2 smoke tree |
| Thumbnail | Yes | 11 | Yes | **IMPLEMENTED_UNTESTED** | Partial | No | components | V2 conv | Encoder only |
| Media Gallery | Yes | 12 | Yes | **IMPLEMENTED_UNTESTED** | Partial | No | components | V2 conv | Encoder only |
| File (component) | Yes | 13 | Yes | **IMPLEMENTED_UNTESTED** | Partial | No | components | V1 | No upload pipeline |
| Separator | Yes | 14 | Yes | **IMPLEMENTED_UNTESTED** | Partial | No | components | V1 model | Encoder only |
| Container | Yes | 17 | Yes | **IMPLEMENTED_UNTESTED** | Partial | No | components | V1 | Encoder only |
| Label | Yes | 18 | Yes | **REPRESENTED_ONLY** | No | No | components | V2 | Raw passthrough only |
| Text Input | Yes | 4 | Yes | **REPRESENTED_ONLY** | No | No | components | V2 | Modal-only; raw passthrough |
| File Upload | Yes | 19 | Yes | **REPRESENTED_ONLY** | No | No | components | V2 | Modal-only |
| Radio Group | Yes | 21 | Yes | **REPRESENTED_ONLY** | No | No | components | V2 | Raw passthrough |
| Checkbox Group | Yes | 22 | Yes | **REPRESENTED_ONLY** | No | No | components | V2 | Raw passthrough |
| Checkbox | Yes | 23 | Yes | **REPRESENTED_ONLY** | No | No | components | V2 | Raw passthrough |
| Unknown / raw node | Yes | any | Yes | **IMPLEMENTED_UNTESTED** | Partial | No | components | V1 | Forward-compat `raw` type |

---

## INTERACTIONS

| Capability | Discord surface | Intent | Permission | discord.js | Architecture | Implemented | Unit | Live | DSH surface | Tier | Risk | Gap |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Button click (inbound) | Gateway | GuildMessages | — | Yes | Yes | **PASS** | Yes | Yes | inbound | V1 | L1 | Dedupe + defer + followUp |
| Select change (string) | Gateway | GuildMessages | — | Yes | Yes | **PASS** | Yes | Yes | inbound | V1 | L1 | Live `values=beta` |
| Select (user/role/channel/mentionable) | Gateway | GuildMessages | — | Yes | Yes | **REPRESENTED_ONLY** | Partial | No | inbound | V1 model | L1 | Normalize unit tests only |
| deferReply / deferUpdate | REST (interaction) | — | — | Yes | Yes | **PASS** | Yes | Yes | transport + outbox | V1 | L1 | Before AgentLoop |
| followUp / editReply / update | REST (interaction) | — | — | Yes | Yes | **PASS** | Yes | Yes | transport + outbox | V1 | L2 | Outbox interaction ops |
| Ephemeral responses | REST (interaction) | — | — | Yes | Yes | **IMPLEMENTED_UNTESTED** | Partial | No | transport | V1 SHOULD | L1 | Flag supported; not live-smoked |
| Modals (submit) | Gateway | GuildMessages | — | Yes | Yes | **NOT_IMPLEMENTED** | No | No | inbound | V2 | L2 | No modal submit handler |
| Autocomplete | Gateway | — | — | Yes | Yes | **NOT_IMPLEMENTED** | No | No | inbound | V2 | L1 | — |
| Slash / CHAT_INPUT commands | Interactions | — | Application command scope | Yes | Yes | **NOT_IMPLEMENTED** | No | No | none | V2 | L2 | No registration automation |
| User commands | Interactions | — | — | Yes | Yes | **NOT_IMPLEMENTED** | No | No | none | V2 | L2 | Model only |
| Message commands | Interactions | — | — | Yes | Yes | **NOT_IMPLEMENTED** | No | No | none | V2 | L2 | Model only |
| Gateway interaction delivery | Gateway | GuildMessages | — | Yes | Yes | **PASS** | Yes | Yes | inbound | V1 | L1 | `interactionCreate` |
| HTTP interaction endpoint | HTTP POST | — | — | Yes | Yes | **NOT_IMPLEMENTED** | No | No | transport | V2 | L2 | `deliveryMode: http_endpoint` normalize only |

---

## MEMBERS / ROLES

| Capability | Discord surface | Intent | Permission | discord.js | Architecture | Implemented | Unit | Live | DSH surface | Tier | Risk | Gap |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Member get | REST | GuildMembers* | — | Yes | Yes | **NOT_IMPLEMENTED** | No | No | admin | V1 SHOULD | L0 | Privileged intent |
| Member list | REST | GuildMembers* | — | Yes | Yes | **NOT_IMPLEMENTED** | No | No | admin | V1 SHOULD | L0 | — |
| Role list | REST | Guilds | — | Yes | Yes | **NOT_IMPLEMENTED** | No | No | admin | V1 SHOULD | L0 | — |
| Role assign / remove | REST | Guilds | MANAGE_ROLES | Yes | Yes | **NOT_IMPLEMENTED** | No | No | admin | V2 | L3 | — |
| Permissions inspect (lossless) | REST | Guilds | VIEW_CHANNEL | Yes | Yes | **NOT_IMPLEMENTED** | No | No | admin | V1 SHOULD | L0 | Contract locked; no tool |
| Permissions edit | REST | Guilds | MANAGE_ROLES / MANAGE_CHANNELS | Yes | Yes | **NOT_IMPLEMENTED** | No | No | admin | V2 | L3 | — |
| Timeout | REST | Guilds | MODERATE_MEMBERS | Yes | Yes | **NOT_IMPLEMENTED** | No | No | admin | V2 | L3 | — |
| Kick | REST | Guilds | KICK_MEMBERS | Yes | Yes | **NOT_IMPLEMENTED** | No | No | admin | V2 | L3 | — |
| Ban | REST | Guilds | BAN_MEMBERS | Yes | Yes | **NOT_IMPLEMENTED** | No | No | admin | V2 | L3 | — |
| Guild user allowlist (inbound) | Gateway | GuildMessages | — | n/a | Yes | **PASS** | Yes | Yes | config | V1 | n/a | Fail-closed; live authorize path |

*Privileged intent — not used in LAB.

---

## REACTIONS

| Capability | Discord surface | Intent | Permission | discord.js | Architecture | Implemented | Unit | Live | DSH surface | Tier | Risk | Gap |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Add reaction | REST | — | ADD_REACTIONS | Yes | Yes | **NOT_IMPLEMENTED** | No | No | tool | V2 | L1 | — |
| Remove reaction | REST | — | MANAGE_MESSAGES / own | Yes | Yes | **NOT_IMPLEMENTED** | No | No | tool | V2 | L1 | — |
| Inbound reaction events | Gateway | GuildMessageReactions | — | Yes | Yes | **NOT_IMPLEMENTED** | No | No | inbound | V2 | L0 | Intent optional in Settings |

---

## WEBHOOKS

| Capability | Discord surface | Intent | Permission | discord.js | Architecture | Implemented | Unit | Live | DSH surface | Tier | Risk | Gap |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Incoming webhooks (execute) | REST | GuildWebhooks | Manage Webhook (bot) | Yes | Yes | **NOT_IMPLEMENTED** | No | No | transport | V2 | L2 | Contract target V2 |
| Application webhooks | REST | — | — | Yes | Yes | **NOT_IMPLEMENTED** | No | No | transport | V2 | L2 | — |
| Discord Webhook Events | Gateway/HTTP | — | — | Yes | Yes | **NOT_IMPLEMENTED** | No | No | inbound | V2 | L2 | — |

---

## OTHER PLATFORM

| Capability | Discord surface | Intent | Permission | discord.js | Architecture | Implemented | Unit | Live | DSH surface | Tier | Risk | Gap |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Presence | Gateway | GuildPresences* | — | Yes | Yes | **NOT_IMPLEMENTED** | No | No | none | LATER | L0 | Privileged |
| Typing indicator | Gateway | GuildMessageTyping | — | Yes | Yes | **NOT_IMPLEMENTED** | No | No | none | V2 | L0 | — |
| Invites | REST + Gateway | GuildInvites | CREATE_INSTANT_INVITE | Yes | Yes | **NOT_IMPLEMENTED** | No | No | admin | V2 | L2 | — |
| Emojis / stickers | REST | GuildExpressions | MANAGE_EMOJIS | Yes | Yes | **NOT_IMPLEMENTED** | No | No | admin | V2 | L2 | Button emoji field only |
| Audit log | Gateway | GuildModeration | VIEW_AUDIT_LOG | Yes | Yes | **NOT_IMPLEMENTED** | No | No | admin | V2 | L0 | — |
| Scheduled events | Gateway | GuildScheduledEvents | — | Yes | Yes | **NOT_IMPLEMENTED** | No | No | none | LATER | L0 | Intent in Settings list |
| Stage channels | Gateway | Guilds | — | Yes | Yes | **NOT_IMPLEMENTED** | No | No | none | LATER | n/a | — |
| Voice / audio transport | Gateway + Voice | GuildVoiceStates | CONNECT / SPEAK | Yes | Yes | **NOT_IMPLEMENTED** | No | No | none | LATER | n/a | Out of V1 scope |
| Activities / Social SDK | Gateway | — | — | Partial | Yes | **NOT_IMPLEMENTED** | No | No | none | LATER | n/a | — |

---

## DSH INTEGRATION SURFACES

| Capability | Architecture | Implemented | Unit | Live | DSH surface | Tier | Risk | Gap |
|---|---|---|---|---|---|---|---|---|
| ConversationBinding adapter | Yes | **PASS** | Yes | Yes | bridge | V1 | n/a | Session mint + thread binding |
| Proactive notify (no session) | Yes | **PASS** | Yes | Yes | service | V1 | L2 | `notify` / aliases |
| Semantic service (reads) | Yes | **IMPLEMENTED_UNTESTED** | Yes | No | service | V1 | L0 | Live read smoke pending |
| Semantic service (mutations) | Yes | **PASS** | Yes | Yes | service | V1 | L2 | send/reply/edit/thread |
| Model tools `discord_*` | Yes | **PASS** | Yes | Yes | tool | V1 | L0–L2 | Hard-inject `tools`; 9 tools |
| Policy pre-execute path | Yes | **PASS** | Yes | Partial | tool | V1 | L2 | Live policy log on tool smoke |
| DeliveryOutbox (all outbound) | Yes | **PASS** | Yes | Yes | transport | V1 | n/a | Bypass audit test |
| Inbound dedupe (72h TTL) | Yes | **PASS** | Yes | Yes | transport | V1 | n/a | Live interaction claims |
| Settings → Discord UI | Yes | **PASS** | Yes | n/a | config | V1 | n/a | Targets section added |
| `discord.rest.raw` | Yes | **DEFERRED** | No | No | tool | V1 MUST→defer | L3 | Policy blockers documented |
| `discord.admin.*` | Yes | **NOT_IMPLEMENTED** | No | No | admin | V2 | L3 | Not registered |
| Observability bridge | Yes | **IMPLEMENTED_UNTESTED** | Partial | Partial | transport | V1 | L0 | Closed Core EVENT_TYPES only |
| Agent preset on session mint | Yes | **PASS** | Yes | Partial | bridge | V1 | n/a | Fail-closed preset |

---

## RAW REST RE-EVALUATION

| Guard required | Status | Notes |
|---|---|---|
| Method + path classification | **NOT_IMPLEMENTED** | Policy has action strings for semantic tools only |
| Allowlisted route registry | **NOT_IMPLEMENTED** | No REST route table in policy engine |
| Mutating unknown-path approval | **NOT_IMPLEMENTED** | Would need per-route L2/L3 map |
| Response redaction | **NOT_IMPLEMENTED** | No token/secret scrubber on raw responses |
| Bounded response size | **NOT_IMPLEMENTED** | — |
| Rate-limit op integration | **PARTIAL** | Outbox 429 for known ops; not for arbitrary REST |

**Verdict:** `discord.rest.raw` remains **DEFERRED_WITH_BLOCKER**. Semantic tools are the supported V1 surface.

---

## References

- Discord Gateway intents: [Gateway events](https://discord.com/developers/docs/events/gateway) (official intent → event map)
- Message create limits: [Create Message](https://discord.com/developers/docs/resources/message#create-message)
- Thread permissions: [Threads](https://discord.com/developers/docs/topics/threads)
- Components V2: [Display Components](https://discord.com/developers/docs/components/reference) (API v10)
- Plugin contracts: `docs/FEATURE-CONTRACT.md`, `docs/TOOL-CONTRACT.md`, `docs/EVENT-CONTRACT.md`, ADR-0007

---

## Audit verdict

| Field | Value |
|---|---|
| **VERDICT** | **CAPABILITY_MATRIX_COMPLETE** |
| **TOTAL_CAPABILITIES** | **98** (rows in tables above) |
| **IMPLEMENTED** | **42** (PASS + IMPLEMENTED_UNTESTED + REPRESENTED_ONLY with encoder/handler code) |
| **LIVE_PROVEN** | **18** (PASS rows with Live = Yes) |
| **V1_GAPS** | **12** (see Summary — delete, attachments, read live, inbound updates, raw REST, recovery evidence, …) |
| **V2** | **28** candidates |
| **LATER** | **8** |
| **SECURITY_BLOCKERS** | **1** (`discord.rest.raw` policy seam) + moderation/admin not implemented by design |
| **PRODUCTION_READY** | **NO** |
| **NEXT** | Production-readiness closure driven by this matrix: delete + attachment upload, read live smokes, inbound update/delete, restart recovery evidence, permission/rate-limit error matrix, observability correlation |
