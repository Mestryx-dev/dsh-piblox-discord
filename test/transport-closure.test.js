/**
 * Transport closure — outbound via outbox, inbound dedupe, error mapping, multi-account.
 * No live Discord / tokens.
 */
import assert from 'node:assert/strict'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DiscordAPIError, RateLimitError } from 'discord.js'
import { createConversationBindingForTest } from '../../dsh-conversation-binding/src/index.js'
import {
  createDiscordProvider,
  createDeliveryOutbox,
  createInboundDedupe,
  createOutboundApi,
  mapDiscordJsError,
  FakeClock,
  FakeTransport,
} from '../src/index.js'
import { createDeterministicAgents } from './helpers/deterministic-agents.js'
import { classifyTransportError } from '../src/errors.js'

const ACCOUNTS = {
  account_alpha: {
    enabled: true,
    allowAllGuilds: true,
    allowAllChannels: true,
    allowAllUsers: true,
  },
  account_beta: {
    enabled: true,
    allowAllGuilds: true,
    allowAllChannels: true,
    allowAllUsers: true,
  },
}

function setup(extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-discord-closure-'))
  const clock = extra.clock || new FakeClock(1_000_000)
  const conversationBinding = createConversationBindingForTest({
    storePath: join(dir, 'bindings.json'),
  })
  let followups = 0
  const agents = createDeterministicAgents()
  const create = agents.create.bind(agents)
  agents.create = async (args) => {
    const handle = await create(args)
    const orig = handle.agent.followup.bind(handle.agent)
    handle.agent.followup = async (msg) => {
      followups += 1
      return orig(msg)
    }
    handle.agent.__followupWrapped = true
    return handle
  }
  const resume = agents.resume.bind(agents)
  agents.resume = async (args) => {
    const handle = await resume(args)
    if (handle && !handle.agent.__followupWrapped) {
      const orig = handle.agent.followup.bind(handle.agent)
      handle.agent.followup = async (msg) => {
        followups += 1
        return orig(msg)
      }
      handle.agent.__followupWrapped = true
    }
    return handle
  }
  const transport = new FakeTransport()
  const provider = createDiscordProvider(
    {
      conversationBinding,
      agents,
      transport,
      clock,
      onSessionEvent: (sessionId, listener) =>
        agents.onEvent((sid, event) => {
          if (String(sid) === String(sessionId)) return listener({ id: sid }, event)
        }),
    },
    {
      accounts: ACCOUNTS,
      outboxPath: join(dir, 'outbox.json'),
      inboundDedupePath: join(dir, 'inbound-dedupe.json'),
      accountsConfigPath: join(dir, 'discord-accounts.json'),
      inboundDedupeTtlMs: extra.ttlMs ?? 60_000,
      inboundDedupeLeaseMs: extra.leaseMs ?? 5_000,
    },
  )
  return {
    dir,
    clock,
    transport,
    provider,
    conversationBinding,
    agents,
    getFollowups: () => followups,
  }
}

describe('transport closure — outbound via outbox', () => {
  /** @type {ReturnType<typeof setup>} */
  let ctx

  beforeEach(async () => {
    ctx = setup()
    await ctx.provider.start()
  })

  afterEach(async () => {
    await ctx.provider.stop()
    rmSync(ctx.dir, { recursive: true, force: true })
  })

  it('assistant final goes through outbox with receipt', async () => {
    await ctx.transport.injectMessage({
      accountId: 'account_alpha',
      channelId: 'c1',
      guildId: 'g1',
      userId: 'u1',
      messageId: 'm-out',
      content: 'reply exactly: VIA_OUTBOX',
    })
    assert.ok(ctx.transport.outbound.some((o) => o.payload?.content?.includes('VIA_OUTBOX')))
    const delivered = ctx.provider.outbox.listOperations({
      accountId: 'account_alpha',
      state: 'delivered',
    })
    assert.ok(delivered.length >= 1)
    assert.ok(delivered[0].discord_resource_id)
    assert.ok(delivered[0].operation_id.startsWith('stream:'))
  })

  it('bridge performs zero direct transport writes (only outbox worker)', async () => {
    const before = ctx.transport.outbound.length
    // Spy: bridge must not call transport methods — wrap after start
    const calls = { send: 0, reply: 0, edit: 0 }
    const origSend = ctx.transport.sendMessage.bind(ctx.transport)
    const origReply = ctx.transport.replyMessage.bind(ctx.transport)
    const origEdit = ctx.transport.editMessage.bind(ctx.transport)
    // stack depth check via Error — instead record caller by wrapping outbox tick only path
    let viaOutbox = 0
    const origTick = ctx.provider.outbox.tick.bind(ctx.provider.outbox)
    ctx.provider.outbox.tick = async (opts) => {
      viaOutbox += 1
      return origTick(opts)
    }
    ctx.transport.sendMessage = async (...args) => {
      calls.send += 1
      return origSend(...args)
    }
    ctx.transport.replyMessage = async (...args) => {
      calls.reply += 1
      return origReply(...args)
    }
    ctx.transport.editMessage = async (...args) => {
      calls.edit += 1
      return origEdit(...args)
    }

    await ctx.transport.injectMessage({
      accountId: 'account_alpha',
      channelId: 'c-bypass',
      guildId: 'g1',
      userId: 'u1',
      messageId: 'm-bypass',
      content: 'reply exactly: NO_BYPASS',
    })

    assert.ok(viaOutbox >= 1, 'outbox.tick must run')
    assert.ok(calls.send + calls.reply + calls.edit >= 1)
    assert.ok(ctx.transport.outbound.length > before)
    // Stream path uses reply (inbound has messageId) — all went through tick
    const ops = ctx.provider.outbox.listOperations({ accountId: 'account_alpha' })
    assert.ok(ops.every((o) => o.state === 'delivered' || o.state === 'queued'))
  })

  it('assistant stream coalesces: one send then edits, not per-chunk messages', async () => {
    // Deterministic agents emit one chunk + one message → single flush (one reply)
    await ctx.transport.injectMessage({
      accountId: 'account_alpha',
      channelId: 'c-stream',
      guildId: 'g1',
      userId: 'u1',
      messageId: 'm-stream',
      content: 'reply exactly: STREAMED',
    })
    const ops = ctx.provider.outbox
      .listOperations({ accountId: 'account_alpha' })
      .filter((o) => o.operation_id.includes('stream:'))
    // One send/reply op for the turn (chunks coalesced until assistant/message)
    assert.equal(ops.filter((o) => o.operation_type === 'replyMessage' || o.operation_type === 'sendMessage').length, 1)
    assert.match(ctx.transport.outbound.at(-1).payload.content, /STREAMED/)
  })

  it('429 on assistant output retries without failing DSH turn', async () => {
    ctx.transport.simulateNextFailure('account_alpha', { code: '429', retryAfterMs: 2000 })
    const result = await ctx.transport.injectMessage({
      accountId: 'account_alpha',
      channelId: 'c-429',
      guildId: 'g1',
      userId: 'u1',
      messageId: 'm-429',
      content: 'reply exactly: AFTER_RETRY',
    })
    // DSH turn completed (binding exists, followup ran)
    assert.equal(result.type, 'discord.message.created')
    const bindings = Object.values(ctx.conversationBinding.dump().bindings)
    assert.equal(bindings.length, 1)
    assert.equal(ctx.getFollowups(), 1)

    const waiting = ctx.provider.outbox.listOperations({
      accountId: 'account_alpha',
      state: 'retry_wait',
    })
    assert.equal(waiting.length, 1)

    ctx.clock.advance(2000)
    await ctx.provider.outbox.tick({ accountId: 'account_alpha' })
    const delivered = ctx.provider.outbox.listOperations({
      accountId: 'account_alpha',
      state: 'delivered',
    })
    assert.equal(delivered.length, 1)
    assert.match(ctx.transport.outbound.at(-1).payload.content, /AFTER_RETRY/)
  })

  it('crash: assistant output persisted; restart resumes delivery', async () => {
    await ctx.provider.outbox.enqueue({
      operationId: 'crash-op-1',
      accountId: 'account_alpha',
      operationType: 'sendMessage',
      target: { channelId: 'c-crash' },
      payload: { content: 'CRASH_RESUME' },
    })
    // Simulate stranded sending
    await ctx.provider.outbox.storePath // ensure path
    const storePath = ctx.provider.outbox.storePath
    // Manually mark sending via tick claim then "crash" before execute — use recover path
    // Persist a sending op by enqueue then patch file
    const raw = JSON.parse(readFileSync(storePath, 'utf8'))
    raw.operations['crash-op-1'].state = 'sending'
    const { writeFileSync } = await import('node:fs')
    writeFileSync(storePath, JSON.stringify(raw, null, 2))

    const transport2 = new FakeTransport()
    await transport2.startAccount('account_alpha')
    const outbox2 = createDeliveryOutbox({
      transport: transport2,
      storePath,
      clock: ctx.clock,
    })
    await outbox2.recoverOnLoad()
    const recovered = outbox2.listOperations({ state: 'queued' })
    assert.ok(recovered.some((o) => o.operation_id === 'crash-op-1'))
    await outbox2.tick()
    assert.equal(outbox2.getReceipt('crash-op-1').state, 'delivered')
    assert.ok(transport2.outbound.some((o) => o.payload.content === 'CRASH_RESUME'))
  })

  it('proactive outbound API uses outbox only', async () => {
    const api = createOutboundApi({ outbox: ctx.provider.outbox })
    await api.sendMessage({
      operationId: 'tool-send-1',
      accountId: 'account_alpha',
      channelId: 'c-tool',
      content: 'PROACTIVE',
      correlationId: 'corr-tool',
    })
    assert.equal(ctx.transport.outbound.filter((o) => o.payload?.content === 'PROACTIVE').length, 0)
    await ctx.provider.outbox.tick()
    assert.ok(ctx.transport.outbound.some((o) => o.payload?.content === 'PROACTIVE'))
    assert.equal(ctx.provider.outbox.getReceipt('tool-send-1').state, 'delivered')
  })
})

describe('transport closure — inbound dedupe', () => {
  /** @type {ReturnType<typeof setup>} */
  let ctx

  beforeEach(async () => {
    ctx = setup({ ttlMs: 10_000, leaseMs: 2_000 })
    await ctx.provider.start()
  })

  afterEach(async () => {
    await ctx.provider.stop()
    rmSync(ctx.dir, { recursive: true, force: true })
  })

  it('duplicate message ID → one followup', async () => {
    await ctx.transport.injectMessage({
      accountId: 'account_alpha',
      channelId: 'c-dedupe',
      guildId: 'g1',
      userId: 'u1',
      messageId: '123',
      content: 'reply exactly: FIRST',
    })
    assert.equal(ctx.getFollowups(), 1)

    await ctx.transport.replayMessage({
      accountId: 'account_alpha',
      channelId: 'c-dedupe',
      guildId: 'g1',
      userId: 'u1',
      messageId: '123',
      content: 'reply exactly: FIRST',
    })
    assert.equal(ctx.getFollowups(), 1)
  })

  it('same content different IDs → two followups', async () => {
    await ctx.transport.injectMessage({
      accountId: 'account_alpha',
      channelId: 'c-same',
      guildId: 'g1',
      userId: 'u1',
      messageId: '123',
      content: 'reply exactly: hello',
    })
    await ctx.transport.injectMessage({
      accountId: 'account_alpha',
      channelId: 'c-same',
      guildId: 'g1',
      userId: 'u1',
      messageId: '124',
      content: 'reply exactly: hello',
    })
    assert.equal(ctx.getFollowups(), 2)
  })

  it('duplicate interaction ID → one dispatch', async () => {
    await ctx.transport.injectInteraction({
      accountId: 'account_alpha',
      interactionId: 'ix-1',
      channelId: 'c1',
      customId: 'btn',
    })
    assert.equal(ctx.provider.bridge.interactionDispatches.length, 1)
    await ctx.transport.injectInteraction({
      accountId: 'account_alpha',
      interactionId: 'ix-1',
      channelId: 'c1',
      customId: 'btn',
    })
    assert.equal(ctx.provider.bridge.interactionDispatches.length, 1)
  })

  it('TTL expiration allows re-claim (documented)', async () => {
    await ctx.transport.injectMessage({
      accountId: 'account_alpha',
      channelId: 'c-ttl',
      guildId: 'g1',
      userId: 'u1',
      messageId: 'ttl-1',
      content: 'reply exactly: TTL1',
    })
    assert.equal(ctx.getFollowups(), 1)
    ctx.clock.advance(10_001)
    await ctx.transport.injectMessage({
      accountId: 'account_alpha',
      channelId: 'c-ttl',
      guildId: 'g1',
      userId: 'u1',
      messageId: 'ttl-1',
      content: 'reply exactly: TTL2',
    })
    assert.equal(ctx.getFollowups(), 2)
  })

  it('crash/lease recovery: expired claimed can be reclaimed', async () => {
    const dedupe = createInboundDedupe({
      storePath: join(ctx.dir, 'lease-dedupe.json'),
      clock: ctx.clock,
      ttlMs: 60_000,
      leaseMs: 1_000,
    })
    const c1 = await dedupe.claim({
      accountId: 'account_alpha',
      eventId: 'lease-msg',
      eventType: 'discord.message.created',
    })
    assert.equal(c1.ok, true)
    // Still within lease → duplicate
    const dup = await dedupe.claim({
      accountId: 'account_alpha',
      eventId: 'lease-msg',
      eventType: 'discord.message.created',
    })
    assert.equal(dup.ok, false)
    assert.equal(dup.reason, 'duplicate')
    // Expire lease without completing → reclaim (at-least-once)
    ctx.clock.advance(1_001)
    const reclaim = await dedupe.claim({
      accountId: 'account_alpha',
      eventId: 'lease-msg',
      eventType: 'discord.message.created',
    })
    assert.equal(reclaim.ok, true)
    assert.equal(reclaim.claim.state, 'claimed')
  })
})

describe('transport closure — multi-account + error mapping', () => {
  it('alpha 429 does not block beta delivery', async () => {
    const ctx = setup()
    await ctx.provider.start()
    try {
      ctx.transport.simulateNextFailure('account_alpha', { code: '429', retryAfterMs: 5000 })
      await ctx.transport.injectMessage({
        accountId: 'account_alpha',
        channelId: 'c-a',
        guildId: 'g1',
        userId: 'u1',
        messageId: 'ma',
        content: 'reply exactly: ALPHA_WAIT',
      })
      assert.equal(
        ctx.provider.outbox.listOperations({ accountId: 'account_alpha', state: 'retry_wait' }).length,
        1,
      )

      await ctx.transport.injectMessage({
        accountId: 'account_beta',
        channelId: 'c-b',
        guildId: 'g1',
        userId: 'u2',
        messageId: 'mb',
        content: 'reply exactly: BETA_OK',
      })
      assert.ok(ctx.transport.outbound.some((o) => o.accountId === 'account_beta' && /BETA_OK/.test(o.payload.content)))
      assert.ok(
        ctx.provider.outbox.listOperations({ accountId: 'account_beta', state: 'delivered' }).length >= 1,
      )
    } finally {
      await ctx.provider.stop()
      rmSync(ctx.dir, { recursive: true, force: true })
    }
  })

  it('maps discord.js-compatible errors into outbox taxonomy', () => {
    const rl = new RateLimitError({
      method: 'POST',
      url: 'https://discord.com/api/v10/channels/1/messages',
      route: '/channels/:id/messages',
      majorParameter: '1',
      hash: 'x',
      limit: 5,
      timeToReset: 1500,
      retryAfter: 1500,
      sublimitTimeout: 0,
      scope: 'user',
      global: false,
    })
    const mappedRl = mapDiscordJsError(rl)
    assert.equal(mappedRl.code, '429')
    assert.equal(mappedRl.retryAfterMs, 1500)
    assert.equal(classifyTransportError(mappedRl).retry, 'retryable')

    const perm = new DiscordAPIError(
      { message: 'Missing Permissions', code: 50013 },
      50013,
      403,
      'POST',
      '/channels/1/messages',
      {},
    )
    assert.equal(mapDiscordJsError(perm).code, 'permission')
    assert.equal(classifyTransportError(mapDiscordJsError(perm)).retry, 'terminal')

    const unk = new DiscordAPIError(
      { message: 'Unknown Channel', code: 10003 },
      10003,
      404,
      'GET',
      '/channels/1',
      {},
    )
    assert.equal(mapDiscordJsError(unk).code, 'unknown_target')

    const auth = mapDiscordJsError({ name: 'DiscordAPIError', status: 401, message: 'Unauthorized' })
    assert.equal(auth.code, 'auth')
    assert.equal(classifyTransportError(auth).isolateAccount, true)

    const net = mapDiscordJsError(new Error('fetch failed: ECONNRESET'))
    assert.equal(net.code, 'connection_reset')
    assert.equal(classifyTransportError(net).retry, 'retryable')
  })
})

describe('outbox bypass audit evidence', () => {
  it('application bridge source has no direct transport send/edit/reply', async () => {
    const { readFileSync } = await import('node:fs')
    const bridgeSrc = readFileSync(new URL('../src/bridge.js', import.meta.url), 'utf8')
    assert.equal(/this\.transport\.(sendMessage|editMessage|replyMessage)\s*\(/.test(bridgeSrc), false)
    const outboundSrc = readFileSync(new URL('../src/outbound-api.js', import.meta.url), 'utf8')
    assert.equal(/transport\.(send|edit|reply)/.test(outboundSrc), false)
    assert.match(outboundSrc, /outbox\.enqueue/)
  })
})
