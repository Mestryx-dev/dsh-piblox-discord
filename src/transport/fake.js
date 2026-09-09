/**
 * Deterministic FakeTransport — no network, no tokens.
 * Extended for reliability: Retry-After metadata, nonce/enforce_nonce, ambiguous timeout.
 */

import { randomUUID } from 'node:crypto'

/**
 * @typedef {import('../types.js').OutboundMessage} OutboundMessage
 * @typedef {import('../types.js').SentMessage} SentMessage
 * @typedef {import('../types.js').PlatformEvent} PlatformEvent
 * @typedef {import('./transport.js').InboundHandler} InboundHandler
 * @typedef {import('./transport.js').DiscordTransport} DiscordTransport
 */

/**
 * @typedef {'429'|'5xx'|'timeout'|'permission'|'auth'|'invalid_payload'|'unknown_target'|'network'} SimulatedFailureCode
 */

/**
 * @typedef {{
 *   code: SimulatedFailureCode,
 *   retryAfterMs?: number,
 *   applyDespiteFailure?: boolean,
 * }} SimulatedFailureSpec
 */

export class TransportError extends Error {
  /**
   * @param {string} code
   * @param {string} [message]
   * @param {{ retryAfterMs?: number }} [extra]
   */
  constructor(code, message, extra = {}) {
    super(message || `transport_${code}`)
    this.name = 'TransportError'
    this.code = code
    this.retryAfterMs = extra.retryAfterMs
  }
}

/**
 * @implements {DiscordTransport}
 */
export class FakeTransport {
  constructor() {
    /** @type {Set<string>} */
    this.running = new Set()
    /** @type {InboundHandler[]} */
    this.handlers = []
    /** @type {Array<SentMessage & { op: string, payload: OutboundMessage }>} */
    this.outbound = []
    /** @type {Map<string, SimulatedFailureSpec[]>} */
    this.failureQueues = new Map()
    /** @type {Map<string, { messageId: string, content: string, channelId: string }>} */
    this.nonceIndex = new Map()
    this._seq = 0
  }

  /**
   * @param {string} accountId
   * @param {SimulatedFailureCode | SimulatedFailureSpec} failure
   */
  simulateNextFailure(accountId, failure) {
    const spec = typeof failure === 'string' ? { code: failure } : { ...failure }
    const q = this.failureQueues.get(accountId) || []
    q.push(spec)
    this.failureQueues.set(accountId, q)
  }

  /** @param {string} accountId */
  async startAccount(accountId) {
    this.running.add(accountId)
  }

  /** @param {string} accountId */
  async stopAccount(accountId) {
    this.running.delete(accountId)
  }

  /** @param {string} accountId */
  isAccountRunning(accountId) {
    return this.running.has(accountId)
  }

  /** @param {InboundHandler} handler */
  onInbound(handler) {
    this.handlers.push(handler)
    return () => {
      const i = this.handlers.indexOf(handler)
      if (i >= 0) this.handlers.splice(i, 1)
    }
  }

  /**
   * @param {Omit<PlatformEvent, 'type'> & { type?: 'discord.message.created' }} partial
   */
  async injectMessage(partial) {
    const event = /** @type {PlatformEvent} */ ({
      type: 'discord.message.created',
      eventId: partial.eventId || `evt_${++this._seq}`,
      messageId: partial.messageId || `msg_${this._seq}`,
      ...partial,
    })
    if (!this.running.has(event.accountId)) {
      throw new TransportError('permission', `account not running: ${event.accountId}`)
    }
    for (const handler of [...this.handlers]) {
      await handler(event)
    }
    return event
  }

  /**
   * Simulate Gateway reconnect replay of the same MESSAGE_CREATE (same message_id).
   * @param {Omit<PlatformEvent, 'type'> & { type?: 'discord.message.created' }} partial
   */
  async replayMessage(partial) {
    return this.injectMessage(partial)
  }

  /**
   * Inject a button/component interaction (intent only — not authorization).
   * @param {{
   *   accountId: string,
   *   interactionId: string,
   *   channelId?: string,
   *   guildId?: string,
   *   userId?: string,
   *   customId?: string,
   * }} partial
   */
  async injectInteraction(partial) {
    const event = {
      type: 'discord.interaction',
      eventId: partial.interactionId || `ix_${++this._seq}`,
      interactionId: partial.interactionId || `ix_${this._seq}`,
      accountId: partial.accountId,
      channelId: partial.channelId,
      guildId: partial.guildId,
      userId: partial.userId,
      customId: partial.customId,
    }
    if (!this.running.has(event.accountId)) {
      throw new TransportError('permission', `account not running: ${event.accountId}`)
    }
    for (const handler of [...this.handlers]) {
      await handler(event)
    }
    return event
  }

  /**
   * @param {string} accountId
   * @returns {SimulatedFailureSpec | null}
   */
  _takeFailure(accountId) {
    const q = this.failureQueues.get(accountId)
    if (!q || q.length === 0) return null
    const spec = q.shift()
    if (q.length === 0) this.failureQueues.delete(accountId)
    else this.failureQueues.set(accountId, q)
    return spec || null
  }

  /**
   * @param {SimulatedFailureSpec} spec
   */
  _throwFailure(spec) {
    if (spec.code === '429') {
      throw new TransportError('429', 'rate limited', {
        retryAfterMs: spec.retryAfterMs ?? 1000,
      })
    }
    if (spec.code === '5xx') {
      throw new TransportError('5xx', 'upstream 503')
    }
    if (spec.code === 'timeout') {
      throw new TransportError('timeout', 'request timed out')
    }
    if (spec.code === 'network') {
      throw new TransportError('connection_reset', 'ECONNRESET')
    }
    if (spec.code === 'auth') {
      throw new TransportError('auth', 'invalid token')
    }
    if (spec.code === 'invalid_payload') {
      throw new TransportError('invalid_payload', 'invalid payload')
    }
    if (spec.code === 'unknown_target') {
      throw new TransportError('unknown_target', 'unknown channel')
    }
    throw new TransportError('permission', 'missing permissions')
  }

  /**
   * @param {string} accountId
   * @param {string} channelId
   * @param {OutboundMessage} payload
   * @param {string} op
   * @param {string} [messageId]
   */
  async _outbound(accountId, channelId, payload, op, messageId) {
    if (!this.running.has(accountId)) {
      throw new TransportError('permission', `account not running: ${accountId}`)
    }

    // Create Message nonce / enforce_nonce semantics (Fake model of Discord).
    if (op === 'send' && payload.nonce && payload.enforceNonce) {
      const prior = this.nonceIndex.get(payload.nonce)
      if (prior) {
        if (prior.content === String(payload.content || '') && prior.channelId === channelId) {
          return {
            accountId,
            channelId,
            messageId: prior.messageId,
            guildId: undefined,
            threadId: undefined,
          }
        }
        throw new TransportError('nonce_conflict', 'enforce_nonce conflict')
      }
    }

    const fail = this._takeFailure(accountId)
    const applyDespite = Boolean(fail?.applyDespiteFailure)

    const sent = {
      accountId,
      channelId,
      messageId: messageId || `out_${randomUUID().slice(0, 8)}`,
      guildId: undefined,
      threadId: undefined,
    }

    if (fail && applyDespite) {
      this.outbound.push({ ...sent, op, payload: structuredClone(payload) })
      if (op === 'send' && payload.nonce) {
        this.nonceIndex.set(payload.nonce, {
          messageId: sent.messageId,
          content: String(payload.content || ''),
          channelId,
        })
      }
      this._throwFailure(fail)
    }

    if (fail) {
      this._throwFailure(fail)
    }

    this.outbound.push({ ...sent, op, payload: structuredClone(payload) })
    if (op === 'send' && payload.nonce) {
      this.nonceIndex.set(payload.nonce, {
        messageId: sent.messageId,
        content: String(payload.content || ''),
        channelId,
      })
    }
    return sent
  }

  /** @type {DiscordTransport['sendMessage']} */
  sendMessage(accountId, channelId, payload) {
    return this._outbound(accountId, channelId, payload, 'send')
  }

  /** @type {DiscordTransport['replyMessage']} */
  replyMessage(accountId, channelId, messageId, payload) {
    return this._outbound(accountId, channelId, { ...payload, replyTo: messageId }, 'reply')
  }

  /** @type {DiscordTransport['editMessage']} */
  editMessage(accountId, channelId, messageId, payload) {
    return this._outbound(accountId, channelId, payload, 'edit', messageId)
  }

  /**
   * Minimal thread create for multi-step groups (Fake only).
   * @param {string} accountId
   * @param {string} parentChannelId
   * @param {{ name?: string, messageId?: string }} opts
   */
  async createThread(accountId, parentChannelId, opts = {}) {
    if (!this.running.has(accountId)) {
      throw new TransportError('permission', `account not running: ${accountId}`)
    }
    const fail = this._takeFailure(accountId)
    if (fail) this._throwFailure(fail)
    const threadId = `thread_${randomUUID().slice(0, 8)}`
    const sent = {
      accountId,
      channelId: threadId,
      messageId: opts.messageId || `thread_root_${++this._seq}`,
      guildId: undefined,
      threadId,
      id: threadId,
    }
    this.outbound.push({
      ...sent,
      op: 'createThread',
      payload: { content: opts.name || 'thread', raw: { parentChannelId } },
    })
    return sent
  }
}
