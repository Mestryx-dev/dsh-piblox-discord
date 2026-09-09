/**
 * DSH session bridge — ConversationBinding + agents + DeliveryOutbox + inbound dedupe.
 *
 * Outbound path (LOCKED):
 *   assistant/chunk|message → coalesce → outbox.enqueue → outbox.tick → transport
 *
 * Inbound path (LOCKED):
 *   normalize → authorize → dedupe claim → binding/session → followup → complete
 */

import { randomUUID } from 'node:crypto'
import { buildBindingIdentity, toExternalIdentity } from './binding.js'
import { authorizeInbound } from './config.js'
import { buildFollowupMessage } from './message-source.js'
import { inboundEventKey } from './inbound-dedupe.js'

/**
 * Extract assistant text from a session/event payload (best-effort).
 * @param {any} event
 */
export function extractAssistantText(event) {
  if (!event || typeof event !== 'object') return ''
  if (event.type === 'assistant/chunk') {
    const chunk = event.data?.chunk
    if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') return chunk.text
    if (typeof chunk?.text === 'string') return chunk.text
    if (typeof event.data?.text === 'string') return event.data.text
    return ''
  }
  if (event.type === 'assistant/message') {
    const content = event.data?.message?.content
    if (Array.isArray(content)) {
      return content.map((b) => (b?.type === 'text' ? b.text : '')).join('')
    }
    if (typeof event.data?.message?.content === 'string') return event.data.message.content
  }
  return ''
}

/**
 * Mint a session id string (discord-prefixed UUID).
 * Real DSH brands SessionId at the agents boundary; we return a plain string
 * matching ConversationBinding's session_id field.
 */
export function mintDiscordSessionId() {
  return `discord-${randomUUID()}`
}

/**
 * @typedef {{
 *   conversationBinding: {
 *     resolveOrCreate: Function,
 *     unbind: Function,
 *     resolve?: Function,
 *   },
 *   agents: {
 *     create: Function,
 *     get: Function,
 *     resume: Function,
 *   },
 *   transport: import('./transport/transport.js').DiscordTransport,
 *   outbox: ReturnType<import('./outbox/index.js').createDeliveryOutbox>,
 *   inboundDedupe?: ReturnType<import('./inbound-dedupe.js').createInboundDedupe>,
 *   accounts: Record<string, import('./config.js').AccountConfig>,
 *   observability?: { mint?: Function, bind?: Function, emit?: Function },
 *   createUserMessage?: Function,
 *   onSessionEvent?: (sessionId: string, listener: Function) => () => void,
 *   onInteractionIntent?: (event: any) => void | Promise<void>,
 *   logger?: { info?: Function, warn?: Function, debug?: Function },
 * }} BridgeOptions
 */

export class DiscordSessionBridge {
  /** @param {BridgeOptions} options */
  constructor(options) {
    this.conversationBinding = options.conversationBinding
    this.agents = options.agents
    this.transport = options.transport
    this.outbox = options.outbox
    this.inboundDedupe = options.inboundDedupe || null
    this.accounts = options.accounts
    this.observability = options.observability
    this.createUserMessage = options.createUserMessage
    this.onSessionEvent = options.onSessionEvent
    this.onInteractionIntent = options.onInteractionIntent
    this.logger = options.logger
    /** @type {Map<string, any>} session_id → AgentHandle */
    this.handles = new Map()
    /**
     * Delivery/render target only (NOT a ConversationBinding).
     * @type {Map<string, { accountId: string, channelId: string, replyTo?: string, correlationId?: string }>}
     */
    this.deliveryTargets = new Map()
    /**
     * Stream delivery state: DSH session → Discord message_id.
     * @type {Map<string, {
     *   buffer: string,
     *   sentId?: string,
     *   dirty: boolean,
     *   flushSeq: number,
     *   lastReceipt?: any,
     *   turnKey?: string,
     * }>}
     */
    this.streams = new Map()
    /** @type {Array<{ accountId: string, interactionId: string }>} */
    this.interactionDispatches = []
    this._unsubInbound = null
  }

  start() {
    if (!this.outbox) {
      throw new Error('DiscordSessionBridge: DeliveryOutbox required (no direct transport bypass)')
    }
    this._unsubInbound = this.transport.onInbound((event) => this.handleInbound(event))
  }

  stop() {
    if (this._unsubInbound) this._unsubInbound()
    this._unsubInbound = null
  }

  /**
   * @param {import('./types.js').PlatformEvent & { interactionId?: string }} event
   */
  async handleInbound(event) {
    if (event.type === 'discord.interaction' || event.interactionId) {
      return this._handleInteraction(event)
    }

    if (event.type !== 'discord.message.created') {
      this.logger?.debug?.(`ignore event type ${event.type}`)
      return { ok: false, reason: 'unsupported_event' }
    }

    const account = this.accounts[event.accountId]
    if (!account) {
      return { ok: false, reason: 'unknown_account' }
    }
    if (!this.transport.isAccountRunning(event.accountId)) {
      return { ok: false, reason: 'account_stopped' }
    }
    if (typeof event.content !== 'string') {
      return { ok: false, reason: 'malformed_event' }
    }

    // authorize before bot / claim (denied events never enter durable dedupe)
    // Order: account → guild → channel → guild user (see authorizeInbound)
    const auth = authorizeInbound(account, event)
    if (!auth.ok) {
      return { ok: false, reason: auth.reason }
    }

    if (account.ignoreBots !== false && event.isBot) {
      return { ok: false, reason: 'ignored_bot' }
    }

    const { eventId, eventType } = inboundEventKey(event)
    if (this.inboundDedupe) {
      const claimed = await this.inboundDedupe.claim({
        accountId: event.accountId,
        eventId,
        eventType,
      })
      if (!claimed.ok) {
        return { ok: false, reason: 'duplicate', claim: claimed.claim }
      }
    }

    try {
      const result = await this._dispatchMessageTurn(event)
      if (this.inboundDedupe && result.ok) {
        await this.inboundDedupe.markDispatched(event.accountId, eventId, {
          sessionId: result.sessionId,
        })
        await this.inboundDedupe.markCompleted(event.accountId, eventId)
      }
      return result
    } catch (err) {
      // Leave claim in `claimed` with lease — reclaim after lease_until (at-least-once).
      this.logger?.warn?.(`inbound dispatch failed: ${err?.message || err}`)
      throw err
    }
  }

  /**
   * Interaction intent path — same durable dedupe, no approval semantics.
   * @param {any} event
   */
  async _handleInteraction(event) {
    const accountId = event.accountId
    const account = this.accounts[accountId]
    if (!account) return { ok: false, reason: 'unknown_account' }
    if (!this.transport.isAccountRunning(accountId)) {
      return { ok: false, reason: 'account_stopped' }
    }

    const interactionId = String(event.interactionId || event.eventId || '')
    if (!interactionId) return { ok: false, reason: 'malformed_event' }

    if (this.inboundDedupe) {
      const claimed = await this.inboundDedupe.claim({
        accountId,
        eventId: interactionId,
        eventType: 'discord.interaction',
      })
      if (!claimed.ok) {
        return { ok: false, reason: 'duplicate', claim: claimed.claim }
      }
    }

    try {
      this.interactionDispatches.push({ accountId, interactionId })
      if (typeof this.onInteractionIntent === 'function') {
        await this.onInteractionIntent(event)
      }
      if (this.inboundDedupe) {
        await this.inboundDedupe.markDispatched(accountId, interactionId)
        await this.inboundDedupe.markCompleted(accountId, interactionId)
      }
      return { ok: true, interactionId, dispatched: true }
    } catch (err) {
      this.logger?.warn?.(`interaction dispatch failed: ${err?.message || err}`)
      throw err
    }
  }

  /**
   * @param {import('./types.js').PlatformEvent} event
   */
  async _dispatchMessageTurn(event) {
    const identity = buildBindingIdentity(event.accountId, event)
    const external = toExternalIdentity(identity)

    let correlationId = event.correlationId
    if (this.observability?.mint) {
      try {
        const minted = this.observability.mint()
        correlationId = minted?.correlation_id || minted?.id || correlationId
        if (correlationId && this.observability.bind) {
          this.observability.bind(correlationId, { provider: 'discord', account_id: event.accountId })
        }
      } catch {
        /* optional */
      }
    }

    const createSessionId = async () => {
      const sessionId = mintDiscordSessionId()
      const handle = await this.agents.create({
        sessionId,
        meta: {
          provider: 'discord',
          accountId: event.accountId,
          bindingScope: identity.scope,
        },
      })
      this.handles.set(String(sessionId), handle)
      this._attachOutput(String(sessionId), event)
      return String(sessionId)
    }

    let { binding, created } = await this.conversationBinding.resolveOrCreate(external, {
      createSessionId,
    })

    let sessionId = binding.session_id
    let handle = this.agents.get?.(sessionId) || null
    if (!handle) {
      this.handles.delete(sessionId)
      try {
        handle = await this.agents.resume({ resumeSessionId: sessionId })
        this.handles.set(sessionId, handle)
        this._attachOutput(sessionId, event)
      } catch (err) {
        this.logger?.warn?.(`session missing for ${sessionId}, rebinding: ${err?.message || err}`)
        await this.conversationBinding.unbind(external)
        const reminted = await this.conversationBinding.resolveOrCreate(external, { createSessionId })
        binding = reminted.binding
        created = reminted.created
        sessionId = binding.session_id
        handle = this.handles.get(sessionId) || this.agents.get?.(sessionId) || null
      }
    } else {
      this.handles.set(sessionId, handle)
      this._attachOutput(sessionId, event)
    }

    if (!handle?.agent?.followup) {
      return { ok: false, reason: 'agent_unavailable', sessionId }
    }

    this.deliveryTargets.set(sessionId, {
      accountId: event.accountId,
      channelId: event.channelId,
      replyTo: event.messageId,
      correlationId,
    })

    if (this.observability?.emit) {
      try {
        this.observability.emit('request.received', {
          correlation_id: correlationId,
          provider: 'discord',
          account_id: event.accountId,
          session_id: sessionId,
          event_id: event.eventId,
          created,
        })
      } catch {
        /* closed EVENT_TYPES — ignore */
      }
    }

    const message = buildFollowupMessage(this.createUserMessage, event.content, {
      accountId: event.accountId,
      channelId: event.channelId,
      messageId: event.messageId,
    })
    await handle.agent.followup(message)

    return { ok: true, sessionId, created, identity, correlationId }
  }

  /**
   * Coalesce accumulated stream buffer into a single outbox send or edit.
   * Deterministic tests may call this explicitly; assistant/message and turn/end also flush.
   * @param {string} sessionId
   * @param {{ final?: boolean }} [opts]
   */
  async flushOutbound(sessionId, opts = {}) {
    const sid = String(sessionId)
    const stream = this.streams.get(sid)
    const target = this.deliveryTargets.get(sid)
    if (!stream || !target) return null
    if (!stream.dirty && !opts.final) return stream.lastReceipt || null
    if (!stream.buffer && !opts.final) return stream.lastReceipt || null
    if (!this.outbox) throw new Error('outbox required')

    stream.flushSeq += 1
    const text = stream.buffer
    /** @type {import('./outbox/types.js').DeliveryReceipt | null} */
    let receipt = null

    if (!stream.sentId) {
      const operationId = `stream:${sid}:send:${stream.flushSeq}`
      const operationType = target.replyTo ? 'replyMessage' : 'sendMessage'
      receipt = await this.outbox.enqueue({
        operationId,
        accountId: target.accountId,
        operationType,
        target: {
          channelId: target.channelId,
          messageId: target.replyTo,
        },
        payload: {
          content: text,
          replyTo: target.replyTo,
        },
        correlationId: target.correlationId,
        useNonce: operationType === 'sendMessage',
      })
      receipt = await this._driveOperation(operationId, target.accountId)
      if (receipt?.state === 'delivered' && receipt.discord_resource_id) {
        stream.sentId = receipt.discord_resource_id
      }
    } else {
      const operationId = `stream:${sid}:edit:${stream.flushSeq}`
      receipt = await this.outbox.enqueue({
        operationId,
        accountId: target.accountId,
        operationType: 'editMessage',
        target: {
          channelId: target.channelId,
          messageId: stream.sentId,
        },
        payload: { content: text },
        correlationId: target.correlationId,
        useNonce: false,
      })
      receipt = await this._driveOperation(operationId, target.accountId)
    }

    stream.lastReceipt = receipt
    stream.dirty = false
    return receipt
  }

  /**
   * Drive one operation until delivered, retry_wait, or failed_terminal.
   * Does not fail the DSH turn on transport retry_wait.
   * @param {string} operationId
   * @param {string} accountId
   */
  async _driveOperation(operationId, accountId) {
    for (let i = 0; i < 8; i++) {
      const receipt = this.outbox.getReceipt(operationId)
      if (!receipt) return null
      if (receipt.state === 'delivered' || receipt.state === 'failed_terminal' || receipt.state === 'retry_wait') {
        return receipt
      }
      await this.outbox.tick({ accountId })
    }
    return this.outbox.getReceipt(operationId)
  }

  /**
   * @param {string} sessionId
   * @param {import('./types.js').PlatformEvent} event
   */
  _attachOutput(sessionId, event) {
    if (this.streams.has(sessionId)) return
    this.streams.set(sessionId, {
      buffer: '',
      sentId: undefined,
      dirty: false,
      flushSeq: 0,
      lastReceipt: undefined,
    })

    const listener = async (_session, sessionEvent) => {
      const sid = String(sessionId)
      const stream = this.streams.get(sid)
      if (!stream) return

      if (sessionEvent?.type === 'assistant/chunk') {
        const delta = extractAssistantText(sessionEvent)
        if (!delta) return
        stream.buffer += delta
        stream.dirty = true
        // Coalesce: do not enqueue per token. Flush on message / turn/end / explicit flushOutbound.
        return
      }

      if (sessionEvent?.type === 'assistant/message') {
        const text = extractAssistantText(sessionEvent) || stream.buffer
        stream.buffer = text
        stream.dirty = true
        try {
          await this.flushOutbound(sid, { final: true })
        } catch (err) {
          this.logger?.warn?.(`outbound flush failed: ${err?.message || err}`)
        }
        return
      }

      if (sessionEvent?.type === 'turn/end') {
        if (stream.dirty) {
          try {
            await this.flushOutbound(sid, { final: true })
          } catch (err) {
            this.logger?.warn?.(`outbound end flush failed: ${err?.message || err}`)
          }
        }
        stream.buffer = ''
        stream.dirty = false
        // keep sentId for later turns on same session
        return
      }

      if (sessionEvent?.type === 'error/failure') {
        stream.buffer = ''
        stream.dirty = false
      }
    }

    if (typeof this.onSessionEvent === 'function') {
      this.onSessionEvent(sessionId, listener)
    } else {
      // Test agents without Cordis session bus.
      const handle = this.handles.get(sessionId)
      if (handle?.agent && typeof handle.agent.__emitSessionEvent === 'function') {
        handle.agent.__onSessionEvent = listener
      }
    }

    void event
  }
}
