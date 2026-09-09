/**
 * Discord configuration plane — accounts CRUD + dsh-piblox-secrets integration.
 * No live Discord / real tokens.
 */
import assert from 'node:assert/strict'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStore } from '../../dsh-piblox-secrets/dist/store/index.js'
import {
  createDiscordProvider,
  createDiscordAccountsService,
  createAccountsConfigStore,
  createDiscordHttpHandlers,
  invokeDiscordHttp,
  credentialSecretName,
  validateAccountId,
  authorizeInbound,
  normalizeAccountConfig,
  INTENT_OPTIONS,
} from '../src/index.js'
import { FakeTransport } from '../src/transport/fake.js'
import { createDeterministicAgents } from './helpers/deterministic-agents.js'
import { createConversationBindingForTest } from '../../dsh-conversation-binding/src/index.js'

const CANARY = 'SUPER_SECRET_DISCORD_CANARY_123'
const SF_G = '123456789012345678'
const SF_C = '234567890123456789'
const SF_U = '345678901234567890'

function assertNoCanary(obj, label) {
  const s = typeof obj === 'string' ? obj : JSON.stringify(obj)
  assert.equal(s.includes(CANARY), false, `canary leaked in ${label}`)
}

describe('secret reference encoding', () => {
  it('maps account_id to UPPER_SNAKE vault name', () => {
    assert.equal(credentialSecretName('lab'), 'DISCORD_LAB_BOT_TOKEN')
    assert.equal(credentialSecretName('infra'), 'DISCORD_INFRA_BOT_TOKEN')
    assert.throws(() => validateAccountId('Bad-Id'))
    assert.throws(() => validateAccountId('has.dot'))
    assert.throws(() => credentialSecretName('x:y'))
  })
})

describe('discord config plane', () => {
  /** @type {string} */
  let dir
  /** @type {ReturnType<typeof createStore>} */
  let store
  /** @type {any} */
  let provider
  /** @type {FakeTransport} */
  let transport
  /** @type {any[]} */
  let logs

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'dsh-discord-cfg-'))
    store = createStore({ dataDir: join(dir, 'secrets') })
    logs = []
    transport = new FakeTransport()
    const conversationBinding = createConversationBindingForTest({
      storePath: join(dir, 'bindings.json'),
    })
    const agents = createDeterministicAgents()
    provider = createDiscordProvider(
      {
        conversationBinding,
        agents,
        transport,
        secrets: { store },
        logger: {
          info: (m) => logs.push(String(m)),
          warn: (m) => logs.push(String(m)),
        },
      },
      {
        accounts: {},
        outboxPath: join(dir, 'outbox.json'),
        inboundDedupePath: join(dir, 'dedupe.json'),
        accountsConfigPath: join(dir, 'accounts.json'),
      },
    )
    await provider.start()
  })

  afterEach(async () => {
    await provider.stop()
    store.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('creates account + token in secrets; config stores only ref', async () => {
    const result = await provider.accounts.create({
      accountId: 'lab',
      token: CANARY,
      label: 'Lab bot',
      enabled: true,
      allowAllGuilds: true,
      allowAllChannels: true,
    })
    assert.equal(result.ok, true)
    assert.equal(result.account.credentials.configured, true)
    assert.equal(result.account.credentials.ref, 'DISCORD_LAB_BOT_TOKEN')
    assertNoCanary(result.account, 'public account')

    const names = await store.listNames()
    assert.ok(names.includes('DISCORD_LAB_BOT_TOKEN'))
    assert.equal(await store.getSecretValue('DISCORD_LAB_BOT_TOKEN'), CANARY)

    const cfgRaw = readFileSync(join(dir, 'accounts.json'), 'utf8')
    assertNoCanary(cfgRaw, 'accounts.json')
    assert.match(cfgRaw, /DISCORD_LAB_BOT_TOKEN/)
    assert.equal(JSON.parse(cfgRaw).accounts.lab.credentials, 'DISCORD_LAB_BOT_TOKEN')
  })

  it('HTTP list/get never returns token', async () => {
    await provider.accounts.create({
      accountId: 'lab',
      token: CANARY,
      allowAllGuilds: true,
      allowAllChannels: true,
    })
    const [route] = createDiscordHttpHandlers({ accounts: provider.accounts })
    const listed = await invokeDiscordHttp(route.handler, {
      method: 'GET',
      path: '/api/discord/accounts',
    })
    assert.equal(listed.status, 200)
    assertNoCanary(listed.raw, 'HTTP list')
    assert.equal(listed.data.items[0].credentials.configured, true)

    const got = await invokeDiscordHttp(route.handler, {
      method: 'GET',
      path: '/api/discord/accounts/lab',
    })
    assertNoCanary(got.raw, 'HTTP get')
  })

  it('rotates token without leaking old/new values in API', async () => {
    await provider.accounts.create({
      accountId: 'lab',
      token: CANARY,
      allowAllGuilds: true,
      allowAllChannels: true,
    })
    const next = 'SUPER_SECRET_DISCORD_CANARY_ROTATED_999'
    const rotated = await provider.accounts.setCredential('lab', next)
    assert.equal(rotated.ok, true)
    assertNoCanary(rotated.account, 'rotated public')
    assert.equal(JSON.stringify(rotated).includes(next), false)
    assert.equal(await store.getSecretValue('DISCORD_LAB_BOT_TOKEN'), next)
  })

  it('removes token → missing_credentials; account remains', async () => {
    await provider.accounts.create({
      accountId: 'lab',
      token: CANARY,
      allowAllGuilds: true,
      allowAllChannels: true,
    })
    const rem = await provider.accounts.removeCredential('lab')
    assert.equal(rem.account.credentials.configured, false)
    assert.equal(rem.account.status, 'missing_credentials')
    assert.ok(provider.config.accounts.lab)
    assert.equal(await store.getSecretValue('DISCORD_LAB_BOT_TOKEN'), null)
    assert.equal(transport.isAccountRunning('lab'), false)
  })

  it('add/edit/enable/disable/delete and rejects duplicate', async () => {
    await provider.accounts.create({
      accountId: 'alpha',
      token: CANARY,
      enabled: true,
      allowedGuilds: [SF_G],
      allowedChannels: [SF_C],
    })
    await assert.rejects(
      () =>
        provider.accounts.create({
          accountId: 'alpha',
          token: 'x',
          allowAllGuilds: true,
          allowAllChannels: true,
        }),
      /already exists/,
    )

    await provider.accounts.update('alpha', { enabled: false, label: 'Alpha' })
    assert.equal((await provider.accounts.get('alpha')).account.enabled, false)
    assert.equal((await provider.accounts.status('alpha')).status, 'disabled')

    await provider.accounts.update('alpha', { enabled: true })
    await provider.accounts.create({
      accountId: 'beta',
      token: 'OTHER_TOKEN_NOT_CANARY',
      allowAllGuilds: true,
      allowAllChannels: true,
    })
    const list = await provider.accounts.list()
    assert.equal(list.items.length, 2)

    await provider.accounts.remove('alpha', { deleteSecret: false })
    assert.equal((await provider.accounts.list()).items.length, 1)
    // Secret retained by policy
    assert.ok((await store.listNames()).includes('DISCORD_ALPHA_BOT_TOKEN'))
  })

  it('two accounts are independent; disable one does not stop the other', async () => {
    await provider.accounts.create({
      accountId: 'alpha',
      token: 'TOKEN_ALPHA',
      allowAllGuilds: true,
      allowAllChannels: true,
    })
    await provider.accounts.create({
      accountId: 'beta',
      token: 'TOKEN_BETA',
      allowAllGuilds: true,
      allowAllChannels: true,
    })
    await provider.startAccount('alpha')
    await provider.startAccount('beta')
    assert.equal(transport.isAccountRunning('alpha'), true)
    assert.equal(transport.isAccountRunning('beta'), true)

    await provider.accounts.update('alpha', { enabled: false })
    assert.equal(transport.isAccountRunning('alpha'), false)
    assert.equal(transport.isAccountRunning('beta'), true)
  })

  it('missing credentials status; remove token does not crash plugin', async () => {
    await provider.accounts.create({
      accountId: 'lab',
      enabled: true,
      allowAllGuilds: true,
      allowAllChannels: true,
    })
    assert.equal((await provider.accounts.status('lab')).status, 'missing_credentials')
    await assert.rejects(() => provider.startAccount('lab'), /missing_credentials/)
  })

  it('canary absent from logs and outbox', async () => {
    await provider.accounts.create({
      accountId: 'lab',
      token: CANARY,
      allowAllGuilds: true,
      allowAllChannels: true,
    })
    assertNoCanary(logs.join('\n'), 'logs')
    if (existsSync(join(dir, 'outbox.json'))) {
      assertNoCanary(readFileSync(join(dir, 'outbox.json'), 'utf8'), 'outbox')
    }
  })

  it('HTTP create + credential delete round-trip', async () => {
    const [route] = createDiscordHttpHandlers({ accounts: provider.accounts })
    const created = await invokeDiscordHttp(route.handler, {
      method: 'POST',
      path: '/api/discord/accounts',
      body: {
        account_id: 'lab',
        token: CANARY,
        allowAllGuilds: true,
        allowAllChannels: true,
      },
    })
    assert.equal(created.status, 201)
    assertNoCanary(created.raw, 'HTTP create')

    const delCred = await invokeDiscordHttp(route.handler, {
      method: 'DELETE',
      path: '/api/discord/accounts/lab/credential',
    })
    assert.equal(delCred.status, 200)
    assert.equal(delCred.data.account.status, 'missing_credentials')
    assertNoCanary(delCred.raw, 'HTTP delete credential')
  })
})

describe('fail-closed allowlists (config plane)', () => {
  it('empty lists deny; allow-all required', () => {
    const closed = normalizeAccountConfig({})
    assert.equal(authorizeInbound(closed, { guildId: SF_G, channelId: SF_C }).ok, false)
    const open = normalizeAccountConfig({
      allowAllGuilds: true,
      allowAllChannels: true,
      dm: { enabled: true, allowAllUsers: true },
    })
    assert.equal(authorizeInbound(open, { guildId: 'x', channelId: 'y' }).ok, true)
    const dmClosed = normalizeAccountConfig({ dm: { enabled: true, allowedUsers: [] } })
    assert.equal(authorizeInbound(dmClosed, { isDm: true, userId: SF_U }).reason, 'dm_users_deny_all')
  })

  it('exposes intent catalog with privileged labels', () => {
    assert.ok(INTENT_OPTIONS.some((i) => i.id === 'MessageContent' && i.privileged))
    assert.ok(INTENT_OPTIONS.some((i) => i.id === 'Guilds' && i.default))
  })
})

describe('client module registration shape', () => {
  it('ships client entry and settings section id discord', async () => {
    const src = readFileSync(new URL('../src/client/index.js', import.meta.url), 'utf8')
    assert.match(src, /settings\.section/)
    assert.match(src, /SECTION_ID = "discord"/)
    assert.match(src, /tokenConfigured/)
    assert.equal(src.includes(CANARY), false)
    // Write-only UX: never shows retrieved token value after save
    assert.doesNotMatch(src, /credentials\.value|token\.slice|last four/i)
  })
})

describe('accounts config store SSOT', () => {
  it('seeds once from boot config', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-discord-seed-'))
    try {
      const store = createAccountsConfigStore({ storePath: join(dir, 'accounts.json') })
      const r1 = await store.seedFromBootConfig({
        accounts: {
          lab: { enabled: true, allowAllGuilds: true, allowAllChannels: true },
        },
      })
      assert.equal(r1.seeded, true)
      const r2 = await store.seedFromBootConfig({
        accounts: { other: { enabled: true } },
      })
      assert.equal(r2.seeded, false)
      assert.ok(store.snapshot().accounts.lab)
      assert.equal(store.snapshot().accounts.other, undefined)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
