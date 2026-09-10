/**
 * Thread-per-conversation topology — deterministic FakeTransport suite.
 */
import assert from 'node:assert/strict'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  authorizeInbound,
  normalizeAccountConfig,
  normalizeConversationMode,
  threadNameFromContent,
  createDiscordProvider,
  buildBindingIdentity,
  toExternalIdentity,
  normalizeMessageCreate,
} from '../src/index.js'
import { createDeterministicAgents } from './helpers/deterministic-agents.js'
import { createMockAgentPresets } from './helpers/mock-agent-presets.js'
import { createConversationBindingForTest } from '../../dsh-conversation-binding/src/index.js'

const SF_G = '123456789012345678'
const SF_C = '234567890123456789'
const SF_C2 = '234567890123456780'
const SF_U = '345678901234567890'
const SF_U2 = '456789012345678901'

function setup(accounts, extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-discord-thread-'))
  const conversationBinding = createConversationBindingForTest({
    storePath: join(dir, 'bindings.json'),
  })
  const agents = createDeterministicAgents()
  const agentPresets = extra.agentPresets || createMockAgentPresets(['standard', 'vega', 'minimal'])
  const emitted = []
  const provider = createDiscordProvider(
    {
      conversationBinding,
      agents,
      observability: {
        mint: () => ({ correlation_id: 'corr-thread' }),
        bind: () => {},
        emit: (type, payload) => emitted.push({ type, payload }),
      },
      agentPresets,
      onSessionEvent: (sessionId, listener) =>
        agents.onEvent((sid, event) => {
          if (String(sid) === String(sessionId)) return listener({ id: sid }, event)
        }),
    },
    {
      accounts,
      sessionCwd: '/tmp/dsh-discord-thread-cwd',
      outboxPath: join(dir, 'outbox.json'),
      inboundDedupePath: join(dir, 'inbound-dedupe.json'),
      accountsConfigPath: join(dir, 'discord-accounts.json'),
    },
  )
  return {
    dir,
    conversationBinding,
    agents,
    agentPresets,
    transport: provider.transport,
    provider,
    emitted,
  }
}

describe('conversationMode config', () => {
  it('defaults to channel (backward compatible)', () => {
    const a = normalizeAccountConfig({ agentPreset: 'vega' })
    assert.equal(a.conversationMode, 'channel')
    assert.equal(normalizeConversationMode(undefined), 'channel')
    assert.equal(normalizeConversationMode('thread_per_conversation'), 'thread_per_conversation')
    assert.throws(() => normalizeConversationMode('forum'), /invalid conversationMode/)
  })

  it('names threads deterministically without LLM', () => {
    assert.equal(threadNameFromContent('  Hello world  \nmore'), 'Hello world')
    assert.equal(threadNameFromContent(''), 'Conversation')
    assert.equal(threadNameFromContent('   \n  '), 'Conversation')
    const long = 'x'.repeat(200)
    assert.ok(threadNameFromContent(long).length <= 100)
  })
})

describe('thread authorization (parent channel)', () => {
  const account = normalizeAccountConfig({
    allowedGuilds: [SF_G],
    allowedChannels: [SF_C],
    allowedUsers: [SF_U],
    conversationMode: 'thread_per_conversation',
  })

  it('authorizes managed child thread via parent allowlist', () => {
    const r = authorizeInbound(account, {
      guildId: SF_G,
      channelId: 'thread-dyn-1',
      threadId: 'thread-dyn-1',
      parentChannelId: SF_C,
      userId: SF_U,
    })
    assert.equal(r.ok, true)
  })

  it('denies thread under non-allowed parent', () => {
    const r = authorizeInbound(account, {
      guildId: SF_G,
      channelId: 'thread-dyn-2',
      threadId: 'thread-dyn-2',
      parentChannelId: SF_C2,
      userId: SF_U,
    })
    assert.equal(r.ok, false)
    assert.equal(r.reason, 'channel_denied')
  })

  it('denies thread with missing parent (fail closed)', () => {
    const r = authorizeInbound(account, {
      guildId: SF_G,
      channelId: 'thread-dyn-3',
      threadId: 'thread-dyn-3',
      userId: SF_U,
    })
    assert.equal(r.ok, false)
    assert.equal(r.reason, 'thread_parent_unknown')
  })

  it('denies unauthorized user before session', () => {
    const r = authorizeInbound(account, {
      guildId: SF_G,
      channelId: 'thread-dyn-4',
      threadId: 'thread-dyn-4',
      parentChannelId: SF_C,
      userId: SF_U2,
    })
    assert.equal(r.ok, false)
    assert.equal(r.reason, 'guild_user_denied')
  })
})

describe('normalizeMessageCreate parent_channel_id', () => {
  it('sets parentChannelId for thread channels', () => {
    const event = normalizeMessageCreate('vega', {
      id: 'm-t1',
      channelId: 'thread-1',
      guildId: SF_G,
      content: 'hi',
      author: { id: SF_U, bot: false },
      channel: {
        isThread: () => true,
        isDMBased: () => false,
        parentId: SF_C,
      },
    })
    assert.equal(event.threadId, 'thread-1')
    assert.equal(event.parentChannelId, SF_C)
    assert.equal(event.channelId, 'thread-1')
  })
})

describe('thread_per_conversation bridge', () => {
  /** @type {ReturnType<typeof setup>} */
  let ctx

  beforeEach(async () => {
    ctx = setup({
      vega: {
        enabled: true,
        agentPreset: 'vega',
        conversationMode: 'thread_per_conversation',
        allowedGuilds: [SF_G],
        allowedChannels: [SF_C],
        allowedUsers: [SF_U],
        ignoreBots: true,
        dm: { enabled: false },
      },
      channel_acct: {
        enabled: true,
        agentPreset: 'standard',
        conversationMode: 'channel',
        allowAllGuilds: true,
        allowAllChannels: true,
        allowAllUsers: true,
      },
    })
    await ctx.provider.start()
  })

  afterEach(async () => {
    await ctx.provider.stop()
    rmSync(ctx.dir, { recursive: true, force: true })
  })

  it('keeps channel mode: same binding/session across turns', async () => {
    await ctx.transport.injectMessage({
      accountId: 'channel_acct',
      guildId: SF_G,
      channelId: 'chan-1',
      userId: SF_U,
      messageId: 'cm1',
      content: 'reply exactly: CHAN_A',
    })
    await ctx.transport.injectMessage({
      accountId: 'channel_acct',
      guildId: SF_G,
      channelId: 'chan-1',
      userId: SF_U,
      messageId: 'cm2',
      content: 'reply exactly: CHAN_B',
    })
    const bindings = Object.values(ctx.conversationBinding.dump().bindings)
    assert.equal(bindings.length, 1)
    assert.match(Object.keys(ctx.conversationBinding.dump().bindings)[0], /channel/)
    const replies = ctx.transport.outbound.filter((o) => o.op === 'reply' || o.op === 'send')
    assert.equal(replies.length, 2)
    assert.equal(replies[0].channelId, 'chan-1')
    assert.equal(replies[1].channelId, 'chan-1')
    assert.notEqual(replies[0].messageId, replies[1].messageId)
  })

  it('top-level launcher creates one thread, binding, session; reply targets thread', async () => {
    await ctx.transport.injectMessage({
      accountId: 'vega',
      guildId: SF_G,
      channelId: SF_C,
      userId: SF_U,
      messageId: 'parent-1',
      content: 'reply exactly: THREAD_A',
    })

    const creates = ctx.transport.outbound.filter((o) => o.op === 'createThread')
    assert.equal(creates.length, 1)
    assert.equal(creates[0].threadId, 'thread_from_parent-1')
    assert.equal(creates[0].parentChannelId, SF_C)

    const identity = toExternalIdentity(
      buildBindingIdentity('vega', {
        channelId: 'thread_from_parent-1',
        threadId: 'thread_from_parent-1',
        userId: SF_U,
      }),
    )
    const binding = ctx.conversationBinding.resolve(identity)
    assert.ok(binding)
    assert.equal(identity.scope, 'vega.thread')
    assert.equal(identity.external_id, 'thread_from_parent-1')

    const replies = ctx.transport.outbound.filter((o) => o.op === 'reply' || o.op === 'send')
    assert.ok(replies.length >= 1)
    const last = replies[replies.length - 1]
    assert.equal(last.channelId, 'thread_from_parent-1')
    assert.match(last.payload.content, /THREAD_A/)
    // Must not leak assistant output into launcher channel
    assert.ok(!replies.some((r) => r.channelId === SF_C))

    const createOps = ctx.provider.outbox.listOperations({ accountId: 'vega' }).filter(
      (o) => o.operation_type === 'createThread',
    )
    assert.equal(createOps.length, 1)
    assert.equal(createOps[0].operation_id, 'thread:create:vega:parent-1')
    assert.equal(createOps[0].discord_resource_id, 'thread_from_parent-1')
  })

  it('second message in same thread reuses session; new launcher creates second session', async () => {
    await ctx.transport.injectMessage({
      accountId: 'vega',
      guildId: SF_G,
      channelId: SF_C,
      userId: SF_U,
      messageId: 'parent-A',
      content: 'reply exactly: A1',
    })
    const threadA = 'thread_from_parent-A'
    const bindA = ctx.conversationBinding.resolve(
      toExternalIdentity(
        buildBindingIdentity('vega', { channelId: threadA, threadId: threadA, userId: SF_U }),
      ),
    )
    assert.ok(bindA)
    const sessionA = bindA.session_id

    await ctx.transport.injectMessage({
      accountId: 'vega',
      guildId: SF_G,
      channelId: threadA,
      threadId: threadA,
      parentChannelId: SF_C,
      userId: SF_U,
      messageId: 'in-thread-2',
      content: 'reply exactly: A2',
    })
    const bindA2 = ctx.conversationBinding.resolve(
      toExternalIdentity(
        buildBindingIdentity('vega', { channelId: threadA, threadId: threadA, userId: SF_U }),
      ),
    )
    assert.equal(bindA2.session_id, sessionA)

    await ctx.transport.injectMessage({
      accountId: 'vega',
      guildId: SF_G,
      channelId: SF_C,
      userId: SF_U,
      messageId: 'parent-B',
      content: 'reply exactly: B1',
    })
    const threadB = 'thread_from_parent-B'
    const bindB = ctx.conversationBinding.resolve(
      toExternalIdentity(
        buildBindingIdentity('vega', { channelId: threadB, threadId: threadB, userId: SF_U }),
      ),
    )
    assert.ok(bindB)
    assert.notEqual(bindB.session_id, sessionA)
    assert.notEqual(threadA, threadB)

    const creates = ctx.transport.outbound.filter((o) => o.op === 'createThread')
    assert.equal(creates.length, 2)
  })

  it('retry after successful thread create does not duplicate thread', async () => {
    await ctx.transport.injectMessage({
      accountId: 'vega',
      guildId: SF_G,
      channelId: SF_C,
      userId: SF_U,
      messageId: 'parent-idem',
      content: 'reply exactly: IDEM',
    })
    assert.equal(ctx.transport.outbound.filter((o) => o.op === 'createThread').length, 1)

    // Simulate crash after thread+binding: replay same parent message (dedupe should block)
    const dup = await ctx.provider.bridge.handleInbound({
      type: 'discord.message.created',
      accountId: 'vega',
      guildId: SF_G,
      channelId: SF_C,
      userId: SF_U,
      messageId: 'parent-idem',
      eventId: 'parent-idem',
      content: 'reply exactly: IDEM',
    })
    assert.equal(dup.reason, 'duplicate')
    assert.equal(ctx.transport.outbound.filter((o) => o.op === 'createThread').length, 1)
  })

  it('reconciles delivered createThread receipt without second Discord create', async () => {
    const opId = 'thread:create:vega:parent-recon'
    await ctx.provider.outbox.enqueue({
      operationId: opId,
      accountId: 'vega',
      operationType: 'createThread',
      target: { channelId: SF_C, parentChannelId: SF_C, messageId: 'parent-recon' },
      payload: { threadName: 'recon' },
      useNonce: false,
    })
    await ctx.provider.outbox.tick({ accountId: 'vega' })
    assert.equal(ctx.provider.outbox.getReceipt(opId).state, 'delivered')
    const createsBefore = ctx.transport.outbound.filter((o) => o.op === 'createThread').length

    await ctx.transport.injectMessage({
      accountId: 'vega',
      guildId: SF_G,
      channelId: SF_C,
      userId: SF_U,
      messageId: 'parent-recon',
      content: 'reply exactly: RECON',
    })
    // Outbox enqueue is idempotent; FakeTransport may still not be called again
    assert.equal(ctx.transport.outbound.filter((o) => o.op === 'createThread').length, createsBefore)
    const binding = ctx.conversationBinding.resolve(
      toExternalIdentity(
        buildBindingIdentity('vega', {
          channelId: 'thread_from_parent-recon',
          threadId: 'thread_from_parent-recon',
          userId: SF_U,
        }),
      ),
    )
    assert.ok(binding)
  })

  it('thread create failure does not create phantom binding', async () => {
    ctx.transport.simulateNextFailure('vega', 'permission')
    const result = await ctx.provider.bridge.handleInbound({
      type: 'discord.message.created',
      accountId: 'vega',
      guildId: SF_G,
      channelId: SF_C,
      userId: SF_U,
      messageId: 'parent-fail',
      eventId: 'parent-fail',
      content: 'reply exactly: FAIL',
    })
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'thread_create_failed')
    const bindings = Object.values(ctx.conversationBinding.dump().bindings)
    assert.equal(bindings.length, 0)
  })

  it('ignores bots; missing parent denied at auth', async () => {
    const bot = await ctx.provider.bridge.handleInbound({
      type: 'discord.message.created',
      accountId: 'vega',
      guildId: SF_G,
      channelId: SF_C,
      userId: SF_U,
      messageId: 'bot-1',
      eventId: 'bot-1',
      content: 'x',
      isBot: true,
    })
    assert.equal(bot.reason, 'ignored_bot')

    const orphan = await ctx.provider.bridge.handleInbound({
      type: 'discord.message.created',
      accountId: 'vega',
      guildId: SF_G,
      channelId: 'orphan-thread',
      threadId: 'orphan-thread',
      userId: SF_U,
      messageId: 'ot-1',
      eventId: 'ot-1',
      content: 'x',
    })
    assert.equal(orphan.reason, 'thread_parent_unknown')
  })

  it('new threads use current account preset; existing bindings keep session after preset change', async () => {
    await ctx.transport.injectMessage({
      accountId: 'vega',
      guildId: SF_G,
      channelId: SF_C,
      userId: SF_U,
      messageId: 'parent-preset',
      content: 'reply exactly: PRESET1',
    })
    const threadId = 'thread_from_parent-preset'
    const before = ctx.conversationBinding.resolve(
      toExternalIdentity(
        buildBindingIdentity('vega', { channelId: threadId, threadId, userId: SF_U }),
      ),
    )
    assert.ok(before)
    const sessionBefore = before.session_id

    // Mutate runtime account preset (does not remount existing binding)
    ctx.provider.bridge.accounts.vega.agentPreset = 'minimal'

    await ctx.transport.injectMessage({
      accountId: 'vega',
      guildId: SF_G,
      channelId: threadId,
      threadId,
      parentChannelId: SF_C,
      userId: SF_U,
      messageId: 'in-thread-preset',
      content: 'reply exactly: PRESET2',
    })
    const after = ctx.conversationBinding.resolve(
      toExternalIdentity(
        buildBindingIdentity('vega', { channelId: threadId, threadId, userId: SF_U }),
      ),
    )
    assert.equal(after.session_id, sessionBefore)

    await ctx.transport.injectMessage({
      accountId: 'vega',
      guildId: SF_G,
      channelId: SF_C,
      userId: SF_U,
      messageId: 'parent-preset-new',
      content: 'reply exactly: PRESET3',
    })
    const newBind = ctx.conversationBinding.resolve(
      toExternalIdentity(
        buildBindingIdentity('vega', {
          channelId: 'thread_from_parent-preset-new',
          threadId: 'thread_from_parent-preset-new',
          userId: SF_U,
        }),
      ),
    )
    assert.ok(newBind)
    assert.notEqual(newBind.session_id, sessionBefore)
  })

  it('missing binding on allowed thread creates binding/session (documented recovery)', async () => {
    await ctx.transport.injectMessage({
      accountId: 'vega',
      guildId: SF_G,
      channelId: 'external-thread-1',
      threadId: 'external-thread-1',
      parentChannelId: SF_C,
      userId: SF_U,
      messageId: 'ext-1',
      content: 'reply exactly: EXT',
    })
    const binding = ctx.conversationBinding.resolve(
      toExternalIdentity(
        buildBindingIdentity('vega', {
          channelId: 'external-thread-1',
          threadId: 'external-thread-1',
          userId: SF_U,
        }),
      ),
    )
    assert.ok(binding)
    const last = ctx.transport.outbound[ctx.transport.outbound.length - 1]
    assert.equal(last.channelId, 'external-thread-1')
  })
})
