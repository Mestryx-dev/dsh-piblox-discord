/**
 * Discord Settings UI polish — pure helpers + client source contracts.
 * No live Discord / real tokens.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { INTENT_OPTIONS } from '../src/intents.js'
import {
  COMMON_INTENT_IDS,
  partitionIntents,
  formatScopeLabel,
  statusTone,
  dmFailClosedSummary,
  publicAccountOmitsCanary,
  displayAccountTitle,
  deleteAccountQuery,
} from '../src/client/ui-model.js'
import {
  createDiscordAccountsService,
  createAccountsConfigStore,
  createDiscordHttpHandlers,
  invokeDiscordHttp,
  authorizeInbound,
  normalizeAccountConfig,
} from '../src/index.js'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CANARY = 'SUPER_SECRET_DISCORD_CANARY_123'
const SF_U = '345678901234567890'

describe('Discord Settings UI model', () => {
  it('partitions common vs advanced intents', () => {
    const { common, advanced } = partitionIntents(INTENT_OPTIONS)
    assert.deepEqual(
      common.map((i) => i.id),
      COMMON_INTENT_IDS,
    )
    assert.ok(advanced.some((i) => i.id === 'GuildMembers'))
    assert.ok(!common.some((i) => i.id === 'GuildMembers'))
    assert.ok(common.find((i) => i.id === 'MessageContent')?.privileged)
  })

  it('formats scope summary labels for account cards', () => {
    assert.equal(formatScopeLabel('guilds', 'deny_all'), 'deny all')
    assert.equal(formatScopeLabel('guilds', 'all'), 'allow all')
    assert.equal(formatScopeLabel('channels', '2'), '2 listed')
    assert.equal(formatScopeLabel('dm', 'disabled'), 'disabled')
    assert.equal(formatScopeLabel('dm', 'deny_all'), 'deny all')
    assert.equal(formatScopeLabel('dm', 'all_users'), 'allow all users')
    assert.equal(formatScopeLabel('dm', '3_users'), '3 users')
  })

  it('maps status tones without inventing connected', () => {
    assert.equal(statusTone('disabled'), 'neutral')
    assert.equal(statusTone('missing_credentials'), 'warning')
    assert.equal(statusTone('connected'), 'done')
    assert.equal(statusTone('failed_auth'), 'error')
  })

  it('DM fail-closed summary: empty users is deny_all when enabled', () => {
    assert.equal(dmFailClosedSummary({ enabled: false }), 'disabled')
    assert.equal(dmFailClosedSummary({ enabled: true, allowAllUsers: false, allowedUsers: [] }), 'deny_all')
    assert.equal(dmFailClosedSummary({ enabled: true, allowAllUsers: true, allowedUsers: [] }), 'allow_all')
    assert.equal(
      dmFailClosedSummary({ enabled: true, allowAllUsers: false, allowedUsers: [SF_U] }),
      'allowlist',
    )
  })

  it('displayAccountTitle strips legacy (no token) without inventing status in title', () => {
    assert.equal(displayAccountTitle({ account_id: 'lab', label: 'Lab' }), 'Lab')
    assert.equal(displayAccountTitle({ account_id: 'lab', label: 'Lab (no token)' }), 'Lab')
    assert.equal(displayAccountTitle({ account_id: 'lab', label: '' }), 'lab')
    assert.doesNotMatch(displayAccountTitle({ account_id: 'lab', label: 'Lab (no token)' }), /\(no token\)/i)
  })

  it('deleteAccountQuery maps checkbox → deleteSecret query', () => {
    assert.equal(deleteAccountQuery(false), '')
    assert.equal(deleteAccountQuery(true), '?deleteSecret=true')
  })
})

describe('DM UI contract via accounts service', () => {
  it('saves dm.enabled + allowAllUsers + allowedUsers; empty remains deny-all', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-discord-dm-ui-'))
    try {
      const names = new Set()
      const secrets = {
        async set(name) {
          names.add(name)
          return { ok: true, name }
        },
        async delete(name) {
          names.delete(name)
          return { ok: true, deleted: true }
        },
        async listNames() {
          return { ok: true, names: [...names] }
        },
        hasKey(name) {
          return names.has(name)
        },
      }
      const configStore = createAccountsConfigStore({ storePath: join(dir, 'accounts.json') })
      await configStore.seedFromBootConfig({ accounts: {} })
      const accounts = createDiscordAccountsService({ configStore, secrets })

      await accounts.create({
        accountId: 'lab',
        enabled: false,
        dm: { enabled: true, allowAllUsers: false, allowedUsers: [] },
      })
      let pub = (await accounts.get('lab')).account
      assert.equal(pub.dm.enabled, true)
      assert.equal(pub.dm.allowAllUsers, false)
      assert.deepEqual(pub.dm.allowedUsers, [])
      assert.equal(pub.scope_summary.dm, 'deny_all')
      assert.equal(publicAccountOmitsCanary(pub, CANARY), true)

      const closed = normalizeAccountConfig({
        dm: { enabled: true, allowAllUsers: false, allowedUsers: [] },
      })
      assert.equal(authorizeInbound(closed, { isDm: true, userId: SF_U }).ok, false)

      await accounts.update('lab', {
        dm: { enabled: true, allowAllUsers: false, allowedUsers: [SF_U] },
      })
      pub = (await accounts.get('lab')).account
      assert.deepEqual(pub.dm.allowedUsers, [SF_U])
      assert.equal(pub.scope_summary.dm, '1_users')

      await accounts.update('lab', {
        dm: { enabled: true, allowAllUsers: true, allowedUsers: [] },
      })
      pub = (await accounts.get('lab')).account
      assert.equal(pub.dm.allowAllUsers, true)
      assert.equal(pub.scope_summary.dm, 'all_users')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('HTTP PATCH persists DM allowlist fields', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-discord-dm-http-'))
    try {
      const names = new Set()
      const secrets = {
        async set(name) {
          names.add(name)
          return { ok: true, name }
        },
        async delete() {
          return { ok: true, deleted: true }
        },
        async listNames() {
          return { ok: true, names: [...names] }
        },
        hasKey: (n) => names.has(n),
      }
      const configStore = createAccountsConfigStore({ storePath: join(dir, 'accounts.json') })
      await configStore.seedFromBootConfig({ accounts: {} })
      const accounts = createDiscordAccountsService({ configStore, secrets })
      await accounts.create({ accountId: 'lab', enabled: false })

      const [route] = createDiscordHttpHandlers({
        accounts,
        adminAuth: { requestRejection: () => undefined },
      })
      const patched = await invokeDiscordHttp(route.handler, {
        method: 'PATCH',
        path: '/api/discord/accounts/lab',
        body: {
          dm: { enabled: true, allowAllUsers: false, allowedUsers: [SF_U] },
        },
      })
      assert.equal(patched.status, 200)
      assert.equal(patched.data.account.dm.enabled, true)
      assert.deepEqual(patched.data.account.dm.allowedUsers, [SF_U])
      assert.equal(JSON.stringify(patched.data).includes(CANARY), false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('client module registration shape', () => {
  it('ships polished Settings UI contracts', () => {
    const src = readFileSync(new URL('../src/client/index.js', import.meta.url), 'utf8')
    assert.match(src, /settings\.section/)
    assert.match(src, /SECTION_ID = "discord"/)
    assert.match(src, /sectionDm|sectionGuilds|sectionChannels|sectionTargets/)
    assert.match(src, /allowAllUsers/)
    assert.match(src, /dmUsers|Allowed DM user/)
    assert.match(src, /emptyDenyAll|Empty list = deny all/)
    assert.match(src, /advancedIntents/)
    assert.match(src, /COMMON_INTENT_IDS/)
    assert.match(src, /tokenConfigured/)
    assert.match(src, /replaceToken/)
    assert.match(src, /removeToken/)
    assert.match(src, /--dsw-alias-/)
    assert.match(src, /btnPrimary|btnOutline|pill/)
    assert.equal(src.includes(CANARY), false)
    assert.doesNotMatch(src, /credentials\.value|token\.slice|last four|••••/)
    assert.doesNotMatch(src, /guilds=deny_all channels=deny_all/)
  })

  it('ships final layout polish contracts', () => {
    const src = readFileSync(new URL('../src/client/index.js', import.meta.url), 'utf8')
    // Add account: compact outline-style control, not a forced full-width primary under the title alone
    assert.match(src, /btnAdd/)
    assert.match(src, /headerBar/)
    assert.doesNotMatch(
      src,
      /jsx\("h2"[^]*?btnPrimary[^]*?t\("add"\)/,
    )
    // Card title must not append (no token); token has its own summary row
    assert.match(src, /displayAccountTitle/)
    assert.match(src, /function displayAccountTitle/)
    assert.doesNotMatch(src, /\$\{[^}]*no token/)
    assert.doesNotMatch(src, /\+ " \(no token\)"/)
    // Inline delete-secret checkbox removed from AccountCard; lives in delete modal only
    assert.match(src, /DeleteAccountDialog/)
    assert.match(src, /role: "dialog"/)
    assert.match(src, /useState\(false\)/)
    assert.match(src, /deleteAccountQuery/)
    assert.match(src, /Also delete \{secret\} from Secrets|deleteSecretToo/)
    assert.match(src, /confirmDeleteBody/)
    assert.match(src, /ConversationBinding and delivery history are retained/)
    // Card must not host the vault-secret checkbox / optional help
    const cardStart = src.indexOf('function AccountCard')
    const cardEnd = src.indexOf('function DeleteAccountDialog')
    assert.ok(cardStart > 0 && cardEnd > cardStart)
    const cardSrc = src.slice(cardStart, cardEnd)
    assert.doesNotMatch(cardSrc, /deleteSecretToo/)
    assert.doesNotMatch(cardSrc, /deleteSecretHint/)
    assert.doesNotMatch(cardSrc, /Also delete/)
    // Modal hosts optional vault deletion; default false via useState(false)
    const modalStart = src.indexOf('function DeleteAccountDialog')
    const modalEnd = src.indexOf('function DiscordSection')
    const modalSrc = src.slice(modalStart, modalEnd)
    assert.match(modalSrc, /useState\(false\)/)
    assert.match(modalSrc, /deleteSecretToo/)
    assert.match(modalSrc, /deleteSecretHint/)
    assert.match(modalSrc, /onConfirm\(deleteSecret\)/)
    // Status still comes from backend item.status
    assert.match(cardSrc, /item\.status/)
    // Actions hierarchy: Edit left, Delete right
    assert.match(cardSrc, /actionsBar/)
    assert.match(cardSrc, /actionsLeft/)
  })
})