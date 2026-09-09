# ADR-0010: Discord ConversationBinding key encoding

- Status: Accepted
- Date: 2026-09-09
- Deciders: Florian (V1 spike — proven by automated tests)

## Context

`conversationBinding` requires `provider` / `scope` / `external_id` non-empty and
without `:`. Discord needs multi-account isolation and channel vs thread distinction.

## Decision

| Kind | provider | scope | external_id |
|---|---|---|---|
| DM | `discord` | `<account_id>.dm` | `<user_id>` |
| Channel | `discord` | `<account_id>.channel` | `<channel_id>` |
| Thread | `discord` | `<account_id>.thread` | `<thread_id>` |
| Channel+user (optional) | `discord` | `<account_id>.channel_user` | `<channel_id>.<user_id>` |

`account_id` must not contain `:`.

## Consequences

- Two Discord accounts cannot collide on the same Discord snowflake
- Channel and thread namespaces are distinct even if IDs overlap
- Encoding is LOCKED for V1

## Evidence

- `test/binding.test.js` — isolation, reuse, concurrent resolveOrCreate
- OBSERVED `dsh-conversation-binding` canonicalKey rules
