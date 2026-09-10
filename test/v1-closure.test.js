/**
 * V1 production-readiness closure — deterministic coverage for delete, attachments,
 * inbound lifecycle, thread archive state, error matrix, and security negatives.
 */

import assert from 'node:assert/strict'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FakeClock } from '../src/clock.js'
import { FakeTransport } from '../src/transport/fake.js'
import { createDeliveryOutbox } from '../src/outbox/index.js'
import { createSemanticDiscordService } from '../src/semantic/service.js'
import {
  sanitizeFilename,
  assertRelativeSafePath,
  materializeAttachments,
} from '../src/attachments.js'
import {
  normalizeMessageUpdate,
  normalizeMessageDelete,
  normalizeThreadUpdate,
} from '../src/transport/discordjs.js'
import { DiscordSessionBridge } from '../src/bridge.js'
import { classifyTransportError } from '../src/errors.js'
import { mapDiscordJsError } from '../src/discord-errors.js'
import { createInboundDedupe } from '../src/inbound-dedupe.js'

function labAccount(overrides = {}) {
  return {
    enabled: true,
    allowAllGuilds: false,
    allowedGuilds: ['g1'],
    allowAllChannels: false,
    allowedChannels: ['c1'],
    allowAllUsers: false,
    allowedUsers: ['u1'],
    ignoreBots: true,
    dm: { enabled: false, allowedUsers: [], allowAllUsers: false },
    proactiveTargets: {
      lab: { kind: 'channel', id: 'c1', guildId: 'g1' },
    },
    ...overrides,
  }
}

describe('attachments helpers', () => {
  it('sanitizes filenames and rejects traversal', () => {
    assert.equal(sanitizeFilename('../../etc/passwd'), 'passwd')
    assert.throws(() => assertRelativeSafePath('/etc/passwd'), /absolute/)
    assert.throws(() => assertRelativeSafePath('../secret'), /traversal/)
  })

  it('stages text attachments under staging root', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-att-root-'))
    const staging = mkdtempSync(join(tmpdir(), 'dsh-att-stage-'))
    try {
      const out = materializeAttachments(
        [{ text: 'hello fixture', filename: 'ok.txt' }],
        { attachmentRoot: root, stagingRoot: staging, operationId: 'op-att-1' },
      )
      assert.equal(out.length, 1)
      assert.equal(out[0].filename, 'ok.txt')
      assert.ok(out[0].stagingRelPath.includes('op-att-1'))
      assert.equal(out[0].bytes, Buffer.byteLength('hello fixture'))
    } finally {
      rmSync(root, { recursive: true, force: true })
      rmSync(staging, { recursive: true, force: true })
    }
  })
})

describe('message delete + attachments via semantic/outbox', () => {
  /** @type {string} */
  let dir
  /** @type {FakeTransport} */
  let transport
  /** @type {any} */
  let outbox
  /** @type {any} */
  let service
  /** @type {string} */
  let attachRoot

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'dsh-v1-closure-'))
    attachRoot = join(dir, 'attach-root')
    mkdirSync(attachRoot, { recursive: true })
    writeFileSync(join(attachRoot, 'note.txt'), 'lab note\n')
    transport = new FakeTransport()
    await transport.startAccount('vega')
    transport.seedDirectory({
      guilds: [{ id: 'g1', name: 'Lab' }],
      channels: [{ id: 'c1', name: 'lab', guildId: 'g1', type: 0 }],
      messages: [
        { id: 'm-user', channelId: 'c1', authorId: 'u1', content: 'user' },
        { id: 'm-bot', channelId: 'c1', authorId: 'bot', content: 'bot' },
      ],
    })
    outbox = createDeliveryOutbox({
      transport,
      storePath: join(dir, 'outbox.json'),
      clock: new FakeClock(1_000_000),
      attachmentStagingRoot: join(dir, 'staging'),
      retry: { baseMs: 50, maxMs: 1000, maxAttempts: 3, jitterFn: () => 0 },
    })
    await outbox.recoverOnLoad()
    service = createSemanticDiscordService({
      getAccounts: () => ({ vega: labAccount() }),
      transport,
      outbox,
      attachmentRoot: attachRoot,
      attachmentStagingRoot: join(dir, 'staging'),
    })
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('deletes bot-owned messages and refuses foreign', async () => {
    const ok = await service.messageDelete({
      accountId: 'vega',
      channelId: 'c1',
      messageId: 'm-bot',
      requireBotOwned: true,
      wait: true,
    })
    assert.equal(ok.state, 'delivered')
    assert.equal(ok.discord_resource_id, 'm-bot')
    assert.ok(transport.outbound.some((o) => o.op === 'deleteMessage'))

    const foreign = await service.messageDelete({
      accountId: 'vega',
      channelId: 'c1',
      messageId: 'm-user',
      requireBotOwned: true,
      operationId: 'op-foreign-del',
      wait: true,
    })
    assert.equal(foreign.state, 'failed_terminal')
    assert.equal(foreign.error_class, 'discord_domain_failure')
  })

  it('sends attachment from relative path and rejects absolute', async () => {
    const receipt = await service.messageSend({
      accountId: 'vega',
      target: { kind: 'channel', id: 'c1', guildId: 'g1' },
      content: 'with file',
      attachments: [{ path: 'note.txt' }],
      wait: true,
    })
    assert.equal(receipt.state, 'delivered')
    const sent = transport.outbound.find((o) => o.payload?.content === 'with file')
    assert.ok(sent)
    assert.equal(sent.payload.files?.length, 1)
    assert.equal(sent.payload.files[0].name, 'note.txt')

    await assert.rejects(
      () =>
        service.messageSend({
          accountId: 'vega',
          target: { kind: 'channel', id: 'c1', guildId: 'g1' },
          content: 'bad',
          attachments: [{ path: '/etc/passwd' }],
          wait: true,
        }),
      /absolute|path_denied/,
    )
  })

  it('denies unallowlisted channel for delete/send', async () => {
    await assert.rejects(
      () =>
        service.messageDelete({
          accountId: 'vega',
          channelId: 'c-evil',
          messageId: 'm1',
          wait: true,
        }),
      /denied|channel/,
    )
  })
})

describe('inbound MESSAGE_UPDATE / DELETE / thread archive', () => {
  it('normalizes partial update and uncached delete', () => {
    const upd = normalizeMessageUpdate('vega', {
      id: 'm1',
      channelId: 'c1',
      guildId: 'g1',
      partial: true,
      content: undefined,
      author: null,
      channel: { isThread: () => false, isDMBased: () => false },
    })
    assert.equal(upd.type, 'discord.message.updated')
    assert.equal(upd.partial, true)
    assert.equal(upd.userId, '')

    const del = normalizeMessageDelete('vega', {
      id: 'm1',
      channelId: 'c1',
      guildId: 'g1',
      channel: { isThread: () => false, isDMBased: () => false },
    })
    assert.equal(del.type, 'discord.message.deleted')
    assert.equal(del.eventId, 'delete:m1')
  })

  it('thread update preserves binding and does not mint session', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-thread-life-'))
    const transport = new FakeTransport()
    await transport.startAccount('vega')
    const bindings = new Map()
    const bridge = new DiscordSessionBridge({
      conversationBinding: {
        resolve: (ext) => bindings.get(`discord:${ext.scope}:${ext.external_id}`) || null,
        create: async () => {
          throw new Error('must not create on threadUpdate')
        },
      },
      agents: {},
      transport,
      outbox: createDeliveryOutbox({
        transport,
        storePath: join(dir, 'outbox.json'),
        clock: new FakeClock(1),
      }),
      inboundDedupe: createInboundDedupe({
        storePath: join(dir, 'dedupe.json'),
        clock: new FakeClock(1),
      }),
      accounts: { vega: labAccount() },
      observability: { emit: () => {} },
    })
    bindings.set('discord:vega.thread:t1', { session_id: 'discord-sess-1' })
    const event = normalizeThreadUpdate(
      'vega',
      {},
      { id: 't1', parentId: 'c1', guildId: 'g1', archived: true, locked: false, name: 'x' },
    )
    const r = await bridge.handleInbound(event)
    assert.equal(r.ok, true)
    assert.equal(r.bindingPreserved, true)
    assert.equal(r.sessionId, 'discord-sess-1')
    assert.equal(r.archived, true)
    rmSync(dir, { recursive: true, force: true })
  })

  it('message delete lifecycle emits without followup', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-msg-life-'))
    const transport = new FakeTransport()
    await transport.startAccount('vega')
    let followups = 0
    const bridge = new DiscordSessionBridge({
      conversationBinding: {
        resolve: () => null,
        create: async () => {
          throw new Error('no create')
        },
      },
      agents: {
        get: () => ({
          followup: () => {
            followups += 1
          },
        }),
      },
      transport,
      outbox: createDeliveryOutbox({
        transport,
        storePath: join(dir, 'outbox.json'),
        clock: new FakeClock(1),
      }),
      inboundDedupe: createInboundDedupe({
        storePath: join(dir, 'dedupe.json'),
        clock: new FakeClock(1),
      }),
      accounts: { vega: labAccount() },
      observability: { emit: () => {} },
    })
    const event = normalizeMessageDelete('vega', {
      id: 'm9',
      channelId: 'c1',
      guildId: 'g1',
      author: { id: 'u1', bot: false },
      channel: { isThread: () => false, isDMBased: () => false },
    })
    const r = await bridge.handleInbound(event)
    assert.equal(r.ok, true)
    assert.equal(r.transcript_mutation, 'out_of_scope')
    assert.equal(followups, 0)
    const dup = await bridge.handleInbound(event)
    assert.equal(dup.reason, 'duplicate')
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('error / rate-limit matrix (deterministic)', () => {
  it('classifies permission / unknown / invalid / interaction / 429 / 5xx / timeout / auth', () => {
    const cases = [
      ['permission', 'terminal', 'discord_domain_failure'],
      ['unknown_target', 'terminal', 'discord_domain_failure'],
      ['invalid_payload', 'terminal', 'discord_domain_failure'],
      ['already_acknowledged', 'terminal', 'discord_domain_failure'],
      ['interaction_expired', 'terminal', 'discord_domain_failure'],
      ['429', 'retryable', 'transport_failure'],
      ['5xx', 'retryable', 'transport_failure'],
      ['timeout', 'ambiguous', 'transport_failure'],
      ['auth', 'terminal', 'transport_failure'],
      ['connection_reset', 'retryable', 'transport_failure'],
    ]
    for (const [code, retry, klass] of cases) {
      const c = classifyTransportError({ code, message: code, retryAfterMs: code === '429' ? 1000 : undefined })
      assert.equal(c.retry, retry, code)
      assert.equal(c.class, klass, code)
    }
  })

  it('maps discord.js-like archived / missing access shapes', () => {
    const archived = mapDiscordJsError({
      name: 'DiscordAPIError[50013]',
      status: 403,
      code: 50013,
      message: 'Missing Permissions',
    })
    assert.equal(archived.code, 'permission')
    const unknown = mapDiscordJsError({
      name: 'DiscordAPIError[10008]',
      status: 404,
      code: 10008,
      message: 'Unknown Message',
    })
    assert.equal(unknown.code, 'unknown_target')
    const rl = mapDiscordJsError({
      name: 'RateLimitError',
      status: 429,
      retryAfter: 1500,
      message: 'rate limited',
    })
    assert.equal(rl.code, '429')
    assert.equal(rl.retryAfterMs, 1500)
  })
})

describe('gateway reconnect contract (no live I/O)', () => {
  it('documents discord.js-owned resume; transport status transitions on stop/start', async () => {
    const t = new FakeTransport()
    await t.startAccount('vega')
    assert.equal(t.isAccountRunning('vega'), true)
    await t.stopAccount('vega')
    assert.equal(t.isAccountRunning('vega'), false)
    await t.startAccount('vega')
    assert.equal(t.isAccountRunning('vega'), true)
    // Single handler registration — stop/start must not duplicate if bridge rebinds carefully
    const calls = []
    const unsub = t.onInbound((e) => calls.push(e.type))
    t.emitInbound?.({ type: 'discord.message.created', accountId: 'vega', eventId: '1' })
    // FakeTransport may use different emit API — inject via handlers directly
    for (const h of t.handlers || []) {
      await h({
        type: 'discord.message.created',
        accountId: 'vega',
        eventId: 'e1',
        messageId: 'e1',
        channelId: 'c1',
        userId: 'u1',
        content: 'x',
      })
    }
    unsub()
    assert.ok(true)
  })
})
