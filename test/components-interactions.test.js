/**
 * Components V2 + interaction foundation — deterministic FakeTransport suite.
 */
import assert from 'node:assert/strict'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createConversationBindingForTest } from '../../dsh-conversation-binding/src/index.js'
import {
  createDiscordProvider,
  encodeOutboundComponents,
  mintCustomId,
  parseCustomId,
  defaultAllowedMentions,
  buildLabInteractionSmokeMessage,
  normalizeInteractionCreate,
  MESSAGE_FLAG_IS_COMPONENTS_V2,
  DISCORD_CUSTOM_ID_MAX,
  mapDiscordJsError,
  classifyTransportError,
  toDiscordMessageBody,
} from '../src/index.js'
import { FakeTransport, TransportError } from '../src/transport/fake.js'
import { createDeterministicAgents } from './helpers/deterministic-agents.js'
import { createMockAgentPresets } from './helpers/mock-agent-presets.js'

const OPEN_ACCOUNT = {
  enabled: true,
  agentPreset: 'standard',
  allowAllGuilds: true,
  allowAllChannels: true,
  allowAllUsers: true,
  dm: { enabled: true, allowAllUsers: true },
}

function setup(accounts = { lab: OPEN_ACCOUNT }, extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-discord-ix-'))
  const conversationBinding = createConversationBindingForTest({
    storePath: join(dir, 'bindings.json'),
  })
  const agents = createDeterministicAgents()
  const agentPresets = createMockAgentPresets(['standard', 'vega', 'minimal'])
  const transport = new FakeTransport()
  const intents = []
  const provider = createDiscordProvider(
    {
      conversationBinding,
      agents,
      transport,
      agentPresets,
      onInteractionIntent: async (event) => {
        intents.push(event)
      },
      onSessionEvent: (sessionId, listener) =>
        agents.onEvent((sid, event) => {
          if (String(sid) === String(sessionId)) return listener({ id: sid }, event)
        }),
    },
    {
      accounts,
      sessionCwd: '/tmp/dsh-discord-ix-cwd',
      outboxPath: join(dir, 'outbox.json'),
      inboundDedupePath: join(dir, 'inbound-dedupe.json'),
      accountsConfigPath: join(dir, 'discord-accounts.json'),
    },
  )
  return { dir, conversationBinding, agents, transport, provider, intents }
}

describe('component model encode', () => {
  it('typed V2 primitives encode with IsComponentsV2 flag', () => {
    const encoded = encodeOutboundComponents([
      { kind: 'TextDisplay', text: 'hello' },
      {
        kind: 'ActionRow',
        children: [{ kind: 'Button', customId: mintCustomId({ intent: 'ping', nonce: 'n1' }), label: 'Ping' }],
      },
    ])
    assert.equal(encoded.encoding, 'components_v2')
    assert.equal(encoded.flags, MESSAGE_FLAG_IS_COMPONENTS_V2)
    assert.equal(encoded.components[0].type, 10)
    assert.equal(encoded.components[1].type, 1)
    assert.equal(encoded.components[1].components[0].type, 2)
  })

  it('opaque future nodes survive via raw envelope', () => {
    const encoded = encodeOutboundComponents([
      { kind: 'Unknown', raw: { type: 99, custom_id: 'future', label: 'x', token: 'SECRET' } },
    ])
    assert.equal(encoded.components[0].type, 99)
    assert.equal(encoded.components[0].custom_id, 'future')
    assert.equal(encoded.components[0].token, undefined)
  })

  it('legacy ActionRow-only messages stay legacy_rows (no V2 flag)', () => {
    const encoded = encodeOutboundComponents([
      {
        kind: 'ActionRow',
        children: [{ kind: 'Button', customId: 'dsh1.legacy.x', label: 'Go' }],
      },
    ])
    assert.equal(encoded.encoding, 'legacy_rows')
    assert.equal(encoded.flags, undefined)
  })

  it('toDiscordMessageBody keeps content for legacy; omits content for V2', () => {
    const legacy = toDiscordMessageBody({
      content: 'hi',
      components: [
        {
          kind: 'ActionRow',
          children: [{ kind: 'Button', customId: 'dsh1.a.b', label: 'A' }],
        },
      ],
    })
    assert.equal(legacy.content, 'hi')
    assert.ok(legacy.components?.length)
    assert.deepEqual(legacy.allowedMentions, { parse: [] })

    const v2 = toDiscordMessageBody({
      content: 'should-not-appear',
      components: [{ kind: 'TextDisplay', text: 'Interaction smoke' }],
    })
    assert.equal(v2.content, undefined)
    assert.equal(v2.flags & MESSAGE_FLAG_IS_COMPONENTS_V2, MESSAGE_FLAG_IS_COMPONENTS_V2)
  })

  it('custom_id scheme is bounded and rejects secrets', () => {
    const id = mintCustomId({ intent: 'smoke_ping', nonce: 'abc' })
    assert.ok(id.length <= DISCORD_CUSTOM_ID_MAX)
    assert.equal(parseCustomId(id).ok, true)
    assert.equal(parseCustomId(id).intent, 'smoke_ping')
    assert.throws(() =>
      encodeOutboundComponents([
        {
          kind: 'ActionRow',
          children: [{ kind: 'Button', customId: 'token_abc', label: 'x' }],
        },
      ]),
    )
  })

  it('LAB smoke builder returns button + select under V2 tree', () => {
    const smoke = buildLabInteractionSmokeMessage({
      pingCustomId: 'dsh1.smoke_ping.t1',
      selectCustomId: 'dsh1.smoke_choice.t1',
    })
    const encoded = encodeOutboundComponents(smoke.components)
    assert.equal(encoded.encoding, 'components_v2')
    assert.deepEqual(smoke.allowedMentions, defaultAllowedMentions())
  })
})

describe('interaction normalization', () => {
  it('normalizes button + string select snowflakes as strings', () => {
    const button = normalizeInteractionCreate('lab', {
      id: 111n,
      applicationId: 222n,
      guildId: 333n,
      channelId: 444n,
      customId: 'dsh1.smoke_ping.n',
      componentType: 2,
      type: 3,
      user: { id: 555n, bot: false },
      message: { id: 666n },
      channel: { id: 444n, isThread: () => false },
      isButton: () => true,
      isAnySelectMenu: () => false,
    })
    assert.equal(button.type, 'discord.button.clicked')
    assert.equal(button.interactionId, '111')
    assert.equal(button.userId, '555')
    assert.equal(button.guildId, '333')
    assert.equal(button.deliveryMode, 'gateway')
    assert.equal(button.raw?.token, undefined)

    const select = normalizeInteractionCreate(
      'lab',
      {
        id: '777',
        guildId: 'g1',
        channelId: 'thr1',
        customId: 'dsh1.smoke_choice.n',
        componentType: 3,
        values: ['alpha'],
        user: { id: 'u1' },
        message: { id: 'm1' },
        channel: { id: 'thr1', isThread: () => true, parentId: 'parent1' },
        isButton: () => false,
        isAnySelectMenu: () => true,
        isStringSelectMenu: () => true,
      },
      { deliveryMode: 'http_endpoint' },
    )
    assert.equal(select.type, 'discord.select.changed')
    assert.equal(select.threadId, 'thr1')
    assert.equal(select.parentChannelId, 'parent1')
    assert.deepEqual(select.values, ['alpha'])
    assert.equal(select.deliveryMode, 'http_endpoint')
  })

  it('user/role/channel select values are string snowflakes', () => {
    const users = new Map([
      ['100', {}],
      ['200', {}],
    ])
    const roles = new Map([['300', {}]])
    const channels = new Map([['400', {}]])
    assert.deepEqual(
      normalizeInteractionCreate('lab', {
        id: '1',
        channelId: 'c',
        user: { id: 'u' },
        componentType: 5,
        users,
        isButton: () => false,
        isAnySelectMenu: () => true,
        isUserSelectMenu: () => true,
      }).values,
      ['100', '200'],
    )
    assert.deepEqual(
      normalizeInteractionCreate('lab', {
        id: '2',
        channelId: 'c',
        user: { id: 'u' },
        componentType: 6,
        roles,
        isButton: () => false,
        isAnySelectMenu: () => true,
        isRoleSelectMenu: () => true,
      }).values,
      ['300'],
    )
    assert.deepEqual(
      normalizeInteractionCreate('lab', {
        id: '3',
        channelId: 'c',
        user: { id: 'u' },
        componentType: 8,
        channels,
        isButton: () => false,
        isAnySelectMenu: () => true,
        isChannelSelectMenu: () => true,
      }).values,
      ['400'],
    )
  })
})

describe('interaction bridge path', () => {
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

  it('button: authorize → dedupe → deferUpdate ACK → smoke follow-up', async () => {
    const customId = mintCustomId({ intent: 'smoke_ping', nonce: 'btn1' })
    const result = await ctx.provider.bridge.handleInbound({
      type: 'discord.button.clicked',
      accountId: 'lab',
      interactionId: 'ix-btn-1',
      channelId: 'c1',
      guildId: 'g1',
      userId: 'u1',
      messageId: 'm1',
      customId,
      componentType: 'button',
    })
    assert.equal(result.ok, true)
    assert.equal(result.ack, 'deferUpdate')
    assert.equal(result.smoke?.delivered, true)
    assert.match(result.smoke.summary, /button received/)
    const defer = ctx.transport.outbound.find((o) => o.op === 'deferInteraction')
    assert.ok(defer)
    assert.equal(defer.payload.content, 'deferUpdate')
    const follow = ctx.transport.outbound.find((o) => o.op === 'followUpInteraction')
    assert.ok(follow)
    assert.deepEqual(follow.payload.allowedMentions, { parse: [] })
  })

  it('select: values normalized + same ACK path', async () => {
    const customId = mintCustomId({ intent: 'smoke_choice', nonce: 'sel1' })
    const result = await ctx.provider.bridge.handleInbound({
      type: 'discord.select.changed',
      accountId: 'lab',
      interactionId: 'ix-sel-1',
      channelId: 'c1',
      guildId: 'g1',
      userId: 'u1',
      messageId: 'm1',
      customId,
      componentType: 'string_select',
      values: ['beta'],
    })
    assert.equal(result.ok, true)
    assert.equal(result.ack, 'deferUpdate')
    assert.match(result.smoke.summary, /values=beta/)
  })

  it('interaction_id dedupe suppresses replay', async () => {
    const customId = mintCustomId({ intent: 'smoke_ping', nonce: 'dup' })
    const first = await ctx.provider.bridge.handleInbound({
      type: 'discord.button.clicked',
      accountId: 'lab',
      interactionId: 'ix-dup',
      channelId: 'c1',
      guildId: 'g1',
      userId: 'u1',
      messageId: 'm1',
      customId,
      componentType: 'button',
    })
    assert.equal(first.ok, true)
    const second = await ctx.provider.bridge.handleInbound({
      type: 'discord.button.clicked',
      accountId: 'lab',
      interactionId: 'ix-dup',
      channelId: 'c1',
      guildId: 'g1',
      userId: 'u1',
      messageId: 'm1',
      customId,
      componentType: 'button',
    })
    assert.equal(second.ok, false)
    assert.equal(second.reason, 'duplicate')
    assert.equal(ctx.provider.bridge.interactionDispatches.length, 1)
    const followUps = ctx.transport.outbound.filter((o) => o.op === 'followUpInteraction')
    assert.equal(followUps.length, 1)
  })

  it('unauthorized user denied before consumer / binding', async () => {
    await ctx.provider.stop()
    rmSync(ctx.dir, { recursive: true, force: true })
    ctx = setup({
      lab: {
        enabled: true,
        agentPreset: 'standard',
        allowAllGuilds: false,
        allowedGuilds: ['g1'],
        allowAllChannels: false,
        allowedChannels: ['parent'],
        allowAllUsers: false,
        allowedUsers: ['allowed-user'],
      },
    })
    await ctx.provider.start()

    const denied = await ctx.provider.bridge.handleInbound({
      type: 'discord.button.clicked',
      accountId: 'lab',
      interactionId: 'ix-deny',
      channelId: 'thr1',
      threadId: 'thr1',
      parentChannelId: 'parent',
      guildId: 'g1',
      userId: 'stranger',
      messageId: 'm1',
      customId: mintCustomId({ intent: 'smoke_ping', nonce: 'd' }),
      componentType: 'button',
    })
    assert.equal(denied.ok, false)
    assert.equal(denied.reason, 'guild_user_denied')
    assert.equal(ctx.intents.length, 0)
    assert.equal(ctx.provider.bridge.interactionDispatches.length, 0)
  })

  it('thread interaction authorizes via parent_channel_id; missing parent fails closed', async () => {
    await ctx.provider.stop()
    rmSync(ctx.dir, { recursive: true, force: true })
    ctx = setup({
      lab: {
        enabled: true,
        agentPreset: 'standard',
        allowAllGuilds: false,
        allowedGuilds: ['g1'],
        allowAllChannels: false,
        allowedChannels: ['parent-ok'],
        allowAllUsers: true,
      },
    })
    await ctx.provider.start()

    const orphan = await ctx.provider.bridge.handleInbound({
      type: 'discord.button.clicked',
      accountId: 'lab',
      interactionId: 'ix-orphan',
      channelId: 'thr-x',
      threadId: 'thr-x',
      guildId: 'g1',
      userId: 'u1',
      messageId: 'm1',
      customId: mintCustomId({ intent: 'smoke_ping', nonce: 'o' }),
      componentType: 'button',
    })
    assert.equal(orphan.ok, false)
    assert.equal(orphan.reason, 'thread_parent_unknown')

    const ok = await ctx.provider.bridge.handleInbound({
      type: 'discord.button.clicked',
      accountId: 'lab',
      interactionId: 'ix-parent-ok',
      channelId: 'thr-y',
      threadId: 'thr-y',
      parentChannelId: 'parent-ok',
      guildId: 'g1',
      userId: 'u1',
      messageId: 'm1',
      customId: mintCustomId({ intent: 'smoke_ping', nonce: 'p' }),
      componentType: 'button',
    })
    assert.equal(ok.ok, true)
  })

  it('thread binding session reused on interaction (no remint)', async () => {
    const external = {
      provider: 'discord',
      scope: 'lab.thread',
      external_id: 'thr-reuse',
    }
    const { binding } = await ctx.conversationBinding.resolveOrCreate(external, {
      createSessionId: () => 'session-existing',
    })
    assert.equal(binding.session_id, 'session-existing')

    const result = await ctx.provider.bridge.handleInbound({
      type: 'discord.button.clicked',
      accountId: 'lab',
      interactionId: 'ix-reuse',
      channelId: 'thr-reuse',
      threadId: 'thr-reuse',
      parentChannelId: 'parent',
      guildId: 'g1',
      userId: 'u1',
      messageId: 'm1',
      customId: mintCustomId({ intent: 'smoke_ping', nonce: 'r' }),
      componentType: 'button',
    })
    assert.equal(result.ok, true)
    assert.equal(result.sessionId, 'session-existing')
  })

  it('postLabInteractionSmoke enqueues Components V2 message via outbox', async () => {
    const posted = await ctx.provider.postLabInteractionSmoke({
      accountId: 'lab',
      channelId: 'c-smoke',
      operationId: 'lab:ix-smoke:1',
      pingCustomId: 'dsh1.smoke_ping.live',
      selectCustomId: 'dsh1.smoke_choice.live',
    })
    assert.equal(posted.ok, true)
    assert.equal(posted.encoding, 'components_v2')
    const send = ctx.transport.outbound.find((o) => o.op === 'send')
    assert.ok(send)
    assert.ok(send.payload.components?.length >= 2)
    assert.deepEqual(send.payload.allowedMentions, { parse: [] })
  })

  it('generic onInteractionIntent receives non-smoke custom ids after ACK', async () => {
    const result = await ctx.provider.bridge.handleInbound({
      type: 'discord.button.clicked',
      accountId: 'lab',
      interactionId: 'ix-generic',
      channelId: 'c1',
      guildId: 'g1',
      userId: 'u1',
      messageId: 'm1',
      customId: 'dsh1.other.abc',
      componentType: 'button',
    })
    assert.equal(result.ok, true)
    assert.equal(ctx.intents.length, 1)
    assert.equal(ctx.intents[0].customId, 'dsh1.other.abc')
    assert.ok(ctx.transport.outbound.some((o) => o.op === 'deferInteraction'))
  })
})

describe('interaction error mapping', () => {
  it('maps already acknowledged / expired / unknown interaction', () => {
    const already = mapDiscordJsError({ name: 'DiscordAPIError[40060]', code: 40060, status: 400, message: 'Interaction has already been acknowledged.' })
    assert.equal(already.code, 'already_acknowledged')
    assert.equal(classifyTransportError(already).retry, 'terminal')

    const expired = mapDiscordJsError({ name: 'DiscordAPIError[10062]', code: 10062, status: 404, message: 'Unknown interaction' })
    assert.equal(expired.code, 'unknown_target')
    assert.equal(classifyTransportError(new TransportError('interaction_expired', 'expired')).code, 'interaction_expired')
  })
})
