/**
 * Guild user authorization — distinct from dm.* allowlists.
 * Fail-closed; no Administrator implicit bypass; snowflakes stay strings.
 */
import assert from 'node:assert/strict'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  normalizeAccountConfig,
  authorizeInbound,
  scopeSummary,
  createDiscordProvider,
} from '../src/index.js'
import { createDeterministicAgents } from './helpers/deterministic-agents.js'
import { createMockAgentPresets } from './helpers/mock-agent-presets.js'
import { createConversationBindingForTest } from '../../dsh-conversation-binding/src/index.js'

const SF_G = '123456789012345678'
const SF_C = '234567890123456789'
const SF_U = '345678901234567890'
const SF_U2 = '456789012345678901'

describe('guild user authorization (LOCKED fail-closed)', () => {
  it('empty guild user allowlist denies all after guild+channel pass', () => {
    const account = normalizeAccountConfig({
      allowedGuilds: [SF_G],
      allowedChannels: [SF_C],
      allowAllUsers: false,
      allowedUsers: [],
    })
    const r = authorizeInbound(account, { guildId: SF_G, channelId: SF_C, userId: SF_U })
    assert.equal(r.ok, false)
    assert.equal(r.reason, 'guild_users_deny_all')
  })

  it('explicit allowed user passes; different user denied', () => {
    const account = normalizeAccountConfig({
      allowedGuilds: [SF_G],
      allowedChannels: [SF_C],
      allowedUsers: [SF_U],
    })
    assert.equal(
      authorizeInbound(account, { guildId: SF_G, channelId: SF_C, userId: SF_U }).ok,
      true,
    )
    const denied = authorizeInbound(account, {
      guildId: SF_G,
      channelId: SF_C,
      userId: SF_U2,
    })
    assert.equal(denied.ok, false)
    assert.equal(denied.reason, 'guild_user_denied')
  })

  it('allowAllUsers grants explicit broad guild user access', () => {
    const account = normalizeAccountConfig({
      allowedGuilds: [SF_G],
      allowedChannels: [SF_C],
      allowAllUsers: true,
      allowedUsers: [],
    })
    assert.equal(
      authorizeInbound(account, { guildId: SF_G, channelId: SF_C, userId: '999' }).ok,
      true,
    )
  })

  it('guild and DM user policies are independent', () => {
    const account = normalizeAccountConfig({
      allowedGuilds: [SF_G],
      allowedChannels: [SF_C],
      allowedUsers: [SF_U],
      allowAllUsers: false,
      dm: { enabled: true, allowAllUsers: false, allowedUsers: [SF_U2] },
    })
    assert.equal(
      authorizeInbound(account, { guildId: SF_G, channelId: SF_C, userId: SF_U }).ok,
      true,
    )
    assert.equal(
      authorizeInbound(account, { guildId: SF_G, channelId: SF_C, userId: SF_U2 }).ok,
      false,
    )
    assert.equal(authorizeInbound(account, { isDm: true, userId: SF_U2 }).ok, true)
    assert.equal(authorizeInbound(account, { isDm: true, userId: SF_U }).ok, false)
  })

  it('keeps Discord user IDs as strings (no Number coercion)', () => {
    const account = normalizeAccountConfig({
      allowedGuilds: [SF_G],
      allowedChannels: [SF_C],
      allowedUsers: [SF_U],
    })
    assert.equal(typeof account.allowedUsers[0], 'string')
    assert.equal(account.allowedUsers[0], SF_U)
    assert.deepEqual(scopeSummary(account).users, '1')
  })

  it('has no Administrator / permission-bit bypass', () => {
    const account = normalizeAccountConfig({
      allowedGuilds: [SF_G],
      allowedChannels: [SF_C],
      allowedUsers: [SF_U],
      // Noise that must never open access even if present on the object
      administrator: true,
      permissions: '8',
      isAdmin: true,
    })
    assert.equal(
      authorizeInbound(account, { guildId: SF_G, channelId: SF_C, userId: SF_U2 }).reason,
      'guild_user_denied',
    )
  })
})

describe('guild user denial before binding/session/followup', () => {
  /** @type {any} */
  let provider
  /** @type {string} */
  let dir
  /** @type {any} */
  let transport
  /** @type {any} */
  let binding

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'dsh-discord-guild-user-'))
    binding = createConversationBindingForTest({ storePath: join(dir, 'bindings.json') })
    const agents = createDeterministicAgents()
    provider = createDiscordProvider(
      {
        conversationBinding: binding,
        agents,
        agentPresets: createMockAgentPresets(['standard']),
        logger: { info() {}, warn() {}, debug() {} },
      },
      {
        transport: 'fake',
        allowConnect: false,
        sessionCwd: '/tmp/dsh-discord-test-cwd',
        accountsConfigPath: join(dir, 'accounts.json'),
        outboxPath: join(dir, 'outbox.json'),
        inboundDedupePath: join(dir, 'dedupe.json'),
        accounts: {
          lab: {
            enabled: true,
            agentPreset: 'standard',
            allowedGuilds: [SF_G],
            allowedChannels: [SF_C],
            allowedUsers: [SF_U],
            allowAllUsers: false,
            dm: { enabled: false },
            ignoreBots: true,
          },
        },
      },
    )
    transport = provider.transport
    await provider.start()
  })

  afterEach(async () => {
    await provider.stop()
    rmSync(dir, { recursive: true, force: true })
  })

  it('denied user never claims dedupe / binding / outbound', async () => {
    const denied = await provider.bridge.handleInbound({
      type: 'discord.message.created',
      accountId: 'lab',
      channelId: SF_C,
      guildId: SF_G,
      userId: SF_U2,
      messageId: 'm-deny',
      content: 'should not run',
      eventId: 'e-deny',
    })
    assert.equal(denied.ok, false)
    assert.equal(denied.reason, 'guild_user_denied')
    assert.equal(Object.keys(binding.dump().bindings).length, 0)
    assert.equal(transport.outbound.length, 0)
    assert.equal(Object.keys(provider.inboundDedupe.snapshot().claims || {}).length, 0)

    const allowed = await provider.bridge.handleInbound({
      type: 'discord.message.created',
      accountId: 'lab',
      channelId: SF_C,
      guildId: SF_G,
      userId: SF_U,
      messageId: 'm-ok',
      content: 'hello from allowed guild user',
      eventId: 'e-ok',
    })
    assert.equal(allowed.ok, true)
    assert.ok(Object.keys(binding.dump().bindings).length >= 1)
    assert.ok(Object.keys(provider.inboundDedupe.snapshot().claims || {}).length >= 1)
  })
})
