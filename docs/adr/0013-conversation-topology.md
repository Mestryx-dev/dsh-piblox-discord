# ADR-0013: Discord conversation topology (channel vs thread-per-conversation)

- Status: Accepted
- Date: 2026-09-10
- Deciders: Florian (Vega LAB — after channel multi-turn delivery proven)

## Context

Channel mode binds one ConversationBinding / DSH session per Discord channel.
Vega LAB needs multiple parallel conversations in one launcher channel without
creating one Discord channel per session.

ConversationBinding encoding already distinguishes `.channel` vs `.thread`
(ADR-0010). The gap was runtime topology: spawn Discord threads, authorize via
parent channel, and keep outbox/dedupe reliability.

## Decision

Per-account field `conversationMode`:

| Value | Default | Behaviour |
|---|---|---|
| `channel` | **yes** | Allowed messages in a channel share one binding/session |
| `thread_per_conversation` | no | Each top-level launcher message → public thread from that message → one binding/session |

Principles (LOCKED):

1. **Channel = durable entry surface**; **thread = conversation surface**.
2. **ConversationBinding remains session identity SSOT** — no second thread store.
3. Thread events authorize via **parent_channel_id** allowlist (not dynamic thread ids).
4. Thread create goes through **DeliveryOutbox** (`createThread`); operation id
   `thread:create:<account_id>:<parent_message_id>` for idempotent reconcile.
5. Original parent `MESSAGE_CREATE` is the canonical inbound event (dedupe on
   parent `message_id`); do not wait for a Discord copy of the starter inside the thread.
6. Assistant outbound for a thread-bound session targets **thread_id only**.
7. Existing accounts keep `channel`; no silent migration.
8. Plugin stays generic — no product-specific branches.

Managed-thread policy: fail closed when parent is missing/unverifiable.
If a message arrives in an allowed parent’s thread without a binding, create a
new binding/session for that thread (documented recovery). Do not bind arbitrary
guild threads.

Archive: does not delete binding/session. Inbound in a reopened thread reuses
the same session. Proactive send into a locked/archived thread may fail cleanly.

## Consequences

- Vega (and any account) can opt into thread topology without affecting others.
- Channel-mode regression tests remain authoritative for default behaviour.
- Required Discord permissions include Create Public Threads + Send Messages in Threads
  (not Administrator / Manage Threads unless API forces it).

## Evidence

- `test/thread-topology.test.js`
- Binding encoding: ADR-0010 / `test/binding.test.js`
- Outbox `createThread` + resource id = thread snowflake
- Live LAB (2026-09-10): inaugural thread `sendMessage` requires Discord nonce ≤25 (`nonceFromOperationId`); fixed in follow-up commit after `NONCE_TYPE_TOO_LONG` on first topology smoke
