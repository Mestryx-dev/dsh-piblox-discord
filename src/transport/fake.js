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
   * @param {Record<string, any>} partial
   */
  async injectInteraction(partial) {
    const interactionId = partial.interactionId || `ix_${++this._seq}`
    const componentType = partial.componentType || 'button'
    const type =
      partial.type ||
      (componentType === 'button'
        ? 'discord.button.clicked'
        : String(componentType).includes('select')
          ? 'discord.select.changed'
          : 'discord.interaction.created')
    const event = {
      type,
      eventId: interactionId,
      interactionId,
      accountId: partial.accountId,
      channelId: partial.channelId || '',
      guildId: partial.guildId,
      userId: partial.userId || '',
      customId: partial.customId,
      messageId: partial.messageId,
      threadId: partial.threadId,
      parentChannelId: partial.parentChannelId,
      componentType,
      values: partial.values,
      isDm: Boolean(partial.isDm),
      deliveryMode: partial.deliveryMode || 'gateway',
      raw: { custom_id: partial.customId || null },
    }
    if (!this.running.has(event.accountId)) {
      throw new TransportError('permission', `account not running: ${event.accountId}`)
    }
    if (!this._interactions) this._interactions = new Map()
    this._interactions.set(`${event.accountId}:${interactionId}`, {
      id: interactionId,
      deferred: false,
      replied: false,
      channelId: event.channelId,
    })
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
    if (spec.code === 'already_acknowledged') {
      throw new TransportError('already_acknowledged', 'interaction already acknowledged')
    }
    if (spec.code === 'interaction_expired') {
      throw new TransportError('interaction_expired', 'unknown interaction')
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
   * Thread create from parent message — deterministic by accountId+messageId so
   * retries/reconcile do not spawn duplicate threads in tests.
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

    if (!this._threadByParentMessage) {
      /** @type {Map<string, any>} */
      this._threadByParentMessage = new Map()
    }
    const parentMessageId = opts.messageId != null ? String(opts.messageId) : ''
    const reconcileKey = parentMessageId ? `${accountId}:${parentMessageId}` : ''
    if (reconcileKey && this._threadByParentMessage.has(reconcileKey)) {
      return this._threadByParentMessage.get(reconcileKey)
    }

    const threadId = parentMessageId
      ? `thread_from_${parentMessageId}`
      : `thread_${randomUUID().slice(0, 8)}`
    const sent = {
      accountId,
      channelId: threadId,
      // Keep starter message id for audit; outbox prefers threadId as resource id
      messageId: parentMessageId || `thread_root_${++this._seq}`,
      guildId: undefined,
      threadId,
      id: threadId,
      parentChannelId: String(parentChannelId),
    }
    this.outbound.push({
      ...sent,
      op: 'createThread',
      payload: {
        content: opts.name || 'thread',
        raw: { parentChannelId: String(parentChannelId), parentMessageId },
      },
    })
    if (reconcileKey) this._threadByParentMessage.set(reconcileKey, sent)
    return sent
  }

  /**
   * @param {string} accountId
   * @param {string} interactionId
   * @param {{ ephemeral?: boolean, update?: boolean }} [opts]
   */
  async deferInteraction(accountId, interactionId, opts = {}) {
    if (!this.running.has(accountId)) {
      throw new TransportError('permission', `account not running: ${accountId}`)
    }
    const fail = this._takeFailure(accountId)
    if (fail) this._throwFailure(fail)
    if (!this._interactions) this._interactions = new Map()
    const key = `${accountId}:${interactionId}`
    const ix = this._interactions.get(key) || { id: interactionId, channelId: '' }
    ix.deferred = true
    this._interactions.set(key, ix)
    const sent = {
      accountId,
      channelId: String(ix.channelId || ''),
      messageId: String(interactionId),
      op: 'deferInteraction',
      payload: {
        content: opts.update ? 'deferUpdate' : 'deferReply',
        ephemeral: Boolean(opts.ephemeral),
      },
    }
    this.outbound.push(sent)
    return sent
  }

  /** @param {string} accountId @param {string} interactionId @param {OutboundMessage} payload */
  async followUpInteraction(accountId, interactionId, payload) {
    return this._interactionOutbound(accountId, interactionId, payload, 'followUpInteraction')
  }

  /** @param {string} accountId @param {string} interactionId @param {OutboundMessage} payload */
  async editInteractionReply(accountId, interactionId, payload) {
    return this._interactionOutbound(accountId, interactionId, payload, 'editInteractionReply')
  }

  /** @param {string} accountId @param {string} interactionId @param {OutboundMessage} payload */
  async updateInteraction(accountId, interactionId, payload) {
    return this._interactionOutbound(accountId, interactionId, payload, 'updateInteraction')
  }

  /**
   * @param {string} accountId
   * @param {string} interactionId
   * @param {OutboundMessage} payload
   * @param {string} op
   */
  async _interactionOutbound(accountId, interactionId, payload, op) {
    if (!this.running.has(accountId)) {
      throw new TransportError('permission', `account not running: ${accountId}`)
    }
    const fail = this._takeFailure(accountId)
    if (fail) this._throwFailure(fail)
    if (!this._interactions) this._interactions = new Map()
    const key = `${accountId}:${interactionId}`
    const ix = this._interactions.get(key) || { id: interactionId, channelId: '' }
    ix.replied = true
    this._interactions.set(key, ix)
    const messageId = `ixmsg_${++this._seq}`
    const sent = {
      accountId,
      channelId: String(ix.channelId || ''),
      messageId,
      op,
      payload: { ...payload },
    }
    this.outbound.push(sent)
    return sent
  }
}
