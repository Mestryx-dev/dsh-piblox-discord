# ADR-0005: State ownership

- Status: Accepted
- Date: 2026-09-09
- Deciders: Florian (mission lock)

## Context

Reliable Discord transport needs durable outbound jobs, dedupe, and rate-limit
handling. Conversation session mapping already has a Core owner. Mixing them
recreates Atlas partial-failure and dual-source-of-truth bugs.

## Decision

| State class | Owner |
|---|---|
| Conversation ↔ session | `conversationBinding` only |
| Correlation / Core events | `observability` |
| Policy / approvals | `policy` + upstream approval |
| Tokens | `secrets` |
| Transport: outbox, dedupe, interaction ack, per-account gateway | **this plugin** |

Plugin state is limited to **transport / protocol / delivery**.

## Consequences

- Durable outbox is in-scope for the plugin
- No parallel ConversationBinding
- Clear recovery story for 429 / crash mid multi-step send

## Rejected alternatives

| Alternative | Why rejected |
|---|---|
| All Discord state in CB store | CB non-goals forbid message/guild maps |
| Memory-only outbound queue | Reproduces Atlas partial thread after crash |
| Observability as outbox | Wrong abstraction; closed event types |

## Evidence

- OBSERVED CB / observability / secrets ownership
- Mission §2.7 transport reliability
- STATE-RELIABILITY.md
