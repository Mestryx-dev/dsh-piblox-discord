/**
 * Discord account → DSH agentPreset contract (webhook-parity, fail-closed).
 */
import assert from 'node:assert/strict'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createConversationBindingForTest } from '../../dsh-conversation-binding/src/index.js'
import { createDiscordProvider, prepareDiscordSessionCreate, normalizeAccountConfig } from '../src/index.js'
import { FakeTransport } from '../src/transport/fake.js'
import { createDeterministicAgents } from './helpers/deterministic-agents.js'
import { createMockAgentPresets } from './helpers/mock-agent-presets.js'

const CWD = '/tmp/dsh-discord-agent-preset-cwd'

function setup(accounts, extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-discord-agent-preset-'))
  const conversationBinding = createConversationBindingForTest({
    storePath: join(dir, 'bindings.json'),
  })
  const agents = createDeterministicAgents()
  const agentPresets = extra.agentPresets || createMockAgentPresets(['standard', 'vega', 'minimal', 'coder'])
  const transport = new FakeTransport()
  const provider = createDiscordProvider(
    {
      conversationBinding,
      agents,
      transport,
      agentPresets,
      agentDefaultModel: extra.agentDefaultModel,
      onSessionEvent: (sessionId, listener) =>
        agents.onEvent((sid, event) => {
          if (String(sid) === String(sessionId)) return listener({ id: sid }, event)
        }),
    },
    {
      accounts,
      sessionCwd: extra.sessionCwd ?? CWD,
      outboxPath: join(dir, 'outbox.json'),
      inboundDedupePath: join(dir, 'inbound-dedupe.json'),
      accountsConfigPath: join(dir, 'discord-accounts.json'),
    },
  )
  return { dir, conversationBinding, agents, agentPresets, transport, provider }
}

function baseAccount(overrides = {}) {
  return {
    enabled: true,
    agentPreset: 'standard',
    allowAllGuilds: true,
    allowAllChannels: true,
    allowAllUsers: true,
    ignoreBots: true,
    dm: { enabled: false },
    ...overrides,
  }
}

describe('prepareDiscordSessionCreate', () => {
  it('builds webhook-parity meta.agentPreset + mount setup', async () => {
    const agentPresets = createMockAgentPresets(['vega'])
    const prep = await prepareDiscordSessionCreate({
      account: { agentPreset: 'vega' },
      sessionCwd: CWD,
      agentPresets,
      agentDefaultModel: {
        currentSelection: () => ({ provider: 'openrouter', model: 'test-model' }),
      },
    })
    assert.equal(prep.ok, true)
    assert.equal(prep.presetId, 'vega')
    assert.deepEqual(prep.createOptions.meta, { cwd: CWD, agentPreset: 'vega' })
    assert.deepEqual(prep.createOptions.agentOptions, {
      provider: 'openrouter',
      model: 'test-model',
    })
    await prep.createOptions.setup({ agent: { id: 'x' }, on() {} })
    assert.equal(agentPresets.mounts.length, 1)
    assert.equal(agentPresets.mounts[0].id, 'vega')
  })

  it('fails closed when agentPreset missing', async () => {
    const prep = await prepareDiscordSessionCreate({
      account: {},
      sessionCwd: CWD,
      agentPresets: createMockAgentPresets(['standard']),
    })
    assert.equal(prep.ok, false)
    assert.equal(prep.reason, 'agent_preset_required')
  })

  it('fails closed when agentPreset unknown', async () => {
    const prep = await prepareDiscordSessionCreate({
      account: { agentPreset: 'nope' },
      sessionCwd: CWD,
      agentPresets: createMockAgentPresets(['standard']),
    })
    assert.equal(prep.ok, false)
    assert.equal(prep.reason, 'agent_preset_invalid')
  })
})

describe('Discord account agentPreset wiring', () => {
  /** @type {ReturnType<typeof setup>} */
  let ctx

  afterEach(async () => {
    if (ctx) {
      await ctx.provider.stop()
      rmSync(ctx.dir, { recursive: true, force: true })
      ctx = null
    }
  })

  it('creates session with assigned agentPreset config', async () => {
    ctx = setup({ lab: baseAccount({ agentPreset: 'vega' }) })
    await ctx.provider.start()
    await ctx.transport.startAccount('lab')
    await ctx.transport.injectMessage({
      accountId: 'lab',
      guildId: 'g1',
      channelId: 'c1',
      userId: 'u1',
      messageId: 'm1',
      content: 'reply exactly: PRESET_OK',
      isBot: false,
    })
    const sid = Object.values(ctx.conversationBinding.dump().bindings)[0].session_id
    const agent = ctx.agents.get(sid)
    assert.equal(agent.__createMeta.agentPreset, 'vega')
    assert.equal(agent.__createMeta.cwd, CWD)
    assert.ok(ctx.agentPresets.mounts.some((m) => m.id === 'vega'))
    assert.match(
      ctx.transport.outbound.map((o) => o.payload?.content || '').join(' '),
      /PRESET_OK/,
    )
  })

  it('missing agent assignment fails closed (no session mint)', async () => {
    ctx = setup({ lab: baseAccount({ agentPreset: undefined }) })
    // normalize drops undefined — force clear after boot
    ctx.provider.bridge.accounts.lab.agentPreset = undefined
    await ctx.provider.start()
    await ctx.transport.startAccount('lab')
    const result = await ctx.provider.bridge.handleInbound({
      type: 'discord.message.created',
      accountId: 'lab',
      guildId: 'g1',
      channelId: 'c1',
      userId: 'u1',
      messageId: 'm-missing',
      content: 'hi',
      isBot: false,
    })
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'agent_preset_required')
    assert.equal(Object.keys(ctx.conversationBinding.dump().bindings).length, 0)
    assert.equal(ctx.transport.outbound.length, 0)
  })

  it('invalid agent assignment fails closed', async () => {
    ctx = setup(
      { lab: baseAccount({ agentPreset: 'ghost' }) },
      { agentPresets: createMockAgentPresets(['standard', 'vega']) },
    )
    // Bypass normalize reject by patching live account after start seed
    await ctx.provider.start()
    ctx.provider.bridge.accounts.lab.agentPreset = 'ghost'
    await ctx.transport.startAccount('lab')
    const result = await ctx.provider.bridge.handleInbound({
      type: 'discord.message.created',
      accountId: 'lab',
      guildId: 'g1',
      channelId: 'c1',
      userId: 'u1',
      messageId: 'm-invalid',
      content: 'hi',
      isBot: false,
    })
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'agent_preset_invalid')
    assert.equal(Object.keys(ctx.conversationBinding.dump().bindings).length, 0)
  })

  it('existing binding reuses same session', async () => {
    ctx = setup({ lab: baseAccount({ agentPreset: 'standard' }) })
    await ctx.provider.start()
    await ctx.transport.startAccount('lab')
    await ctx.transport.injectMessage({
      accountId: 'lab',
      guildId: 'g1',
      channelId: 'c-reuse',
      userId: 'u1',
      messageId: 'm1',
      content: 'reply exactly: ONE',
      isBot: false,
    })
    const sid1 = Object.values(ctx.conversationBinding.dump().bindings)[0].session_id
    await ctx.transport.injectMessage({
      accountId: 'lab',
      guildId: 'g1',
      channelId: 'c-reuse',
      userId: 'u1',
      messageId: 'm2',
      content: 'reply exactly: TWO',
      isBot: false,
    })
    const sid2 = Object.values(ctx.conversationBinding.dump().bindings)[0].session_id
    assert.equal(sid1, sid2)
    assert.equal(ctx.agents.get(sid1).__createMeta.agentPreset, 'standard')
  })

  it('changing account agentPreset does not alter existing bound session', async () => {
    ctx = setup({ lab: baseAccount({ agentPreset: 'standard' }) })
    await ctx.provider.start()
    await ctx.transport.startAccount('lab')
    await ctx.transport.injectMessage({
      accountId: 'lab',
      guildId: 'g1',
      channelId: 'c-keep',
      userId: 'u1',
      messageId: 'm1',
      content: 'reply exactly: KEEP',
      isBot: false,
    })
    const sid = Object.values(ctx.conversationBinding.dump().bindings)[0].session_id
    assert.equal(ctx.agents.get(sid).__createMeta.agentPreset, 'standard')
    const mountsBefore = ctx.agentPresets.mounts.length

    ctx.provider.bridge.accounts.lab.agentPreset = 'vega'
    await ctx.transport.injectMessage({
      accountId: 'lab',
      guildId: 'g1',
      channelId: 'c-keep',
      userId: 'u1',
      messageId: 'm2',
      content: 'reply exactly: STILL',
      isBot: false,
    })
    const sid2 = Object.values(ctx.conversationBinding.dump().bindings)[0].session_id
    assert.equal(sid2, sid)
    assert.equal(ctx.agents.get(sid).__createMeta.agentPreset, 'standard')
    assert.equal(ctx.agentPresets.mounts.length, mountsBefore)
    assert.match(
      ctx.transport.outbound.map((o) => o.payload?.content || '').join(' '),
      /STILL/,
    )
  })

  it('new binding uses newly assigned agentPreset', async () => {
    ctx = setup({ lab: baseAccount({ agentPreset: 'standard' }) })
    await ctx.provider.start()
    await ctx.transport.startAccount('lab')
    await ctx.transport.injectMessage({
      accountId: 'lab',
      guildId: 'g1',
      channelId: 'c-a',
      userId: 'u1',
      messageId: 'm1',
      content: 'reply exactly: A',
      isBot: false,
    })
    ctx.provider.bridge.accounts.lab.agentPreset = 'coder'
    await ctx.transport.injectMessage({
      accountId: 'lab',
      guildId: 'g1',
      channelId: 'c-b',
      userId: 'u1',
      messageId: 'm2',
      content: 'reply exactly: B',
      isBot: false,
    })
    const bindings = Object.values(ctx.conversationBinding.dump().bindings)
    assert.equal(bindings.length, 2)
    const metas = bindings.map((b) => ctx.agents.get(b.session_id).__createMeta.agentPreset).sort()
    assert.deepEqual(metas, ['coder', 'standard'])
  })

  it('accounts API exposes agentPreset and meta roster', async () => {
    ctx = setup({ lab: baseAccount({ agentPreset: 'vega' }) })
    await ctx.provider.start()
    const listed = await ctx.provider.accounts.list()
    assert.equal(listed.items[0].agentPreset, 'vega')
    const meta = await ctx.provider.accounts.meta()
    assert.equal(meta.agent_presets.enumerated, true)
    assert.ok(meta.agent_presets.items.some((p) => p.id === 'vega'))
  })

  it('Discord plugin has no Vega-specific behavior (generic preset id only)', () => {
    const account = normalizeAccountConfig({ agentPreset: 'vega' })
    assert.equal(account.agentPreset, 'vega')
    // Field is generic agentPreset — not a Vega-only knobs / prompts module.
    assert.equal('agentPreset' in account, true)
    assert.equal('vegaPrompt' in account, false)
    assert.equal('vegaTools' in account, false)
  })
})

describe('ledger assignment shape', () => {
  it('accepts agentPreset on normalize', () => {
    const a = normalizeAccountConfig({ agentPreset: 'vega', allowedGuilds: ['1'] })
    assert.equal(a.agentPreset, 'vega')
  })
})
