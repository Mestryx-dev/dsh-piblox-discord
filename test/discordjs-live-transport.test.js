/**
 * DiscordJsTransport live seam — mocked discord.js Client only.
 * Never uses a real Discord token or network.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { authorizeInbound } from '../src/config.js'
import { mapDiscordJsError } from '../src/discord-errors.js'
import {
  DiscordJsTransport,
  normalizeMessageCreate,
  toDiscordMessageBody,
  LIVE_SMOKE_INTENT_IDS,
  resolveGatewayIntents,
} from '../src/transport/discordjs.js'

const FAKE_TOKEN = 'UNIT_TEST_FAKE_TOKEN_NOT_REAL'

function mockDiscordModule() {
  return {
    Client: class {},
    GatewayIntentBits: {
      Guilds: 1,
      GuildMessages: 2,
      MessageContent: 4,
      DirectMessages: 8,
    },
    RateLimitError: class RateLimitError extends Error {},
    DiscordAPIError: class DiscordAPIError extends Error {},
  }
}

function createMockClient() {
  /** @type {Record<string, Function[]>} */
  const listeners = {}
  const client = {
    loginCalls: [],
    destroyed: false,
    rest: {
      on(ev, fn) {
        listeners[`rest:${ev}`] = listeners[`rest:${ev}`] || []
        listeners[`rest:${ev}`].push(fn)
      },
    },
    on(ev, fn) {
      listeners[ev] = listeners[ev] || []
      listeners[ev].push(fn)
    },
    emit(ev, ...args) {
      for (const fn of listeners[ev] || []) fn(...args)
    },
    async login(token) {
      client.loginCalls.push(token)
      queueMicrotask(() => client.emit('ready'))
    },
    async destroy() {
      client.destroyed = true
    },
    channels: {
      async fetch(id) {
        return {
          id,
          async send(body) {
            client.lastSend = body
            return { id: 'out-1', guildId: 'g1' }
          },
          messages: {
            async fetch(mid) {
              return {
                id: mid,
                async edit(body) {
                  client.lastEdit = body
                  return { id: mid, guildId: 'g1' }
                },
              }
            },
          },
        }
      },
    },
  }
  return client
}

describe('DiscordJsTransport live seam (mocked)', () => {
  it('allowConnect=false → client.login never called', async () => {
    let login = 0
    const t = new DiscordJsTransport({
      allowConnect: false,
      resolveCredential: async () => ({ ok: true, value: FAKE_TOKEN }),
      createClient: async () => {
        login += 1
        return createMockClient()
      },
      importDiscord: async () => mockDiscordModule(),
    })
    await assert.rejects(() => t.startAccount('lab', { credentialsRef: 'DISCORD_LAB_BOT_TOKEN' }), /allowConnect/)
    assert.equal(login, 0)
    assert.equal(t.isAccountRunning('lab'), false)
  })

  it('allowConnect=true → credential resolve used; token not retained on transport', async () => {
    const resolves = []
    const mock = createMockClient()
    const t = new DiscordJsTransport({
      allowConnect: true,
      resolveCredential: async (ref) => {
        resolves.push(ref)
        return { ok: true, value: FAKE_TOKEN }
      },
      createClient: async () => mock,
      importDiscord: async () => mockDiscordModule(),
    })
    await t.startAccount('lab', {
      credentialsRef: 'DISCORD_LAB_BOT_TOKEN',
      intents: [...LIVE_SMOKE_INTENT_IDS],
    })
    await new Promise((r) => setTimeout(r, 10))
    assert.deepEqual(resolves, ['DISCORD_LAB_BOT_TOKEN'])
    assert.equal(mock.loginCalls.length, 1)
    assert.equal(mock.loginCalls[0], FAKE_TOKEN)
    assert.equal(t.isAccountRunning('lab'), true)
    assert.equal(t.isAccountConnected('lab'), true)
    assert.equal(t.getAccountStatus('lab'), 'connected')
    // No token field stored on transport instance
    assert.equal(JSON.stringify(t).includes(FAKE_TOKEN), false)
    await t.stopAccount('lab')
    assert.equal(mock.destroyed, true)
    assert.equal(t.isAccountRunning('lab'), false)
  })

  it('rejects inline token option', async () => {
    const t = new DiscordJsTransport({
      allowConnect: true,
      resolveCredential: async () => ({ ok: true, value: FAKE_TOKEN }),
      createClient: async () => createMockClient(),
      importDiscord: async () => mockDiscordModule(),
    })
    await assert.rejects(
      () => t.startAccount('lab', { credentialsRef: 'X', token: FAKE_TOKEN }),
      /inline token/,
    )
  })

  it('per-account client isolation', async () => {
    const clients = new Map()
    const t = new DiscordJsTransport({
      allowConnect: true,
      resolveCredential: async () => ({ ok: true, value: FAKE_TOKEN }),
      createClient: async ({ accountId }) => {
        const c = createMockClient()
        clients.set(accountId, c)
        return c
      },
      importDiscord: async () => mockDiscordModule(),
    })
    await t.startAccount('lab', { credentialsRef: 'DISCORD_LAB_BOT_TOKEN' })
    await t.startAccount('other', { credentialsRef: 'DISCORD_OTHER_BOT_TOKEN' })
    await new Promise((r) => setTimeout(r, 10))
    assert.notEqual(clients.get('lab'), clients.get('other'))
    assert.equal(t.isAccountConnected('lab'), true)
    assert.equal(t.isAccountConnected('other'), true)
    await t.stopAccount('lab')
    assert.equal(t.isAccountRunning('lab'), false)
    assert.equal(t.isAccountConnected('other'), true)
    await t.stopAccount('other')
  })

  it('auth failure is isolated (status failed_auth, no running)', async () => {
    const t = new DiscordJsTransport({
      allowConnect: true,
      resolveCredential: async () => ({ ok: true, value: FAKE_TOKEN }),
      createClient: async () => {
        const c = createMockClient()
        c.login = async () => {
          const err = new Error('Invalid token')
          err.name = 'DiscordAPIError'
          err.status = 401
          throw err
        }
        return c
      },
      importDiscord: async () => mockDiscordModule(),
    })
    await assert.rejects(() => t.startAccount('lab', { credentialsRef: 'DISCORD_LAB_BOT_TOKEN' }))
    assert.equal(t.getAccountStatus('lab'), 'failed_auth')
    assert.equal(t.isAccountRunning('lab'), false)
    assert.equal(t.isAccountConnected('lab'), false)
  })

  it('normalizes messageCreate without leaking Message object', () => {
    const event = normalizeMessageCreate('lab', {
      id: '111',
      channelId: '222',
      guildId: '333',
      content: 'hello',
      author: { id: '444', bot: false },
      createdAt: { toISOString: () => '2026-09-09T00:00:00.000Z' },
      channel: { isThread: () => false, isDMBased: () => false },
    })
    assert.equal(event.type, 'discord.message.created')
    assert.equal(event.accountId, 'lab')
    assert.equal(event.messageId, '111')
    assert.equal(event.channelId, '222')
    assert.equal(event.guildId, '333')
    assert.equal(event.userId, '444')
    assert.equal(event.content, 'hello')
    assert.equal(event.isBot, false)
    assert.equal(typeof event, 'object')
  })

  it('allowed event reaches bridge handlers; denied does not create follow-up path', async () => {
    const mock = createMockClient()
    const received = []
    const t = new DiscordJsTransport({
      allowConnect: true,
      resolveCredential: async () => ({ ok: true, value: FAKE_TOKEN }),
      createClient: async () => mock,
      importDiscord: async () => mockDiscordModule(),
    })
    t.onInbound(async (ev) => {
      const auth = authorizeInbound(
        {
          enabled: true,
          allowAllGuilds: false,
          allowedGuilds: ['333'],
          allowAllChannels: false,
          allowedChannels: ['222'],
          dm: { enabled: false, allowAllUsers: false, allowedUsers: [] },
          ignoreBots: true,
        },
        ev,
      )
      if (auth.ok) received.push(ev.messageId)
    })
    await t.startAccount('lab', { credentialsRef: 'DISCORD_LAB_BOT_TOKEN' })
    await new Promise((r) => setTimeout(r, 10))

    await t._dispatchMessageCreate('lab', {
      id: 'm-ok',
      channelId: '222',
      guildId: '333',
      content: 'ping',
      author: { id: 'u1', bot: false },
      channel: { isThread: () => false, isDMBased: () => false },
    })
    await t._dispatchMessageCreate('lab', {
      id: 'm-deny',
      channelId: '999',
      guildId: '333',
      content: 'nope',
      author: { id: 'u1', bot: false },
      channel: { isThread: () => false, isDMBased: () => false },
    })
    assert.deepEqual(received, ['m-ok'])
    await t.stopAccount('lab')
  })

  it('forwards nonce + enforceNonce on sendMessage', async () => {
    const mock = createMockClient()
    const t = new DiscordJsTransport({
      allowConnect: true,
      resolveCredential: async () => ({ ok: true, value: FAKE_TOKEN }),
      createClient: async () => mock,
      importDiscord: async () => mockDiscordModule(),
    })
    await t.startAccount('lab', { credentialsRef: 'DISCORD_LAB_BOT_TOKEN' })
    await new Promise((r) => setTimeout(r, 10))
    const sent = await t.sendMessage('lab', '222', {
      content: 'hi',
      nonce: 'op-abc',
      enforceNonce: true,
    })
    assert.equal(sent.messageId, 'out-1')
    assert.equal(mock.lastSend.nonce, 'op-abc')
    assert.equal(mock.lastSend.enforceNonce, true)
    await t.stopAccount('lab')
  })

  it('toDiscordMessageBody preserves nonce fields', () => {
    const body = toDiscordMessageBody({
      content: 'x',
      nonce: 'n1',
      enforceNonce: true,
      replyTo: 'm1',
    })
    assert.equal(body.nonce, 'n1')
    assert.equal(body.enforceNonce, true)
    assert.equal(body.reply.messageReference, 'm1')
  })

  it('stop/restart lifecycle', async () => {
    let created = 0
    const t = new DiscordJsTransport({
      allowConnect: true,
      resolveCredential: async () => ({ ok: true, value: FAKE_TOKEN }),
      createClient: async () => {
        created += 1
        return createMockClient()
      },
      importDiscord: async () => mockDiscordModule(),
    })
    await t.startAccount('lab', { credentialsRef: 'DISCORD_LAB_BOT_TOKEN' })
    await new Promise((r) => setTimeout(r, 5))
    await t.stopAccount('lab')
    await t.startAccount('lab', { credentialsRef: 'DISCORD_LAB_BOT_TOKEN' })
    await new Promise((r) => setTimeout(r, 5))
    assert.equal(created, 2)
    assert.equal(t.isAccountConnected('lab'), true)
    await t.stopAccount('lab')
  })

  it('maps real transport-like errors into taxonomy', () => {
    const err = new Error('Missing Permissions')
    err.name = 'DiscordAPIError[50013]'
    err.status = 403
    err.code = 50013
    const mapped = mapDiscordJsError(err)
    assert.equal(mapped.code, 'permission')

    const rl = new Error('rate limited')
    rl.name = 'RateLimitError[/channels/:id/messages]'
    rl.retryAfter = 1500
    const mappedRl = mapDiscordJsError(rl)
    assert.equal(mappedRl.code, '429')
    assert.equal(mappedRl.retryAfterMs, 1500)
  })

  it('resolveGatewayIntents uses discord.js constants', () => {
    const djs = mockDiscordModule()
    const bits = resolveGatewayIntents(djs, LIVE_SMOKE_INTENT_IDS)
    assert.deepEqual(bits, [1, 2, 4])
  })
})
