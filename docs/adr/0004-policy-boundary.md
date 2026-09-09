# ADR-0004: Policy boundary

- Status: Accepted
- Date: 2026-09-09
- Deciders: Florian (mission lock)

## Context

Discord buttons and slash commands feel like “controls”. Atlas-style flows can
accidentally couple UI clicks to privileged executors. DSH already has
`dsh-policy-engine` with AUTO / APPROVAL / DENY and upstream `ctx.approval` park.

## Decision

Discord is an **input / intent / context** surface. Authorization for sensitive
DSH operations remains with `dsh-policy-engine` and domain policy. The plugin:

- exposes interactions and tools
- transports intents (e.g. ApprovalIntent payloads)
- never authorizes domain executors by Discord identity alone

## Consequences

- Button handlers stop at normalization + consumer handoff
- Admin tools are policy-gated
- Discord approval UX must integrate with existing park path (OPEN details)

## Rejected alternatives

| Alternative | Why rejected |
|---|---|
| Bot owner Discord id = automatic L4 allow | Confused deputy; token theft = full power |
| Plugin-local approval store | Splits audit from policy engine |
| Execute reboot from button handler | Mission-forbidden pattern |

## Evidence

- OBSERVED policy `tools/pre-execute` park path; `requestApproval()` stub
- Mission §2.5
- SECURITY.md axiom
