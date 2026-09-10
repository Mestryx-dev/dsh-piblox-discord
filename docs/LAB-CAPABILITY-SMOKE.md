# LAB Discord V1 Capability Smoke

**Status:** LAB/dev harness only — **not** a production feature.  
**Default:** disabled (`production_default_enabled: NO`).

Isolated entrypoint that exercises safe, implemented V1 capabilities against FakeTransport (CI) or a live LAB Gateway (operator-gated).

## Isolation

| Surface | Behavior |
|---|---|
| Plugin boot (`api.start`) | Does **not** invoke capability smoke |
| Gateway / `bridge.js` | No magic content triggers (`RUN_ALL_TESTS`, etc.) |
| Cordis API | Explicit only: `provider.runCapabilitySmoke({...})` |
| CLI | `scripts/discord-v1-capability-smoke.mjs` |

## Commands

### Fake (CI / local — no Discord token)

```bash
cd /home/mestryx/dsh-lab/plugins/dsh-piblox-discord
npm run capability-smoke
# or
node scripts/discord-v1-capability-smoke.mjs --mode=fake
```

Interactive keys stay `WAITING` → overall `PARTIAL` is expected.

### Live (operator approval required)

1. Stop the web profile Gateway first (one Client per bot token), **or** call `runCapabilitySmoke` in-process on the running seat.
2. Run:

```bash
DSH_HOME=/home/mestryx/dsh-lab/runtime/dsh-home \
node scripts/discord-v1-capability-smoke.mjs --mode=live --confirm-lab \
  --account=vega \
  --channel=1547367510590885888 \
  --guild=1497013361655939226 \
  --await-ms=300000
```

`--confirm-lab` is mandatory. Without it the script exits with code 2.

## Safety gate

Harness refuses to run when the account has:

- `allowAllGuilds` / `allowAllChannels` / `allowAllUsers`
- `dm.enabled === true`
- `ignoreBots === false`
- guild/channel not already on the allowlist (will **not** broaden scope)

Deletes only bot-owned disposable smoke messages (`requireBotOwned: true`).

## Operator actions (live interactive phase)

After the automatic phase posts the master status + interaction surface:

1. Click **Test Button**
2. Choose select value (`alpha` | `beta` | `gamma`)
3. Send `DSH_CAPABILITY_THREAD_TURN_1` in the smoke thread/channel
4. After Vega replies, send `DSH_CAPABILITY_THREAD_TURN_2`

Full thread/session reuse proof needs the running web AgentLoop. Standalone live script may leave those keys `WAITING` → overall `PARTIAL`.

## Skipped / deferred (do not reduce V1 %)

See final summary board and `deferredCapabilityResults()`:

- DM live, raw REST, admin/moderation, modals/commands/webhooks, archive REST, advanced Components V2, voice/stage
- MESSAGE_UPDATE / MESSAGE_DELETE inbound: UNIT PASS / LIVE SKIP (`ignoreBots`)
- 429: DETERMINISTIC PASS / LIVE NOT INTENTIONALLY INDUCED

## Reports

JSON reports (no tokens):

- Fake: temp dir under the run
- Live: `$DSH_HOME/ledger/discord-capability-smoke/report-<runId>.json`

## Related

- Capability inventory: [`CAPABILITY-MATRIX.md`](./CAPABILITY-MATRIX.md)
- Harness source: `src/lab/capability-smoke.js`
- Unit isolation tests: `test/capability-smoke.test.js`
