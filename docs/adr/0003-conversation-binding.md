# ADR-0003: Conversation binding reuse

- Status: Accepted
- Date: 2026-09-09
- Deciders: Florian (mission lock)

## Context

Upstream DSH has durable sessions but no channel↔session map.
`dsh-conversation-binding` already provides opaque
`provider + scope + external_id → session_id`.

Community Discord designs often keep a private StateStore for sessions.

## Decision

Reuse Cordis service `conversationBinding` exclusively for Discord conversation
→ session mapping. Discord adapter proposes encodings:

```text
provider=discord
scope=<account_id>.<kind>    # kind ∈ dm|channel|thread|channel_user
external_id=<snowflake…>     # no ':' characters
```

(Encoding details remain PROPOSED until human lock; decision to **reuse** is Accepted.)

## Consequences

- No second session map in this plugin
- Account isolation via `scope` prefix
- Adapter must supply `createSessionId` callback

## Rejected alternatives

| Alternative | Why rejected |
|---|---|
| Plugin-local StateStore for sessions | Duplicates Core; drift risk |
| Encode everything in `external_id` only | Harder audit of conversation kind |
| Extend CB schema with guild/user fields | Violates CB non-goals; requires Core change |

## Evidence

- OBSERVED `~/dsh-lab/plugins/dsh-conversation-binding/src/index.js`
- OBSERVED dossier `50-contracts/CONVERSATION-BINDING.md`
- Mission §2.4
