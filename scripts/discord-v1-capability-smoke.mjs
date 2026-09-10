#!/usr/bin/env node
/**
 * Discord V1 Full Capability Smoke — LAB/dev entrypoint.
 *
 * NEVER auto-runs on plugin boot. Requires explicit CLI flags.
 *
 * Fake (CI / local):
 *   node scripts/discord-v1-capability-smoke.mjs --mode=fake
 *
 * Live (after operator approval):
 *   DSH_HOME=~/dsh-lab/runtime/dsh-home \
 *   node scripts/discord-v1-capability-smoke.mjs --mode=live --confirm-lab \
 *     --account=vega \
 *     --channel=1547367510590885888 \
 *     --guild=1497013361655939226 \
 *     --await-ms=300000
 *
 * Live note: stop the web profile Gateway first (one Client per bot token),
 * or invoke provider.runCapabilitySmoke from an already-running Cordis seat.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDiscordProvider } from '../src/index.js'
import { FakeClock } from '../src/clock.js'
import {
  createCapabilitySmokeHarness,
  writeSmokeReport,
  makeRunId,
} from '../src/lab/capability-smoke.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

function usage() {
  console.log(`Usage:
  node scripts/discord-v1-capability-smoke.mjs --mode=fake
  node scripts/discord-v1-capability-smoke.mjs --mode=live --confirm-lab --account=vega --channel=<id> --guild=<id>
`)
}

function parseArgs(argv) {
  /** @type {Record<string, string|boolean>} */
  const out = { mode: 'fake', confirmLab: false, awaitMs: '0' }
  for (const a of argv) {
    if (a === '--help' || a === '-h') out.help = true
    else if (a === '--confirm-lab') out.confirmLab = true
    else if (a.startsWith('--mode=')) out.mode = a.slice(7)
    else if (a.startsWith('--account=')) out.account = a.slice(10)
    else if (a.startsWith('--channel=')) out.channel = a.slice(10)
    else if (a.startsWith('--guild=')) out.guild = a.slice(8)
    else if (a.startsWith('--await-ms=')) out.awaitMs = a.slice(11)
    else if (a.startsWith('--run-id=')) out.runId = a.slice(9)
  }
  return out
}

async function runFake() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-capsmoke-'))
  const transportFailures = []
  const provider = createDiscordProvider(
    {
      transport: undefined, // FakeTransport default when transport!==discordjs
      clock: new FakeClock(2_000_000),
      conversationBinding: {
        resolve: () => null,
        create: async () => ({ session_id: 'discord-fake-session' }),
      },
      agents: {
        create: async () => ({
          sessionId: 'discord-fake-session',
          followup: () => {},
          session: { on: () => {}, header: { cwd: dir } },
        }),
      },
      createUserMessage: (text) => ({ role: 'user', content: text }),
      logger: console,
    },
    {
      transport: 'fake',
      allowConnect: false,
      outboxPath: join(dir, 'outbox.json'),
      inboundDedupePath: join(dir, 'dedupe.json'),
      accountsConfigPath: join(dir, 'accounts.json'),
      accounts: {
        vega: {
          enabled: true,
          allowAllGuilds: false,
          allowedGuilds: ['g1'],
          allowAllChannels: false,
          allowedChannels: ['c1'],
          allowAllUsers: false,
          allowedUsers: ['u1'],
          ignoreBots: true,
          dm: { enabled: false, allowedUsers: [], allowAllUsers: false },
          conversationMode: 'channel',
          agentPreset: 'vega',
        },
      },
    },
  )

  await provider.start()
  await provider.transport.startAccount('vega')
  provider.transport.seedDirectory({
    guilds: [{ id: 'g1', name: 'Lab' }],
    channels: [{ id: 'c1', name: 'lab', guildId: 'g1', type: 0 }],
    messages: [{ id: 'm0', channelId: 'c1', authorId: 'u1', content: 'hi' }],
  })

  // Minimal tools facade → semantic (proves wrapper path without Cordis)
  const tools = {
    get: (name) => (name === 'discord_message_send' ? {} : null),
    execute: async ({ name, arguments: args }) => {
      if (name !== 'discord_message_send') return { isError: true, error: 'unknown' }
      const receipt = await provider.semantic.messageSend({
        accountId: args.account_id,
        target: args.target,
        content: args.content,
        operationId: args.operation_id,
        wait: true,
      })
      return { content: [{ type: 'text', text: JSON.stringify(receipt) }] }
    },
  }

  const harness = createCapabilitySmokeHarness({
    accountId: 'vega',
    channelId: 'c1',
    guildId: 'g1',
    getAccount: () => provider.config.accounts.vega,
    semantic: provider.semantic,
    outbox: provider.outbox,
    transport: provider.transport,
    tools,
    policy: {
      evaluate: () => ({ decision: 'AUTO', risk: 'L2', action: 'discord.message.send' }),
    },
    conversationBinding: provider.bridge?.conversationBinding,
    bridge: provider.bridge,
    awaitInteractionsMs: 0,
    logger: console,
  })

  const report = await harness.run({
    runId: makeRunId(),
    skipInteractiveWait: true,
  })
  // Fake cannot complete live interactions — expected WAITING → overall PARTIAL is OK for fake auto
  const path = writeSmokeReport(report, join(dir, 'report'))
  console.log(JSON.stringify({ ok: true, mode: 'fake', overall: report.overall, reportPath: path, runId: report.runId }, null, 2))

  await provider.stop()
  rmSync(dir, { recursive: true, force: true })
  // Auto-capable failures are real failures; WAITING interactive is expected in fake mode.
  const autoFail = Object.entries(report.results).some(
    ([k, v]) =>
      v.status === 'FAIL' &&
      !['button_interaction', 'select_interaction', 'interaction_ack', 'thread_reuse', 'session_reuse', 'per_turn_delivery'].includes(k),
  )
  process.exitCode = autoFail ? 1 : 0
}

async function runLive(args) {
  if (!args.confirmLab) {
    console.error('Refusing live smoke without --confirm-lab')
    process.exitCode = 2
    return
  }
  const accountId = String(args.account || 'vega')
  const channelId = String(args.channel || '')
  const guildId = String(args.guild || '')
  if (!channelId || !guildId) {
    console.error('--channel and --guild required for live mode')
    process.exitCode = 2
    return
  }

  const dshHome = process.env.DSH_HOME || join(process.env.HOME || '', 'dsh-lab/runtime/dsh-home')
  const ledgerPath = join(dshHome, 'ledger/discord-accounts.json')
  const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'))
  const account = ledger.accounts?.[accountId]
  if (!account) {
    console.error(`account ${accountId} not in ledger`)
    process.exitCode = 2
    return
  }

  // Resolve bot token via secrets CLI if available
  const secretName = account.credentials || `DISCORD_${accountId.toUpperCase()}_BOT_TOKEN`
  let token = process.env.DISCORD_LAB_BOT_TOKEN || ''
  if (!token) {
    try {
      const { execFileSync } = await import('node:child_process')
      token = String(execFileSync('piblox-secrets', ['get', secretName], { encoding: 'utf8' })).trim()
    } catch {
      console.error(`Unable to resolve ${secretName}. Set DISCORD_LAB_BOT_TOKEN or install piblox-secrets.`)
      process.exitCode = 2
      return
    }
  }

  const dir = mkdtempSync(join(tmpdir(), 'dsh-capsmoke-live-'))
  const provider = createDiscordProvider(
    {
      secrets: {
        resolve: (ref) => ({ ok: ref === secretName || String(ref).includes(secretName), value: token }),
        hasKey: (ref) => ref === secretName || String(ref).includes(secretName),
      },
      conversationBinding: {
        resolve: () => null,
        create: async () => ({ session_id: `discord-capsmoke-${Date.now()}` }),
      },
      agents: {
        create: async ({ sessionId }) => ({
          sessionId,
          followup: () => {},
          session: { on: () => {}, header: {} },
        }),
      },
      createUserMessage: (text) => ({ role: 'user', content: text }),
      logger: console,
    },
    {
      transport: 'discordjs',
      allowConnect: true,
      outboxPath: join(dir, 'outbox.json'),
      inboundDedupePath: join(dir, 'dedupe.json'),
      accountsConfigPath: join(dir, 'accounts-unused.json'),
      accounts: {
        [accountId]: {
          ...account,
          credentials: secretName,
        },
      },
    },
  )

  console.info('capability-smoke: starting live Gateway (ensure web profile is stopped)')
  await provider.start()
  // start() already starts enabled accounts when allowConnect

  const tools = {
    get: (name) => (name === 'discord_message_send' ? {} : null),
    execute: async ({ name, arguments: args }) => {
      if (name !== 'discord_message_send') return { isError: true }
      const receipt = await provider.semantic.messageSend({
        accountId: args.account_id,
        target: args.target,
        content: args.content,
        operationId: args.operation_id,
        wait: true,
      })
      return { content: [{ type: 'text', text: JSON.stringify(receipt) }] }
    },
  }

  const harness = createCapabilitySmokeHarness({
    accountId,
    channelId,
    guildId,
    getAccount: () => provider.config.accounts[accountId],
    semantic: provider.semantic,
    outbox: provider.outbox,
    transport: provider.transport,
    tools,
    policy: {
      evaluate: () => ({ decision: 'AUTO', risk: 'L2', action: 'discord.message.send' }),
    },
    bridge: provider.bridge,
    awaitInteractionsMs: Number(args.awaitMs) || 0,
    pollIntervalMs: 2000,
    logger: console,
  })

  const report = await harness.run({
    runId: args.runId ? String(args.runId) : makeRunId(),
    skipInteractiveWait: Number(args.awaitMs) <= 0,
  })
  const path = writeSmokeReport(report, join(dshHome, 'ledger/discord-capability-smoke'))
  console.log(JSON.stringify({ ok: true, mode: 'live', overall: report.overall, reportPath: path, runId: report.runId }, null, 2))

  // Keep process alive if awaiting interactions was requested and still WAITING
  if (Number(args.awaitMs) > 0) {
    console.info('capability-smoke: interactive wait finished; stopping transport')
  }
  await provider.stop()
  // Do not delete report dir under DSH_HOME
  rmSync(dir, { recursive: true, force: true })
  process.exitCode = report.overall === 'FAIL' ? 1 : 0
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    usage()
    return
  }
  if (args.mode === 'fake') return runFake()
  if (args.mode === 'live') return runLive(args)
  console.error(`unknown mode: ${args.mode}`)
  usage()
  process.exitCode = 2
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
