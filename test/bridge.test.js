import assert from 'node:assert/strict'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createConversationBindingForTest } from '../../dsh-conversation-binding/src/index.js'
import { createDiscordProvider } from '../src/index.js'
import { FakeTransport, TransportError } from '../src/transport/fake.js'
import { DiscordJsTransport } from '../src/transport/discordjs.js'
import { createDeterministicAgents } from './helpers/deterministic-agents.js'
import { COMPONENT_KINDS } from '../src/types.js'
import { createDiscordUserMessage } from '../src/message-source.js'

function setup(accounts, extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-discord-bridge-'))
  const conversationBinding = createConversationBindingForTest({
    storePath: join(dir, 'bindings.json'),
  })
  const agents = createDeterministicAgents()
  const transport = new FakeTransport()
  const emitted = []
  const observability = {
    mint: () => ({ correlation_id: 'corr-test' }),
    bind: () => {},
    emit: (type, payload) => {
      emitted.push({ type, payload })
    },
  }
  const provider = createDiscordProvider(
    {
      conversationBinding,
      agents,
      transport,
      observability,
      clock: extra.clock,
      onSessionEvent: (sessionId, listener) =>
        agents.onEvent((sid, event) => {
          if (String(sid) === String(sessionId)) return listener({ id: sid }, event)
        }),
    },
    {
      accounts,
      outboxPath: join(dir, 'outbox.json'),
      inboundDedupePath: join(dir, 'inbound-dedupe.json'),
      accountsConfigPath: join(dir, 'discord-accounts.json'),
      inboundDedupeTtlMs: extra.inboundDedupeTtlMs,
      inboundDedupeLeaseMs: extra.inboundDedupeLeaseMs,
    },
  )
  return { dir, conversationBinding, agents, transport, provider, emitted }
}

describe('FakeTransport', () => {
  it('records send/reply/edit and simulated failures', async () => {
    const t = new FakeTransport()
    await t.startAccount('a1')
    const sent = await t.sendMessage('a1', 'c1', { content: 'hi', components: [{ kind: 'TextDisplay', text: 'hi' }] })
    assert.ok(sent.messageId)
    await t.replyMessage('a1', 'c1', sent.messageId, { content: 'r' })
    await t.editMessage('a1', 'c1', sent.messageId, { content: 'e' })
    assert.equal(t.outbound.length, 3)

    t.simulateNextFailure('a1', '429')
    await assert.rejects(() => t.sendMessage('a1', 'c1', { content: 'x' }), (err) => {
      assert.equal(err.code, '429')
      return true
    })
    t.simulateNextFailure('a1', '5xx')
    await assert.rejects(() => t.sendMessage('a1', 'c1', { content: 'x' }), (e) => e.code === '5xx')
    t.simulateNextFailure('a1', 'timeout')
    await assert.rejects(() => t.sendMessage('a1', 'c1', { content: 'x' }), (e) => e.code === 'timeout')
    t.simulateNextFailure('a1', 'permission')
    await assert.rejects(() => t.sendMessage('a1', 'c1', { content: 'x' }), (e) => e.code === 'permission')
  })

  it('exposes Components V2-capable kinds in the model', () => {
    for (const kind of ['TextDisplay', 'Container', 'Section', 'Button', 'Select', 'File']) {
      assert.ok(COMPONENT_KINDS.includes(kind))
    }
  })
})

describe('DiscordJsTransport skeleton', () => {
  it('validates discord.js dependency without connecting', async () => {
    const t = new DiscordJsTransport({ allowConnect: false })
    const info = await t.validateDependency()
    assert.equal(info.package, 'discord.js')
    assert.equal(info.hasClient, true)
    await assert.rejects(() => t.startAccount('a1'), /live connect disabled/)
  })
})

describe('MessageSource', () => {
  it('uses kind user (no invented discord enum)', () => {
    const msg = createDiscordUserMessage('hello', { accountId: 'a' })
    assert.equal(msg.source.kind, 'user')
    assert.equal(msg.content[0].text, 'hello')
  })
})

describe('DSH bridge', () => {
  /** @type {ReturnType<typeof setup>} */
  let ctx

  beforeEach(async () => {
    ctx = setup({
      account_alpha: {
        enabled: true,
        allowAllGuilds: true,
        allowAllChannels: true,
        allowAllUsers: true,
        dm: { enabled: true, allowAllUsers: true },
      },
      account_beta: {
        enabled: true,
        allowedGuilds: ['g-beta'],
        allowedChannels: ['c-beta'],
        allowAllUsers: true,
      },
    })
    await ctx.provider.start()
  })

  afterEach(async () => {
    await ctx.provider.stop()
    rmSync(ctx.dir, { recursive: true, force: true })
  })

  it('creates session, followups, and delivers outbound', async () => {
    await ctx.transport.injectMessage({
      accountId: 'account_alpha',
      channelId: 'c1',
      guildId: 'g1',
      userId: 'u1',
      messageId: 'm1',
      content: 'reply exactly: DSH_DISCORD_SMOKE_OK',
    })
    assert.ok(ctx.transport.outbound.length >= 1)
    const last = ctx.transport.outbound[ctx.transport.outbound.length - 1]
    assert.match(last.payload.content, /DSH_DISCORD_SMOKE_OK/)
    assert.ok(ctx.emitted.some((e) => e.type === 'request.received'))
    const ops = ctx.provider.outbox.listOperations({ accountId: 'account_alpha' })
    assert.ok(ops.some((o) => o.state === 'delivered'))
  })

  it('reuses live session on repeated events', async () => {
    await ctx.transport.injectMessage({
      accountId: 'account_alpha',
      channelId: 'c-reuse',
      guildId: 'g1',
      userId: 'u1',
      messageId: 'm1',
      content: 'reply exactly: ONE',
    })
    const bindings = ctx.conversationBinding.dump().bindings
    const sessions = new Set(Object.values(bindings).map((b) => b.session_id))
    assert.equal(sessions.size, 1)
    const sessionId = [...sessions][0]

    await ctx.transport.injectMessage({
      accountId: 'account_alpha',
      channelId: 'c-reuse',
      guildId: 'g1',
      userId: 'u1',
      messageId: 'm2',
      content: 'reply exactly: TWO',
    })
    const sessions2 = new Set(
      Object.values(ctx.conversationBinding.dump().bindings).map((b) => b.session_id),
    )
    assert.equal(sessions2.size, 1)
    assert.equal([...sessions2][0], sessionId)
  })

  it('recovers when session handle is missing', async () => {
    await ctx.transport.injectMessage({
      accountId: 'account_alpha',
      channelId: 'c-recovery',
      guildId: 'g1',
      userId: 'u1',
      messageId: 'm1',
      content: 'reply exactly: BEFORE',
    })
    const identity = {
      provider: 'discord',
      scope: 'account_alpha.channel',
      external_id: 'c-recovery',
    }
    const before = ctx.conversationBinding.resolve(identity)
    assert.ok(before)
    ctx.agents.dropHandle(before.session_id)

    await ctx.transport.injectMessage({
      accountId: 'account_alpha',
      channelId: 'c-recovery',
      guildId: 'g1',
      userId: 'u1',
      messageId: 'm2',
      content: 'reply exactly: AFTER_RECOVERY',
    })
    const after = ctx.conversationBinding.resolve(identity)
    assert.ok(after)
    assert.notEqual(after.session_id, before.session_id)
    const last = ctx.transport.outbound[ctx.transport.outbound.length - 1]
    assert.match(last.payload.content, /AFTER_RECOVERY/)
  })

  it('denies guild/channel and ignores bots / stopped accounts', async () => {
    const deniedGuild = await ctx.provider.bridge.handleInbound({
      type: 'discord.message.created',
      accountId: 'account_beta',
      channelId: 'c-beta',
      guildId: 'g-wrong',
      userId: 'u1',
      messageId: 'm1',
      content: 'x',
      eventId: 'e1',
    })
    assert.equal(deniedGuild.reason, 'guild_denied')

    const deniedChannel = await ctx.provider.bridge.handleInbound({
      type: 'discord.message.created',
      accountId: 'account_beta',
      channelId: 'c-wrong',
      guildId: 'g-beta',
      userId: 'u1',
      messageId: 'm1',
      content: 'x',
      eventId: 'e2',
    })
    assert.equal(deniedChannel.reason, 'channel_denied')

    const bot = await ctx.provider.bridge.handleInbound({
      type: 'discord.message.created',
      accountId: 'account_alpha',
      channelId: 'c1',
      guildId: 'g1',
      userId: 'bot',
      messageId: 'm1',
      content: 'x',
      eventId: 'e3',
      isBot: true,
    })
    assert.equal(bot.reason, 'ignored_bot')

    await ctx.provider.stopAccount('account_alpha')
    const stopped = await ctx.provider.bridge.handleInbound({
      type: 'discord.message.created',
      accountId: 'account_alpha',
      channelId: 'c1',
      guildId: 'g1',
      userId: 'u1',
      messageId: 'm1',
      content: 'x',
      eventId: 'e4',
    })
    assert.equal(stopped.reason, 'account_stopped')
  })

  it('routes outbound to the correct account', async () => {
    await ctx.transport.injectMessage({
      accountId: 'account_alpha',
      channelId: 'c-iso',
      guildId: 'g1',
      userId: 'u1',
      messageId: 'm1',
      content: 'reply exactly: ALPHA',
    })
    assert.ok(ctx.transport.outbound.every((o) => o.accountId === 'account_alpha'))
  })
})
