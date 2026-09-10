/**
 * Capability smoke harness isolation + orchestration tests (FakeTransport).
 */

import assert from 'node:assert/strict'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDiscordProvider } from '../src/index.js'
import { FakeClock } from '../src/clock.js'
import {
  createCapabilitySmokeHarness,
  makeRunId,
  smokeOperationId,
  assertLabSafety,
  assertNoMagicProductionTrigger,
  deferredCapabilityResults,
  AUTO_CAPABILITY_KEYS,
} from '../src/lab/capability-smoke.js'

describe('capability smoke harness isolation', () => {
  it('is not imported by default Gateway message handler (no magic triggers)', () => {
    const bridgeSrc = readFileSync(new URL('../src/bridge.js', import.meta.url), 'utf8')
    assertNoMagicProductionTrigger(bridgeSrc)
    assert.equal(bridgeSrc.includes('capability-smoke'), false)
    assert.equal(bridgeSrc.includes('runCapabilitySmoke'), false)
  })

  it('index does not auto-start capability smoke on boot', () => {
    const indexSrc = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8')
    assert.equal(indexSrc.includes('DSH_DISCORD_CAPABILITY_SMOKE_ACCOUNT'), false)
    assert.match(indexSrc, /runCapabilitySmoke/)
    // Must remain explicit method — not invoked inside api.start body automatically
    const startBody = indexSrc.slice(indexSrc.indexOf('api.start ='), indexSrc.indexOf('api.stop ='))
    assert.equal(startBody.includes('runCapabilitySmoke('), false)
  })

  it('refuses unsafe accounts (allowAll / dm / ignoreBots=false)', () => {
    assert.throws(
      () =>
        assertLabSafety({
          enabled: true,
          allowAllGuilds: true,
          allowedGuilds: [],
          allowAllChannels: false,
          allowedChannels: ['c'],
          allowAllUsers: false,
          allowedUsers: ['u'],
          ignoreBots: true,
          dm: { enabled: false },
        }),
      /allowAll/,
    )
    assert.throws(
      () =>
        assertLabSafety({
          enabled: true,
          allowAllGuilds: false,
          allowedGuilds: ['g'],
          allowAllChannels: false,
          allowedChannels: ['c'],
          allowAllUsers: false,
          allowedUsers: ['u'],
          ignoreBots: true,
          dm: { enabled: true },
        }),
      /dm\.enabled/,
    )
  })

  it('deferred keys never count as V1 auto failures', () => {
    const d = deferredCapabilityResults()
    for (const [k, v] of Object.entries(d)) {
      assert.notEqual(v.status, 'FAIL', k)
    }
  })

  it('operation ids are run-scoped and stable', () => {
    const runId = 'abcd1234'
    assert.equal(smokeOperationId(runId, 'send'), 'capsmoke:abcd1234:send')
    assert.notEqual(smokeOperationId(runId, 'send'), smokeOperationId('other', 'send'))
    assert.match(makeRunId(), /^[a-f0-9]{8}$/)
  })
})

describe('capability smoke automatic phase (FakeTransport)', () => {
  /** @type {string} */
  let dir
  /** @type {any} */
  let provider

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'dsh-capsmoke-test-'))
    provider = createDiscordProvider(
      {
        clock: new FakeClock(3_000_000),
        conversationBinding: {
          resolve: () => null,
          create: async () => ({ session_id: 'discord-cap-test' }),
        },
        agents: {
          create: async () => ({
            sessionId: 'discord-cap-test',
            followup: () => {},
            session: { on: () => {}, header: {} },
          }),
        },
        createUserMessage: (t) => ({ role: 'user', content: t }),
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
          },
        },
      },
    )
    await provider.start()
    await provider.transport.startAccount('vega')
    provider.transport.seedDirectory({
      guilds: [{ id: 'g1', name: 'Lab' }],
      channels: [{ id: 'c1', name: 'lab', guildId: 'g1', type: 0 }],
      messages: [{ id: 'seed1', channelId: 'c1', authorId: 'u1', content: 'seed' }],
    })
  })

  afterEach(async () => {
    await provider.stop()
    rmSync(dir, { recursive: true, force: true })
  })

  it('runs automatic capabilities without scope mutation or user deletion', async () => {
    const accountBefore = structuredClone(provider.config.accounts.vega)
    const tools = {
      execute: async ({ name, arguments: args }) => {
        assert.equal(name, 'discord_message_send')
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
      bridge: provider.bridge,
      awaitInteractionsMs: 0,
    })
    const report = await harness.run({ runId: 'testrun01', skipInteractiveWait: true })
    assert.equal(report.scope_changed, false)
    assert.equal(report.production_default_enabled, false)
    assert.deepEqual(provider.config.accounts.vega.allowedChannels, accountBefore.allowedChannels)
    assert.equal(provider.config.accounts.vega.dm.enabled, false)

    for (const key of AUTO_CAPABILITY_KEYS) {
      if (key === 'gateway') {
        assert.equal(report.results[key].status, 'PASS', key)
        continue
      }
      assert.ok(
        ['PASS', 'SKIP'].includes(report.results[key].status),
        `${key}=${report.results[key].status} ${report.results[key].note || ''}`,
      )
    }
    // No user-message deletes: only bot-authored disposables in FakeTransport
    const deletes = provider.transport.outbound.filter((o) => o.op === 'deleteMessage')
    assert.ok(deletes.length >= 1)
    for (const d of deletes) {
      assert.equal(d.payload?.requireBotOwned, true)
    }
    assert.ok(['PASS', 'PARTIAL'].includes(report.overall))
  })

  it('failure on one step does not enable dangerous fallbacks', async () => {
    const harness = createCapabilitySmokeHarness({
      accountId: 'vega',
      channelId: 'c1',
      guildId: 'g1',
      getAccount: () => provider.config.accounts.vega,
      semantic: {
        ...provider.semantic,
        messageSend: async (input) => {
          if (String(input.content || '').includes('SEND_PASS')) {
            throw Object.assign(new Error('injected send failure'), { code: 'permission' })
          }
          return provider.semantic.messageSend(input)
        },
        messageReply: (...a) => provider.semantic.messageReply(...a),
        messageEdit: (...a) => provider.semantic.messageEdit(...a),
        messageDelete: (...a) => provider.semantic.messageDelete(...a),
        notify: (...a) => provider.semantic.notify(...a),
        guildList: (...a) => provider.semantic.guildList(...a),
        channelGet: (...a) => provider.semantic.channelGet(...a),
        channelList: (...a) => provider.semantic.channelList(...a),
        messageGet: (...a) => provider.semantic.messageGet(...a),
        messageHistory: (...a) => provider.semantic.messageHistory(...a),
        threadCreate: (...a) => provider.semantic.threadCreate(...a),
      },
      outbox: provider.outbox,
      transport: provider.transport,
      bridge: provider.bridge,
      awaitInteractionsMs: 0,
    })
    const report = await harness.run({ runId: 'failrun01', skipInteractiveWait: true })
    assert.equal(report.results.messaging_send.status, 'FAIL')
    assert.equal(provider.config.accounts.vega.allowAllChannels, false)
    assert.equal(provider.config.accounts.vega.dm.enabled, false)
    assert.equal(report.overall, 'FAIL')
  })
})
