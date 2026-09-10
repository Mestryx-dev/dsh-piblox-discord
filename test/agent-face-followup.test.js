import assert from 'node:assert/strict'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createConversationBindingForTest } from '../../dsh-conversation-binding/src/index.js'
import { createDiscordProvider } from '../src/index.js'
import { FakeTransport } from '../src/transport/fake.js'
import { createDeterministicAgents } from './helpers/deterministic-agents.js'
import { createMockAgentPresets } from './helpers/mock-agent-presets.js'
import {
  resolveAgentFace,
  buildDiscordCreateAgentExtras,
} from '../src/bridge.js'
import { FakeClock } from '../src/clock.js'

function setup(accounts, extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-discord-agentface-'))
  const conversationBinding = createConversationBindingForTest({
    storePath: join(dir, 'bindings.json'),
  })
  const agents = createDeterministicAgents(extra.agentsOpts || {})
  const agentPresets = extra.agentPresets || createMockAgentPresets(['standard', 'vega', 'minimal'])
  const transport = new FakeTransport()
  const clock = extra.clock || new FakeClock(1_000_000)
  const provider = createDiscordProvider(
    {
      conversationBinding,
      agents,
      transport,
      clock,
      agentPresets,
      onSessionEvent: (sessionId, listener) =>
        agents.onEvent((sid, event) => {
          if (String(sid) === String(sessionId)) return listener({ id: sid }, event)
        }),
      agentDefaultModel: extra.agentDefaultModel,
      sessionCwd: extra.sessionCwd || '/tmp/dsh-discord-test-cwd',
      dispatchTimeoutMs: extra.dispatchTimeoutMs,
    },
    {
      accounts,
      outboxPath: join(dir, 'outbox.json'),
      inboundDedupePath: join(dir, 'inbound-dedupe.json'),
      accountsConfigPath: join(dir, 'discord-accounts.json'),
      sessionCwd: extra.sessionCwd || '/tmp/dsh-discord-test-cwd',
      dispatchTimeoutMs: extra.dispatchTimeoutMs,
      inboundDedupeTtlMs: extra.inboundDedupeTtlMs ?? 60_000,
      inboundDedupeLeaseMs: extra.inboundDedupeLeaseMs ?? 5_000,
    },
  )
  return { dir, conversationBinding, agents, agentPresets, transport, provider, clock }
}

const LAB = {
  lab: {
    enabled: true,
    agentPreset: 'standard',
    allowAllGuilds: false,
    allowedGuilds: ['g1'],
    allowAllChannels: false,
    allowedChannels: ['c1'],
    allowAllUsers: false,
    allowedUsers: ['u1'],
    ignoreBots: true,
    dm: { enabled: false },
  },
}

function bindingSessionId(dir) {
  const store = JSON.parse(readFileSync(join(dir, 'bindings.json'), 'utf8'))
  const first = Object.values(store.bindings || {})[0]
  return first?.session_id || null
}

describe('resolveAgentFace (real DSH contract)', () => {
  it('prefers owned Handle.agent over get()', () => {
    const agent = { followup() {} }
    const handle = { agent }
    const fromGet = { followup() {} }
    const r = resolveAgentFace(handle, fromGet)
    assert.equal(r.agent, agent)
    assert.equal(r.handle, handle)
  })

  it('accepts bare Agent from agents.get (real registry)', () => {
    const agent = { followup() {} }
    const r = resolveAgentFace(null, agent)
    assert.equal(r.agent, agent)
    assert.equal(r.handle, null)
  })

  it('rejects objects without followup', () => {
    const bare = { id: 'x' }
    const r = resolveAgentFace(null, bare)
    assert.equal(r.agent, null)
  })
})

describe('buildDiscordCreateAgentExtras', () => {
  it('sets cwd + agentOptions from default model', () => {
    const extras = buildDiscordCreateAgentExtras({
      sessionCwd: '/tmp/ws',
      agentDefaultModel: {
        currentSelection: () => ({ provider: 'p', model: 'm' }),
      },
    })
    assert.equal(extras.meta.cwd, '/tmp/ws')
    assert.deepEqual(extras.agentOptions, { provider: 'p', model: 'm' })
    assert.equal(typeof extras.setup, 'function')
  })
})

describe('Agent face regression — get returns bare Agent', () => {
  /** @type {ReturnType<typeof setup>} */
  let ctx

  beforeEach(async () => {
    ctx = setup(LAB)
    await ctx.provider.start()
    await ctx.transport.startAccount('lab')
  })

  afterEach(async () => {
    await ctx.provider.stop()
    rmSync(ctx.dir, { recursive: true, force: true })
  })

  it('followup starts a turn when agents.get returns bare Agent', async () => {
    await ctx.transport.injectMessage({
      accountId: 'lab',
      guildId: 'g1',
      channelId: 'c1',
      userId: 'u1',
      messageId: 'm-agentface-1',
      content: 'reply exactly: HELLO_AGENTFACE',
      isBot: false,
      isDm: false,
    })

    const sessionId = bindingSessionId(ctx.dir)
    assert.ok(sessionId?.startsWith('discord-'))

    // Real contract: get → Agent, not Handle
    const live = ctx.agents.get(sessionId)
    assert.ok(live)
    assert.equal(typeof live.followup, 'function')
    assert.equal(live.agent, undefined)

    const outbound = ctx.transport.outbound.filter((o) => o.accountId === 'lab')
    assert.ok(outbound.length >= 1)
    const body = outbound.map((o) => o.body?.content || o.payload?.content || '').join(' ')
    assert.match(body, /HELLO_AGENTFACE/)

    const dedupe = JSON.parse(readFileSync(join(ctx.dir, 'inbound-dedupe.json'), 'utf8'))
    assert.equal(dedupe.claims['lab:m-agentface-1'].state, 'completed')
  })

  it('reuses binding + same session on second message', async () => {
    await ctx.transport.injectMessage({
      accountId: 'lab',
      guildId: 'g1',
      channelId: 'c1',
      userId: 'u1',
      messageId: 'm-reuse-1',
      content: 'reply exactly: ONE',
      isBot: false,
      isDm: false,
    })
    const sid1 = bindingSessionId(ctx.dir)
    await ctx.transport.injectMessage({
      accountId: 'lab',
      guildId: 'g1',
      channelId: 'c1',
      userId: 'u1',
      messageId: 'm-reuse-2',
      content: 'reply exactly: TWO',
      isBot: false,
      isDm: false,
    })
    const sid2 = bindingSessionId(ctx.dir)
    assert.equal(sid1, sid2)
  })

  it('followup failure leaves claim claimed; in-lease duplicate; expired lease reclaimable', async () => {
    const clock = new FakeClock(2_000_000)
    const failCtx = setup(LAB, {
      clock,
      inboundDedupeLeaseMs: 1_000,
      agentsOpts: { failFollowup: 'boom-followup' },
    })
    await failCtx.provider.start()
    await failCtx.transport.startAccount('lab')

    await assert.rejects(
      () =>
        failCtx.transport.injectMessage({
          accountId: 'lab',
          guildId: 'g1',
          channelId: 'c1',
          userId: 'u1',
          messageId: 'm-fail-1',
          content: 'hi',
          isBot: false,
          isDm: false,
        }),
      /boom-followup/,
    )

    let dedupe = JSON.parse(readFileSync(join(failCtx.dir, 'inbound-dedupe.json'), 'utf8'))
    assert.equal(dedupe.claims['lab:m-fail-1'].state, 'claimed')
    assert.equal(dedupe.claims['lab:m-fail-1'].session_id, null)

    // In-lease → duplicate (no second followup)
    await failCtx.transport.injectMessage({
      accountId: 'lab',
      guildId: 'g1',
      channelId: 'c1',
      userId: 'u1',
      messageId: 'm-fail-1',
      content: 'hi',
      isBot: false,
      isDm: false,
    })
    dedupe = JSON.parse(readFileSync(join(failCtx.dir, 'inbound-dedupe.json'), 'utf8'))
    assert.equal(dedupe.claims['lab:m-fail-1'].state, 'claimed')

    // Expire lease → reclaim allowed with a succeeding agent
    clock.advance(2_000)
    await failCtx.provider.stop()

    const okCtx = setup(LAB, {
      clock,
      inboundDedupeLeaseMs: 1_000,
      // reuse same ledger files
    })
    // Re-point stores by copying is hard — instead mutate fail agents to succeed on remint
    // Use same dir by constructing provider against failCtx paths:
    const reclaimAgents = createDeterministicAgents()
    const reclaimProvider = createDiscordProvider(
      {
        conversationBinding: failCtx.conversationBinding,
        agents: reclaimAgents,
        transport: failCtx.transport,
        clock,
        agentPresets: createMockAgentPresets(['standard', 'vega', 'minimal']),
        onSessionEvent: (sessionId, listener) =>
          reclaimAgents.onEvent((sid, event) => {
            if (String(sid) === String(sessionId)) return listener({ id: sid }, event)
          }),
      },
      {
        accounts: LAB,
        sessionCwd: '/tmp/dsh-discord-test-cwd',
        outboxPath: join(failCtx.dir, 'outbox.json'),
        inboundDedupePath: join(failCtx.dir, 'inbound-dedupe.json'),
        accountsConfigPath: join(failCtx.dir, 'discord-accounts.json'),
        inboundDedupeLeaseMs: 1_000,
      },
    )
    await reclaimProvider.start()
    await failCtx.transport.startAccount('lab')
    await failCtx.transport.injectMessage({
      accountId: 'lab',
      guildId: 'g1',
      channelId: 'c1',
      userId: 'u1',
      messageId: 'm-fail-1',
      content: 'reply exactly: RECLAIMED',
      isBot: false,
      isDm: false,
    })
    dedupe = JSON.parse(readFileSync(join(failCtx.dir, 'inbound-dedupe.json'), 'utf8'))
    assert.equal(dedupe.claims['lab:m-fail-1'].state, 'completed')
    const body = failCtx.transport.outbound.map((o) => o.body?.content || o.payload?.content || '').join(' ')
    assert.match(body, /RECLAIMED/)

    await reclaimProvider.stop()
    rmSync(failCtx.dir, { recursive: true, force: true })
  })

  it('dispatch timeout leaves claim claimed (not completed)', async () => {
    const clock = new FakeClock(3_000_000)
    const hangCtx = setup(LAB, {
      clock,
      dispatchTimeoutMs: 50,
      inboundDedupeLeaseMs: 10_000,
      agentsOpts: { hangFollowupMs: 500 },
    })
    await hangCtx.provider.start()
    await hangCtx.transport.startAccount('lab')

    await assert.rejects(
      () =>
        hangCtx.transport.injectMessage({
          accountId: 'lab',
          guildId: 'g1',
          channelId: 'c1',
          userId: 'u1',
          messageId: 'm-hang-1',
          content: 'hi',
          isBot: false,
          isDm: false,
        }),
      /dispatch timeout/,
    )

    const dedupe = JSON.parse(readFileSync(join(hangCtx.dir, 'inbound-dedupe.json'), 'utf8'))
    assert.equal(dedupe.claims['lab:m-hang-1'].state, 'claimed')
    assert.equal(dedupe.claims['lab:m-hang-1'].session_id, null)

    await hangCtx.provider.stop()
    rmSync(hangCtx.dir, { recursive: true, force: true })
  })

  it('passes sessionCwd + agentOptions into agents.create', async () => {
    const modelCtx = setup(LAB, {
      sessionCwd: '/tmp/discord-lab-ws',
      agentDefaultModel: {
        currentSelection: () => ({ provider: 'fixture', model: 'fixture-model' }),
      },
    })
    await modelCtx.provider.start()
    await modelCtx.transport.startAccount('lab')
    await modelCtx.transport.injectMessage({
      accountId: 'lab',
      guildId: 'g1',
      channelId: 'c1',
      userId: 'u1',
      messageId: 'm-cwd-1',
      content: 'reply exactly: OK',
      isBot: false,
      isDm: false,
    })
    const sessionId = bindingSessionId(modelCtx.dir)
    const agent = modelCtx.agents.get(sessionId)
    assert.equal(agent.__createMeta?.cwd, '/tmp/discord-lab-ws')
    assert.deepEqual(agent.__agentOptions, { provider: 'fixture', model: 'fixture-model' })
    await modelCtx.provider.stop()
    rmSync(modelCtx.dir, { recursive: true, force: true })
  })

  it('remints when live agent lacks cwd but sessionCwd is configured', async () => {
    const remintPresets = createMockAgentPresets(['standard', 'vega', 'minimal'])
    const remintCtx = setup(LAB, {
      sessionCwd: '/tmp/discord-remint-ws',
      agentPresets: remintPresets,
    })
    await remintCtx.provider.start()
    await remintCtx.transport.startAccount('lab')
    await remintCtx.transport.injectMessage({
      accountId: 'lab',
      guildId: 'g1',
      channelId: 'c1',
      userId: 'u1',
      messageId: 'm-legacy-1',
      content: 'reply exactly: LEGACY',
      isBot: false,
      isDm: false,
    })
    const legacySid = bindingSessionId(remintCtx.dir)
    assert.ok(legacySid)
    // Simulate real DSH agent with session.header without cwd (legacy mint)
    const legacyAgent = remintCtx.agents.get(legacySid)
    legacyAgent.session = { id: legacySid, header: { id: legacySid } }

    await remintCtx.transport.injectMessage({
      accountId: 'lab',
      guildId: 'g1',
      channelId: 'c1',
      userId: 'u1',
      messageId: 'm-remint-1',
      content: 'reply exactly: REMINTED',
      isBot: false,
      isDm: false,
    })
    const newSid = bindingSessionId(remintCtx.dir)
    assert.notEqual(newSid, legacySid)
    const newAgent = remintCtx.agents.get(newSid)
    assert.equal(newAgent.__createMeta?.cwd, '/tmp/discord-remint-ws')
    assert.equal(newAgent.__createMeta?.agentPreset, 'standard')
    const body = remintCtx.transport.outbound.map((o) => o.payload?.content || '').join(' ')
    assert.match(body, /REMINTED/)
    await remintCtx.provider.stop()
    rmSync(remintCtx.dir, { recursive: true, force: true })
  })
})
