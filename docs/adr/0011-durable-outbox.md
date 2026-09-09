# ADR-0011: Durable Discord delivery outbox (JSON ledger)

- Status: Accepted
- Date: 2026-09-09
- Deciders: Florian (reliability spike)

## Context

V1 bridge proved FakeTransport ↔ DSH session. Live Discord must not repeat the
Atlas failure mode (partial multi-step delivery + 429 + process exit). We need
crash-safe transport state without Postgres/Redis for this plugin.

## Decision

Use a **plugin-owned durable JSON ledger** (same fsync+rename+O_EXCL pattern as
`dsh-conversation-binding`):

- Default path: `$HOME/dsh-lab/runtime/dsh-home/ledger/discord-outbox.json`
- Schema: `{ version, operations, groups }`
- Scheduler uses injected `clock` (`FakeClock` in tests; system clock in prod)
- Per-account isolation; auth failures isolate one account
- Create Message: `operation_id` → deterministic `nonce` + `enforce_nonce`
- No HTTP `Idempotency-Key` header

Restart: any `sending` operation is recovered to `queued` at `clock.now()`.

## Consequences

- Outbox is transport state only — never a second ConversationBinding
- Live DiscordJsTransport must map 429/`retryAfter` into the same error model
- Full Discord global/per-route bucket fidelity is DESIGNED_FOR_LIVE, not claimed yet

## Rejected alternatives

| Alternative | Why rejected |
|---|---|
| In-memory only | No crash recovery |
| Postgres/Redis for V1 | Overkill; violates YAGNI for single-seat lab |
| Invent Idempotency-Key | Not a Discord Create Message contract |
