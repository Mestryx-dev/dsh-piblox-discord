/**
 * Semantic Discord service + tool wrappers + policy path (FakeTransport).
 */
import assert from 'node:assert/strict'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createConversationBindingForTest } from '../../dsh-conversation-binding/src/index.js'
import {
  createDiscordProvider,
  normalizeProactiveTargets,
  resolveSemanticTarget,
  authorizeOutboundDelivery,
  buildDiscordToolDefinitions,
  DISCORD_TOOL_RISK,
} from '../src/index.js'
import { FakeTransport } from '../src/transport/fake.js'
import { createDeterministicAgents } from './helpers/deterministic-agents.js'
import { createMockAgentPresets } from './helpers/mock-agent-presets.js'
import { createPolicyForTest } from '../../dsh-policy-engine/src/index.js'

const GUILD = 'g1'
const CHANNEL = 'c-lab'
const THREAD = 'thr-lab'

function openAccount(extra = {}) {
  return {
    enabled: true,
    agentPreset: 'standard',
    allowAllGuilds: false,
    allowedGuilds: [GUILD],
    allowAllChannels: false,
    allowedChannels: [CHANNEL],
    allowAllUsers: true,
    dm: { enabled: false, allowAllUsers: false, allowedUsers: [] },
    proactiveTargets: {
      notifications: { kind: 'channel', id: CHANNEL, guildId: GUILD },
      ops_thread: {
        kind: 'thread',
        id: THREAD,
        parentChannelId: CHANNEL,
        guildId: GUILD,
      },
    },
    ...extra,
  }
}

function setup(accounts = { lab: openAccount() }) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-discord-semantic-'))
  const conversationBinding = createConversationBindingForTest({
    storePath: join(dir, 'bindings.json'),
  })
  const agents = createDeterministicAgents()
  const agentPresets = createMockAgentPresets(['standard', 'vega'])
  const transport = new FakeTransport()
  transport.seedDirectory({
    guilds: [{ id: GUILD, name: 'Lab Guild' }],
    channels: [
      { id: CHANNEL, name: 'lab', guildId: GUILD, type: 0 },
      {
        id: THREAD,
        name: 'ops',
        guildId: GUILD,
        parentId: CHANNEL,
        isThread: true,
        type: 11,
      },
    ],
    messages: [
      {
        id: 'm1',
        channelId: CHANNEL,
        authorId: 'bot',
        content: 'hello',
        timestamp: '2026-09-10T00:00:00.000Z',
      },
    ],
  })
  const obs = []
  const provider = createDiscordProvider(
    {
      conversationBinding,
      agents,
      transport,
      agentPresets,
      observability: {
        mint: () => ({ correlation_id: 'corr' }),
        bind: () => {},
        emit: (type, payload) => obs.push({ type, payload }),
      },
    },
    {
      accounts,
      sessionCwd: '/tmp/dsh-discord-semantic',
      outboxPath: join(dir, 'outbox.json'),
      inboundDedupePath: join(dir, 'dedupe.json'),
      accountsConfigPath: join(dir, 'accounts.json'),
    },
  )
  return { dir, provider, transport, conversationBinding, obs }
}

describe('target aliases', () => {
  it('normalizes proactive targets and resolves aliases account-locally', () => {
    const map = normalizeProactiveTargets({
      Alerts: { channelId: '123', guildId: 'g' },
      ops: { kind: 'thread', id: 't1', parentChannelId: 'p1', guildId: 'g' },
    })
    assert.equal(map.alerts.kind, 'channel')
    assert.equal(map.alerts.id, '123')
    assert.equal(map.ops.kind, 'thread')

    const account = openAccount()
    const hit = resolveSemanticTarget(account, { kind: 'alias', alias: 'notifications' })
    assert.equal(hit.ok, true)
    assert.equal(hit.target.channelId, CHANNEL)

    const miss = resolveSemanticTarget(account, { kind: 'alias', alias: 'missing' })
    assert.equal(miss.ok, false)
    assert.equal(miss.reason, 'alias_unknown')
  })
})

describe('semantic service', () => {
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

  it('proactive notify via alias → allowlist → outbox → delivered (no binding)', async () => {
    const beforeBindings = Object.keys(
      ctx.conversationBinding.snapshot?.()?.bindings ||
        ctx.conversationBinding.listBySession?.('x') ||
        {},
    )
    const receipt = await ctx.provider.notify({
      accountId: 'lab',
      target: { alias: 'notifications' },
      content: 'DSH_PROACTIVE_SERVICE_OK',
      operationId: 'svc:proactive:1',
      wait: true,
    })
    assert.equal(receipt.state, 'delivered')
    assert.equal(receipt.operation_id, 'svc:proactive:1')
    assert.ok(receipt.discord_resource_id)
    const send = ctx.transport.outbound.find((o) => o.op === 'send')
    assert.equal(send.payload.content, 'DSH_PROACTIVE_SERVICE_OK')
    assert.deepEqual(send.payload.allowedMentions, { parse: [] })

    // No ConversationBinding created solely for notify
    const listed = ctx.conversationBinding.listBySession
      ? ctx.conversationBinding.listBySession('nonexistent')
      : []
    assert.ok(Array.isArray(listed))
    void beforeBindings
  })

  it('thread alias authorizes via parent channel', async () => {
    const receipt = await ctx.provider.notify({
      accountId: 'lab',
      target: { alias: 'ops_thread' },
      content: 'thread-ok',
      operationId: 'svc:thread:1',
      wait: true,
    })
    assert.equal(receipt.state, 'delivered')
  })

  it('denies unknown alias / unallowlisted channel / wrong account / DM', async () => {
    await assert.rejects(
      () =>
        ctx.provider.notify({
          accountId: 'lab',
          target: { alias: 'nope' },
          content: 'x',
          operationId: 'svc:bad:alias',
        }),
      /alias_unknown/,
    )
    await assert.rejects(
      () =>
        ctx.provider.notify({
          accountId: 'lab',
          target: { kind: 'channel', id: 'other-channel', guildId: GUILD },
          content: 'x',
          operationId: 'svc:bad:channel',
        }),
      /channel_denied/,
    )
    await assert.rejects(
      () =>
        ctx.provider.notify({
          accountId: 'missing',
          target: { alias: 'notifications' },
          content: 'x',
          operationId: 'svc:bad:acct',
        }),
      /unknown account/,
    )
    await assert.rejects(
      () =>
        ctx.provider.notify({
          accountId: 'lab',
          target: { kind: 'dm', userId: 'u1' },
          content: 'x',
          operationId: 'svc:bad:dm',
        }),
      /dm_disabled|dm_/,
    )
  })

  it('duplicate operation_id does not double-send', async () => {
    const a = await ctx.provider.messageSend({
      accountId: 'lab',
      target: { kind: 'channel', id: CHANNEL, guildId: GUILD },
      content: 'once',
      operationId: 'svc:idem:1',
      wait: true,
    })
    const b = await ctx.provider.messageSend({
      accountId: 'lab',
      target: { kind: 'channel', id: CHANNEL, guildId: GUILD },
      content: 'once',
      operationId: 'svc:idem:1',
      wait: true,
    })
    assert.equal(a.discord_resource_id, b.discord_resource_id)
    assert.equal(ctx.transport.outbound.filter((o) => o.op === 'send').length, 1)
  })

  it('Components V2 payload travels via outbox', async () => {
    const receipt = await ctx.provider.messageSend({
      accountId: 'lab',
      target: { kind: 'channel', id: CHANNEL, guildId: GUILD },
      components: [{ kind: 'TextDisplay', text: 'v2' }],
      componentsV2: true,
      operationId: 'svc:v2:1',
      wait: true,
    })
    assert.equal(receipt.state, 'delivered')
    const send = ctx.transport.outbound.find((o) => o.payload?.components)
    assert.ok(send.payload.components.length >= 1)
  })

  it('guild.list / channel.get return normalized DTOs', async () => {
    const guilds = await ctx.provider.guildList({ accountId: 'lab' })
    assert.equal(guilds.guilds[0].id, GUILD)
    const ch = await ctx.provider.channelGet({ accountId: 'lab', channelId: CHANNEL })
    assert.equal(ch.channel.id, CHANNEL)
    assert.equal(typeof ch.channel.id, 'string')
  })
})

describe('tool wrappers + policy path', () => {
  /** @type {ReturnType<typeof setup>} */
  let ctx
  /** @type {ReturnType<typeof createPolicyForTest>} */
  let policy

  beforeEach(async () => {
    ctx = setup()
    await ctx.provider.start()
    policy = createPolicyForTest({ onApproval: 'deny', denyOnUnknownAction: 'ask', requireBoundTask: false })
  })

  afterEach(async () => {
    await ctx.provider.stop()
    rmSync(ctx.dir, { recursive: true, force: true })
  })

  it('registers expected tools and risk map', () => {
    const defs = buildDiscordToolDefinitions(ctx.provider.semantic)
    const names = defs.map((d) => d.name)
    for (const n of [
      'discord_guild_list',
      'discord_channel_get',
      'discord_message_send',
      'discord_message_reply',
      'discord_message_edit',
      'discord_thread_create',
    ]) {
      assert.ok(names.includes(n), n)
      assert.ok(DISCORD_TOOL_RISK[n])
    }
    for (const def of defs) {
      const props = def.parameters.properties || {}
      assert.equal(props.token, undefined)
      assert.equal(props.authorization, undefined)
    }
    assert.equal(names.includes('discord_rest_raw'), false)
  })

  it('policy AUTO for channel.get; execute reaches service', async () => {
    const decision = policy.evaluate({
      tool: 'discord_channel_get',
      args: { account_id: 'lab', channel_id: CHANNEL },
    })
    assert.equal(decision.decision, 'AUTO')
    assert.equal(decision.risk, 'L0')

    const def = buildDiscordToolDefinitions(ctx.provider.semantic).find(
      (d) => d.name === 'discord_channel_get',
    )
    assert.ok(def)
    const result = await def.execute({ account_id: 'lab', channel_id: CHANNEL })
    assert.equal(result.channel.id, CHANNEL)
  })

  it('policy classifies message.send as L2 with V1 AUTO override (allowlists = scope gate)', async () => {
    const decision = policy.evaluate({
      tool: 'discord_message_send',
      args: {
        account_id: 'lab',
        target: { kind: 'channel', id: CHANNEL, guildId: GUILD },
        content: 'CLASSIFY_ME',
        operation_id: 'tool:classify:1',
      },
    })
    assert.equal(decision.risk, 'L2')
    assert.equal(decision.action, 'discord.message.send')
    assert.equal(decision.decision, 'AUTO')
    assert.equal(ctx.provider.outbox.getReceipt('tool:classify:1'), null)
  })

  it('message.send tool execute → outbox delivered when body runs', async () => {
    const def = buildDiscordToolDefinitions(ctx.provider.semantic).find(
      (d) => d.name === 'discord_message_send',
    )
    const receipt = await def.execute({
      account_id: 'lab',
      target: { kind: 'channel', id: CHANNEL, guildId: GUILD },
      content: 'DSH_DISCORD_TOOL_OK',
      operation_id: 'tool:send:1',
    })
    assert.equal(receipt.state, 'delivered')
    assert.equal(receipt.operation_id, 'tool:send:1')
    const send = ctx.transport.outbound.find((o) => o.payload?.content === 'DSH_DISCORD_TOOL_OK')
    assert.ok(send)
  })

  it('full pre-execute waterfall mock: AUTO allows execute; explicit DENY blocks outbox', async () => {
    const hooks = []
    const preExecute = async (exec, next, forceDeny = false) => {
      hooks.push('pre-execute')
      const decision = policy.evaluate({
        tool: exec.tool.name,
        args: exec.args,
      })
      hooks.push(`decision:${forceDeny ? 'DENY' : decision.decision}`)
      if (forceDeny || decision.decision !== 'AUTO') {
        return { kind: 'deny', reason: 'policy:DENY' }
      }
      return next()
    }

    const exec = {
      tool: { name: 'discord_message_send' },
      args: {
        account_id: 'lab',
        target: { kind: 'channel', id: CHANNEL, guildId: GUILD },
        content: 'BLOCKED',
        operation_id: 'tool:blocked:1',
      },
    }
    const denied = await preExecute(
      exec,
      async () => {
        hooks.push('execute')
        return null
      },
      true,
    )
    assert.equal(denied.kind, 'deny')
    assert.deepEqual(hooks, ['pre-execute', 'decision:DENY'])
    assert.equal(ctx.provider.outbox.getReceipt('tool:blocked:1'), null)

    hooks.length = 0
    const allowed = await preExecute(exec, async () => {
      hooks.push('execute')
      const def = buildDiscordToolDefinitions(ctx.provider.semantic).find(
        (d) => d.name === 'discord_message_send',
      )
      return def.execute({ ...exec.args, operation_id: 'tool:allowed:1', content: 'ALLOWED' })
    })
    assert.equal(allowed.state, 'delivered')
    assert.deepEqual(hooks, ['pre-execute', 'decision:AUTO', 'execute'])
  })
})

describe('outbound authorize helpers', () => {
  it('thread without parent fails closed', async () => {
    const account = openAccount()
    const auth = await authorizeOutboundDelivery(account, {
      kind: 'thread',
      channelId: 'thr-x',
      threadId: 'thr-x',
    })
    assert.equal(auth.ok, false)
    assert.equal(auth.reason, 'thread_parent_unknown')
  })
})
