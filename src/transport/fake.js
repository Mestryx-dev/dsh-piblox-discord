/**
 * Deterministic FakeTransport — no network, no tokens.
 */

import { randomUUID } from 'node:crypto'

/**
 * @typedef {import('../types.js').OutboundMessage} OutboundMessage
 * @typedef {import('../types.js').SentMessage} SentMessage
 * @typedef {import('../types.js').PlatformEvent} PlatformEvent
 * @typedef {import('../types.js').SimulatedFailure} SimulatedFailure
 * @typedef {import('./transport.js').InboundHandler} InboundHandler
 * @typedef {import('./transport.js').DiscordTransport} DiscordTransport
 */

export class TransportError extends Error {
  /**
   * @param {SimulatedFailure} code
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
    /** @type {Array<SentMessage & { op: 'send'|'reply'|'edit', payload: OutboundMessage }>} */
    this.outbound = []
    /** @type {Map<string, SimulatedFailure>} */
    this.nextFailureByAccount = new Map()
    this._seq = 0
  }

  /**
   * @param {string} accountId
   * @param {SimulatedFailure} code
   */
  simulateNextFailure(accountId, code) {
    this.nextFailureByAccount.set(accountId, code)
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
   * Inject a normalized inbound message event.
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
   * @param {string} accountId
   * @param {string} channelId
   * @param {OutboundMessage} payload
   * @param {'send'|'reply'|'edit'} op
   * @param {string} [messageId]
   */
  async _outbound(accountId, channelId, payload, op, messageId) {
    if (!this.running.has(accountId)) {
      throw new TransportError('permission', `account not running: ${accountId}`)
    }
    const fail = this.nextFailureByAccount.get(accountId)
    if (fail) {
      this.nextFailureByAccount.delete(accountId)
      if (fail === '429') {
        throw new TransportError('429', 'rate limited', { retryAfterMs: 1000 })
      }
      if (fail === '5xx') {
        throw new TransportError('5xx', 'upstream 503')
      }
      if (fail === 'timeout') {
        throw new TransportError('timeout', 'request timed out')
      }
      throw new TransportError('permission', 'missing permissions')
    }
    const sent = {
      accountId,
      channelId,
      messageId: messageId || `out_${randomUUID().slice(0, 8)}`,
      guildId: undefined,
      threadId: undefined,
    }
    this.outbound.push({ ...sent, op, payload: structuredClone(payload) })
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
}
