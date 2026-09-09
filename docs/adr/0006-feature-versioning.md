# ADR-0006: Feature versioning (wide target, incremental delivery)

- Status: Accepted
- Date: 2026-09-09
- Deciders: Florian (mission lock)

## Context

Discord’s surface area is large (voice, admin, components, forums, …). Shipping
“all Discord” as V1 blocks learning and risks product-specific creep.

## Decision

Maintain a **wide target feature contract**, classified as:

- V1 MUST / V1 SHOULD
- V2
- LATER

V1 must prove architecture (multi-account, binding, reliability, basic
messaging/interactions, tools, observability bridge) without implementing the
full target.

## Consequences

- Docs describe future capabilities without committing implementation order beyond classes
- V1 stays demosable: Discord ↔ DSH ↔ Discord
- Voice and full admin remain explicitly deferred

## Rejected alternatives

| Alternative | Why rejected |
|---|---|
| V1 = full Discord API coverage | Unshippable; hides architecture risk |
| Docs only describe V1 | Loses target architecture; invites rewrite |
| Separate repos per feature slice | Unnecessary fragmentation pre-Core gate |

## Evidence

- Mission §8–9
- FEATURE-CONTRACT.md
