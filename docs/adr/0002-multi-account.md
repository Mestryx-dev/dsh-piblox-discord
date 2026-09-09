# ADR-0002: Multi-account native model

- Status: Accepted
- Date: 2026-09-09
- Deciders: Florian (mission lock)

## Context

Multiple Discord Applications/bots are expected (separate trust domains, e.g.
different seats). A singleton bot token model forces unsafe sharing or multiple
plugin installs.

## Decision

Configuration and runtime model:

```text
1 plugin → 0..N Discord accounts → guilds → channels/threads → bindings
```

No artificial `ONE_PLUGIN = ONE_BOT` constraint. “N” means no plugin-imposed
arbitrary cap; Discord/runtime limits still apply.

## Consequences

- Per-account Gateway, REST, intents, allowlists, credential refs
- Binding keys must encode `account_id` (see ADR-0003)
- Operational complexity higher than single-bot MVP

## Rejected alternatives

| Alternative | Why rejected |
|---|---|
| One bot per plugin install | Multiplies processes; splits shared Core services awkwardly |
| Shared singleton token | Cross-domain blast radius |
| Hard-coded dual accounts only | Artificial limit |

## Evidence

- Mission §2.3 LOCKED
- Security isolation needs (SECURITY.md)
