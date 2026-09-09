import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  normalizeAccountConfig,
  normalizePluginConfig,
  authorizeInbound,
} from '../src/config.js'
import { name, inject, createDiscordProvider } from '../src/index.js'
import { FakeTransport } from '../src/transport/fake.js'
import { createDeterministicAgents } from './helpers/deterministic-agents.js'
import { createConversationBindingForTest } from '../../dsh-conversation-binding/src/index.js'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('plugin lifecycle', () => {
  it('exports Cordis name and inject contract', () => {
    assert.equal(name, 'dsh-piblox-discord')
    assert.deepEqual(inject, ['conversationBinding', 'agents'])
  })

  it('loads and unloads with zero accounts', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-discord-'))
    try {
      const conversationBinding = createConversationBindingForTest({
        storePath: join(dir, 'bindings.json'),
      })
      const agents = createDeterministicAgents()
      const provider = createDiscordProvider(
        { conversationBinding, agents, transport: new FakeTransport() },
        { transport: 'fake', accounts: {}, outboxPath: join(dir, 'outbox.json'), inboundDedupePath: join(dir, 'dedupe.json') },
      )
      await provider.start()
      assert.equal(Object.keys(provider.config.accounts).length, 0)
      await provider.stop()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('starts multiple fake accounts independently', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-discord-'))
    try {
      const conversationBinding = createConversationBindingForTest({
        storePath: join(dir, 'bindings.json'),
      })
      const agents = createDeterministicAgents()
      const transport = new FakeTransport()
      const provider = createDiscordProvider(
        { conversationBinding, agents, transport },
        {
          accounts: {
            account_alpha: {
              enabled: true,
              allowAllGuilds: true,
              allowAllChannels: true,
            },
            account_beta: {
              enabled: true,
              allowAllGuilds: true,
              allowAllChannels: true,
            },
          },
          outboxPath: join(dir, 'outbox.json'),
          inboundDedupePath: join(dir, 'dedupe.json'),
        },
      )
      await provider.start()
      assert.equal(transport.isAccountRunning('account_alpha'), true)
      assert.equal(transport.isAccountRunning('account_beta'), true)
      await provider.stopAccount('account_alpha')
      assert.equal(transport.isAccountRunning('account_alpha'), false)
      assert.equal(transport.isAccountRunning('account_beta'), true)
      await provider.stop()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('config allowlists (LOCKED fail-closed)', () => {
  it('empty allowlists deny all', () => {
    const account = normalizeAccountConfig({})
    assert.equal(authorizeInbound(account, { guildId: 'g1', channelId: 'c1' }).ok, false)
    assert.equal(authorizeInbound(account, { guildId: 'g1', channelId: 'c1' }).reason, 'guilds_deny_all')

    const withGuild = normalizeAccountConfig({ allowedGuilds: ['g1'] })
    assert.equal(authorizeInbound(withGuild, { guildId: 'g1', channelId: 'c1' }).reason, 'channels_deny_all')

    const dm = normalizeAccountConfig({ dm: { enabled: true, allowedUsers: [] } })
    assert.equal(authorizeInbound(dm, { isDm: true, userId: 'u1' }).reason, 'dm_users_deny_all')
  })

  it('explicit wildcard flags enable broad access', () => {
    const account = normalizeAccountConfig({
      allowAllGuilds: true,
      allowAllChannels: true,
      dm: { enabled: true, allowAllUsers: true },
    })
    assert.equal(authorizeInbound(account, { guildId: 'any', channelId: 'any' }).ok, true)
    assert.equal(authorizeInbound(account, { isDm: true, userId: 'any' }).ok, true)
  })

  it('isolates account configs', () => {
    const cfg = normalizePluginConfig({
      accounts: {
        account_alpha: { allowedGuilds: ['g-a'], allowedChannels: ['c-a'] },
        account_beta: { allowedGuilds: ['g-b'], allowedChannels: ['c-b'] },
      },
    })
    assert.equal(
      authorizeInbound(cfg.accounts.account_alpha, { guildId: 'g-a', channelId: 'c-a' }).ok,
      true,
    )
    assert.equal(
      authorizeInbound(cfg.accounts.account_alpha, { guildId: 'g-b', channelId: 'c-b' }).ok,
      false,
    )
    assert.equal(
      authorizeInbound(cfg.accounts.account_beta, { guildId: 'g-b', channelId: 'c-b' }).ok,
      true,
    )
  })

  it('rejects colon in account_id', () => {
    assert.throws(() =>
      normalizePluginConfig({ accounts: { 'bad:id': {} } }),
    )
  })
})
