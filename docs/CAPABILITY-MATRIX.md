# Discord capability matrix — dsh-piblox-discord

**STATUS:** V1 production-readiness closure evidence (2026-09-10)  
**Repo truth:** `62e8189` on `master` · **185/185** tests PASS · **PRODUCTION_READY = YES** (V1 semantic surface)  
**Primary sources:** [Discord Developer Docs](https://discord.com/developers/docs/intro) (API v10) · discord.js **14.27.0** · this repository (`src/`, `test/`) · LAB Gateway smokes

This matrix compares **Discord platform capabilities** against **observed plugin implementation**.  
**Implemented / Unit / Live** come from code and tests — not design docs alone.

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
| **ACCEPTED_DEFER** | V1 SHOULD item explicitly accepted as non-blocking for production |

## DSH surface legend

| Surface | Meaning |
|---|---|
| **service** | `ctx.discord` semantic API |
| **tool** | Model-facing `discord_*` via policy → service → outbox |
| **inbound** | Normalized Gateway event → bridge |
| **components** | `ComponentNode` encode/decode |
| **transport** | Internal transport / outbox only |
| **admin** | Future `discord.admin.*` (not registered V1) |
| **none** | Not exposed |

---

## Phase 1 — V1 gap reconciliation (2026-09-10)

| Capability | Prior | Classification | Why |
|---|---|---|---|
| Message delete | NOT_IMPLEMENTED | **MUST_CLOSE** → **PASS** | Semantic/outbox/tool; live bot-owned delete |
| Attachment upload | NOT_IMPLEMENTED | **MUST_CLOSE** → **PASS** | Staged safe pipeline; live `.txt` |
| Read tools live | IMPLEMENTED_UNTESTED | **TEST_EVIDENCE_ONLY** → **PASS** | Live guild/channel/history/get |
| MESSAGE_UPDATE / DELETE | NOT_IMPLEMENTED | **MUST_CLOSE** → **PASS** (unit) | Normalize + authorize + dedupe; no transcript mutation |
| Thread list/sync | NOT_IMPLEMENTED | **ACCEPTED_DEFER** (partial) | `threadUpdate` archive observe only; no THREAD_LIST API |
| Archive/unarchive REST | NOT_IMPLEMENTED | **ACCEPTED_DEFER** | Needs ManageThreads; binding survives `threadUpdate` |
| Reconnect/resume | IMPLEMENTED_UNTESTED | **TEST_EVIDENCE_ONLY** → **PASS** | discord.js-owned; profile restart reconnect proven |
| Outbox crash recovery | PASS unit | **MUST_CLOSE** evidence → **PASS** | Deterministic sending→queued; live mid-flight kill not required |
| Rate-limit matrix | Partial | **MUST_CLOSE** → **PASS** det. | FakeTransport 429; LIVE_429=NOT_INTENTIONALLY_INDUCED |
| Permission/error matrix | Partial | **MUST_CLOSE** → **PASS** | Classified taxonomy + unit matrix |
| Observability correlation | Partial | **MUST_CLOSE** → **PASS** | Closed Core EVENT_TYPES only |
| Packaging/clean install | — | **MUST_CLOSE** → **PASS** | `npm ci` disposable + profile boot |
| DM outbound live | IMPLEMENTED_UNTESTED | **ACCEPTED_DEFER** | LAB `dm.enabled=false` |
| `discord.rest.raw` | DEFERRED | **ACCEPTED_DEFER** | Policy blockers remain; semantic surface sufficient |
| Standalone thread create | NOT_IMPLEMENTED | **ACCEPTED_DEFER** | V1 uses message-starter threads |
| Member/role/admin | NOT_IMPLEMENTED | **ACCEPTED_DEFER** | Admin/moderation out of V1 |
| Ephemeral live | IMPLEMENTED_UNTESTED | **ACCEPTED_DEFER** | Flag supported; not live-smoked |

---

## Summary

### V1 COMPLETE

- Multi-account fail-closed allowlists + proactive aliases
- Gateway connect + MESSAGE_CREATE + UPDATE/DELETE normalize + inbound dedupe
- Outbox send / reply / edit / **delete** / createThread + interaction ops
- **Attachment upload** (staged, path-sanitized, size-bounded)
- Thread-from-message + `thread_per_conversation`; archive observation preserves binding
- Components V2 foundation + Button/StringSelect live
- Semantic service + 10 `discord_*` tools (incl. delete) + proactive notify
- Read path live: guild list, channel get/list, message get/history
- Deterministic 429 / error taxonomy / crash recovery
- Clean install + profile reconnect

### V1 ACCEPTED_DEFER (non-blocking)

- `discord.rest.raw` (DEFERRED_WITH_BLOCKER)
- DM live (LAB disabled)
- Archive/unarchive REST (ManageThreads)
- Standalone private threads / forum / member intents
- Ephemeral live smoke / embeds convenience

### V2 CANDIDATES / LATER / SECURITY

Unchanged intent from prior audit: commands, modals, webhooks, admin/moderation, voice, custom sharding.  
**SECURITY-SENSITIVE:** raw REST, moderation, privileged intents (operator opt-in only).

### LIVE LAB (2026-09-10, scopes unchanged)

| Smoke | Result |
|---|---|
| Read tools | `guilds=1` `channel=1547367510590885888` `hist=5` `get=…` `channels=20` |
| Attachment `.txt` | `state=delivered` resource `1547481277140045844` |
| Delete bot-owned | `prep=delivered` → `delete=delivered` op `lab:delete:vega:…` |
| Reconnect | profile kill → restart → Gateway ready; allowlists unchanged |
| LIVE_429 | **NOT_INTENTIONALLY_INDUCED** |
| Thread archive REST | **OPERATOR_ACTION_REQUIRED** (do not add ManageThreads for smoke) |

---

## CONNECTIVITY

| Capability | Discord surface | Intent | Permission | Architecture | Implemented | Unit | Live | DSH surface | Tier | Risk | Gap |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Gateway WebSocket | Gateway | Guilds + message intents | Bot token | Yes | **PASS** | Yes | Yes | transport | V1 | n/a | — |
| Reconnect | Gateway | — | — | Yes | **PASS** | Yes | Yes | transport | V1 | n/a | discord.js Client owns resume |
| Resume | Gateway | — | — | Yes | **PASS** | n/a | Yes | transport | V1 | n/a | No custom RESUME; djs internal |
| Intents config | Gateway | Per-intent | Portal | Yes | **PASS** | Yes | Yes | config | V1 | n/a | — |
| Guild install | Gateway+REST | Guilds | Invite | Yes | **PASS** | Yes | Yes | inbound | V1 | n/a | — |
| User install | Gateway+REST | DM-related | User add | Yes | **REPRESENTED_ONLY** | Partial | No | inbound | V2 | L1 | ACCEPTED_DEFER ops |
| Sharding (default) | Gateway | — | — | Yes | **PASS** | Partial | Yes | transport | V1 | n/a | Single Client |
| Rate-limit observation | REST | — | — | Yes | **PASS** | Yes | Partial | transport | V1 | n/a | LIVE_429 not induced |
| FakeTransport | — | — | — | Yes | **PASS** | Yes | n/a | transport | V1 | n/a | — |

## MESSAGES

| Capability | Discord surface | Intent | Permission | Architecture | Implemented | Unit | Live | DSH surface | Tier | Risk | Gap |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Send | REST | GuildMessages | SEND_MESSAGES | Yes | **PASS** | Yes | Yes | service+tool | V1 | L2 | — |
| Reply | REST | Same | SEND_MESSAGES | Yes | **PASS** | Yes | Yes | service+tool | V1 | L2 | — |
| Edit | REST | Same | own msg | Yes | **PASS** | Yes | Partial | service+tool | V1 | L2 | — |
| Delete | REST | Same | own / MANAGE_MESSAGES | Yes | **PASS** | Yes | Yes | service+tool | V1 | L2 | Model tool = bot-owned only |
| History | REST | MESSAGE_CONTENT | READ_MESSAGE_HISTORY | Yes | **PASS** | Yes | Yes | service+tool | V1 | L0 | Bounded |
| Message get | REST | MESSAGE_CONTENT | READ_MESSAGE_HISTORY | Yes | **PASS** | Yes | Yes | service+tool | V1 | L0 | — |
| Attachments upload | REST multipart | — | SEND_MESSAGES | Yes | **PASS** | Yes | Yes | service+tool | V1 | L2 | Relative path / inline text; staged |
| Embeds | REST | — | SEND_MESSAGES | Yes | **IMPLEMENTED_UNTESTED** | Partial | No | service | V1 | L1 | ACCEPTED_DEFER primary path |
| Allowed mentions | REST | — | — | Yes | **PASS** | Yes | Yes | service | V1 | n/a | `{parse:[]}` |
| Components V2 outbound | REST | — | SEND_MESSAGES | Yes | **PASS** | Yes | Yes | components | V1 | L2 | — |
| Nonce + enforce_nonce | REST | — | — | Yes | **PASS** | Yes | Yes | transport | V1 | n/a | ≤25 |
| Forwarding / polls / voice-msg | — | — | — | Partial | **NOT_IMPLEMENTED** | No | No | none | V2 | — | — |

## CHANNELS / THREADS (abbrev.)

| Capability | Implemented | Unit | Live | Tier | Notes |
|---|---|---|---|---|---|
| Channel get/list, guild list | **PASS** | Yes | Yes | V1 | Allowlist gated |
| Channel create/edit/delete | **NOT_IMPLEMENTED** | No | No | V2 | Admin |
| Thread from message | **PASS** | Yes | Yes | V1 | — |
| Standalone / private / forum | **NOT_IMPLEMENTED** | No | No | V2/ACCEPTED_DEFER | — |
| Thread update (archive/lock observe) | **PASS** | Yes | No | V1 | Binding preserved; no session delete |
| Archive REST | **NOT_IMPLEMENTED** | No | No | ACCEPTED_DEFER | OPERATOR_ACTION_REQUIRED for live archive |
| thread_per_conversation | **PASS** | Yes | Yes | V1 | — |

## COMPONENTS V2 / INTERACTIONS

Unchanged PASS foundation (Button, StringSelect, defer/followUp live). Other selects/modals/commands remain V2 / REPRESENTED_ONLY as prior audit.

## MEMBERS / REACTIONS / WEBHOOKS / OTHER

Admin, reactions, webhooks, voice, presence → **NOT_IMPLEMENTED** V2/LATER (by design). Guild user allowlist inbound **PASS**.

## DSH INTEGRATION

| Capability | Implemented | Unit | Live | Notes |
|---|---|---|---|---|
| ConversationBinding | **PASS** | Yes | Yes | Survives thread archive observe |
| Proactive notify | **PASS** | Yes | Yes | No session mint |
| Semantic reads | **PASS** | Yes | Yes | — |
| Semantic mutations (+delete+attach) | **PASS** | Yes | Yes | Outbox only |
| Model tools (10) | **PASS** | Yes | Yes | Incl. `discord_message_delete` |
| Policy pre-execute | **PASS** | Yes | Yes | Delete AUTO L2 |
| DeliveryOutbox | **PASS** | Yes | Yes | Crash recovery unit |
| Inbound dedupe | **PASS** | Yes | Yes | Lifecycle events included |
| Observability | **PASS** | Yes | Partial | Closed Core types only; no `discord.*` Core types |
| `discord.rest.raw` | **DEFERRED** | No | No | ACCEPTED_DEFER for prod |
| Clean install | **PASS** | n/a | Yes | `npm ci` disposable + profile boot |

## RAW REST

Still **DEFERRED_WITH_BLOCKER** — method/path classifier, route allowlist, redaction, bounded response missing. Semantic tools are the supported V1 surface. **Does not block PRODUCTION_READY.**

## Error classification matrix (V1)

| Discord condition | error_class / code | Retryable | Terminal | Outbox state | Security |
|---|---|---|---|---|---|
| 429 + Retry-After | transport_failure / 429 | Yes | No | retry_wait | Account-isolated scheduling |
| 5xx | transport_failure / 5xx | Yes | After max | retry→failed_terminal | — |
| Network / timeout | transport_failure | Yes / ambiguous | After max | retry_wait | Nonce reconcile on timeout |
| Auth / invalid token | transport_failure / auth | No | Yes | failed_terminal + isolate | No token in receipt |
| Missing Access/Permissions / archived thread | discord_domain_failure / permission | No | Yes | failed_terminal | — |
| Unknown channel/message | discord_domain_failure / unknown_target | No | Yes | failed_terminal | — |
| Invalid form body | discord_domain_failure / invalid_payload | No | Yes | failed_terminal | — |
| Interaction expired / already ack | discord_domain_failure | No | Yes | failed_terminal | — |
| Foreign message delete (model) | permission / foreign_message | No | Yes | failed_terminal | Refuse before MANAGE_MESSAGES |

Raw Discord error bodies are not forwarded to model receipts (class + short message only).

## Attachment contract (V1)

- **Model tool:** relative path under `DSH_DISCORD_ATTACH_DIR` / attachment root, or `{ text, filename }` ≤64KB. No absolute paths, no `..`, no secret-file exfiltration.
- **Service trusted:** same + staged under `ledger/discord-attachment-staging/<op>/` for retry-safe re-read.
- **DSH image `attachmentId`:** available in Core for images; Discord V1 uses workspace-relative / inline text first (no unsafe base64 blobs in tool schemas).
- Max 10 files / 8MB each (bot default).

## Inbound UPDATE/DELETE (V1)

Provider: normalize → authorize (channel-only if uncached delete) → dedupe → emit `request.received` metadata.  
**Session transcript mutation: out of scope** (no canonical DSH edit/delete-turn seam).

---

## Audit verdict

| Field | Value |
|---|---|
| **VERDICT** | **CAPABILITY_MATRIX_COMPLETE** + **V1_CONTRACT_CLOSURE=PASS** |
| **TOTAL_CAPABILITIES** | **98** |
| **V1 PASS** | Prior PASS + delete, attachments, reads live, lifecycle normalize, reconnect, error/429 matrix, packaging |
| **ACCEPTED_DEFER** | raw REST, DM live, archive REST, standalone threads, admin, ephemeral live |
| **BLOCKED** | 0 production blockers on semantic V1 surface |
| **TESTS** | **185/185** PASS (was 174) |
| **PRODUCTION_READY** | **YES** |
| **NEXT** | Freeze V1; tag/release only after operator authorization; then selected V2 |

### Gate checklist

| Gate | Result |
|---|---|
| V1_CONTRACT_CLOSURE | **PASS** |
| OUTBOX_RECOVERY | **PASS** (deterministic) |
| ERROR_CLASSIFICATION | **PASS** |
| SECURITY_BOUNDARY | **PASS** (scopes unchanged; raw REST off) |
| OBSERVABILITY | **PASS** (Core types only; no tokens) |
| CLEAN_INSTALL | **PASS** |
| LIVE_CORE_SMOKE | **PASS** (read + attach + delete + reconnect) |
