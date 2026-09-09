# ADR-0001: Plugin scope — generic Discord provider

- Status: Accepted
- Date: 2026-09-09
- Deciders: Florian (mission lock)

## Context

DSH needs a Discord surface. Historical Atlas Discord code and community
`dsh-discord` mix transport with product-specific agent control. Prior audits
noted O-04 options including community bridges and Hermes-hybrid approaches.

## Decision

`dsh-piblox-discord` is a **first-party generic Discord provider** for DSH:

- Cordis/DSH plugin
- Bidirectional Discord ↔ DSH transport and interaction surface
- Usable by any agent/consumer (including future Vega or InfraMaintainer seats)
- **No** product business logic in Core

## Consequences

- Clear boundary for implementation and testing
- Consumers own domain semantics
- Slightly more wiring for product bots (they compose provider + domain plugin)

## Rejected alternatives

| Alternative | Why rejected |
|---|---|
| Fork community `dsh-discord` as-is | Product AgentController + parallel StateStore; upstream drift |
| Hermes gateway remains only Discord surface | Does not give DSH-native provider; O-04 hybrid is not this product |
| Fat multi-channel overdrive gateway | Over-scope for V1 provider |
| Per-product Discord plugins (`dsh-vega-discord`, …) | Duplicates transport; encourages Core forks |

## Evidence

- Mission §1–2 LOCKED
- Hindsight: first-party thin adapter on ConversationBinding preferred over fork
- Lab plugins README O-05=c path `~/dsh-lab/plugins/<id>/`
