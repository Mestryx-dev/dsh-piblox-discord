# dsh-piblox-discord

**STATUS: DESIGN / NOT IMPLEMENTED**

First-party Cordis / DeepSeek Harness (DSH) **generic Discord provider**.

This repository currently contains architecture and feature contracts only.
There is no `src/`, no Discord client dependency, and no runnable bot.

## What

`dsh-piblox-discord` is the bidirectional interface between Discord and DSH:

```text
Discord ↔ dsh-piblox-discord ↔ DSH Core
```

It is a transport + interaction surface for any DSH install, agent, or consumer
plugin — not a product-specific bot.

## Why

DSH needs Discord as:

- user interface
- messaging platform
- conversational transport
- event source
- interaction surface (commands, buttons, modals)
- agent tool surface
- notification target
- administration surface (policy-gated)

## Non-goals

This plugin Core must **not** contain:

- Vega business logic or persona
- InfraMaintainer / maintenance plan logic
- Cursor-specific remote/follow-up semantics
- policy engine decisions (`AUTO` / `APPROVAL` / `DENY`)
- domain executors (reboot, apply, pin, deploy)
- maintenance renderers or P0–P4 taxonomies

Those belong in consumer plugins / domain seats that call this provider.

## Architecture (locked intent)

```text
1 plugin
  → 0..N Discord accounts (applications/bots)
      → 0..N guilds
          → 0..N channels / threads / DMs
              → ConversationBinding + DSH routing
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/adr/](docs/adr/).

## Design documents

| Doc | Role |
|---|---|
| [DESIGN-STATUS.md](DESIGN-STATUS.md) | Decision matrix (LOCKED / PROPOSED / OPEN / BLOCKED) |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Logical architecture |
| [docs/FEATURE-CONTRACT.md](docs/FEATURE-CONTRACT.md) | Target surface + V1/V2/LATER |
| [docs/DSH-INTEGRATION.md](docs/DSH-INTEGRATION.md) | Observed DSH contracts + binding keys |
| [docs/CONFIGURATION.md](docs/CONFIGURATION.md) | Multi-account config schema |
| [docs/EVENT-CONTRACT.md](docs/EVENT-CONTRACT.md) | Normalized Discord events |
| [docs/TOOL-CONTRACT.md](docs/TOOL-CONTRACT.md) | `discord.*` / `discord.admin.*` tools |
| [docs/STATE-RELIABILITY.md](docs/STATE-RELIABILITY.md) | State ownership + failure semantics |
| [docs/SECURITY.md](docs/SECURITY.md) | Trust boundaries |

## Lab placement

Per O-05=c:

```text
~/dsh-lab/plugins/dsh-piblox-discord/   # this repo (lab home)
```

Promote to `repositories/Piblox/plugins/dsh-piblox-discord` only after Core gate PASS.
Wire via profile `file:` dependency — **not done in this bootstrap**.

## Evidence labels used in docs

| Label | Meaning |
|---|---|
| `OBSERVED` | Verified against local DSH first-party code / dossiers |
| `LOCKED` | Product decision for this plugin (mission / ADR) |
| `PROPOSED` | Design proposal pending human review before coding |
| `OPEN` | Gap or undecided contract — must not invent APIs |
| `REFERENCE` | External research (community Discord bridge, Discord docs) — not adopted |

## License

MIT — same as sibling first-party plugin `dsh-piblox-secrets`.
