import assert from 'node:assert/strict'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildBindingIdentity, toExternalIdentity } from '../src/binding.js'
import { createConversationBindingForTest } from '../../dsh-conversation-binding/src/index.js'

describe('binding encoding', () => {
  it('encodes DM / channel / thread without colon collisions', () => {
    const dm = buildBindingIdentity('account_alpha', { isDm: true, userId: 'u1', channelId: 'dm' })
    assert.deepEqual(toExternalIdentity(dm), {
      provider: 'discord',
      scope: 'account_alpha.dm',
      external_id: 'u1',
    })

    const channel = buildBindingIdentity('account_alpha', {
      guildId: 'g1',
      channelId: 'c1',
      userId: 'u1',
    })
    assert.equal(channel.scope, 'account_alpha.channel')
    assert.equal(channel.external_id, 'c1')

    const thread = buildBindingIdentity('account_alpha', {
      guildId: 'g1',
      channelId: 'c1',
      threadId: 't1',
      userId: 'u1',
    })
    assert.equal(thread.scope, 'account_alpha.thread')
    assert.equal(thread.external_id, 't1')
  })

  it('isolates accounts in scope namespace', () => {
    const a = buildBindingIdentity('account_alpha', { channelId: 'c1', userId: 'u1' })
    const b = buildBindingIdentity('account_beta', { channelId: 'c1', userId: 'u1' })
    assert.notEqual(a.scope, b.scope)
  })

  it('distinguishes channel vs thread for same channel id', () => {
    const channel = buildBindingIdentity('a1', { channelId: 'c1', userId: 'u1' })
    const thread = buildBindingIdentity('a1', { channelId: 'c1', threadId: 'c1', userId: 'u1' })
    assert.notEqual(channel.scope, thread.scope)
  })
})

describe('binding + conversationBinding', () => {
  /** @type {string} */
  let dir
  /** @type {ReturnType<typeof createConversationBindingForTest>} */
  let api

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dsh-discord-bind-'))
    api = createConversationBindingForTest({ storePath: join(dir, 'bindings.json') })
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('same Discord conversation resolves same DSH session', async () => {
    const identity = toExternalIdentity(
      buildBindingIdentity('account_alpha', { channelId: 'c1', userId: 'u1' }),
    )
    let mints = 0
    const mint = () => {
      mints += 1
      return `session-${mints}`
    }
    const first = await api.resolveOrCreate(identity, { createSessionId: mint })
    const second = await api.resolveOrCreate(identity, { createSessionId: mint })
    assert.equal(mints, 1)
    assert.equal(first.binding.session_id, second.binding.session_id)
    assert.equal(second.created, false)
  })

  it('cross-account isolation for same channel id', async () => {
    const alpha = toExternalIdentity(
      buildBindingIdentity('account_alpha', { channelId: 'c1', userId: 'u1' }),
    )
    const beta = toExternalIdentity(
      buildBindingIdentity('account_beta', { channelId: 'c1', userId: 'u1' }),
    )
    const a = await api.resolveOrCreate(alpha, { createSessionId: () => 'sess-a' })
    const b = await api.resolveOrCreate(beta, { createSessionId: () => 'sess-b' })
    assert.notEqual(a.binding.session_id, b.binding.session_id)
  })

  it('concurrent resolveOrCreate does not mint duplicate sessions', async () => {
    const identity = toExternalIdentity(
      buildBindingIdentity('account_alpha', { channelId: 'c-concurrent', userId: 'u1' }),
    )
    let mints = 0
    const mint = async () => {
      mints += 1
      await new Promise((r) => setTimeout(r, 5))
      return `session-c-${mints}`
    }
    const results = await Promise.all([
      api.resolveOrCreate(identity, { createSessionId: mint }),
      api.resolveOrCreate(identity, { createSessionId: mint }),
      api.resolveOrCreate(identity, { createSessionId: mint }),
      api.resolveOrCreate(identity, { createSessionId: mint }),
    ])
    const ids = new Set(results.map((r) => r.binding.session_id))
    assert.equal(ids.size, 1)
    assert.equal(mints, 1)
  })
})
