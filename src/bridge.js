/**
 * DSH session bridge — ConversationBinding + agents.create/get/resume/followup.
 */

import { randomUUID } from 'node:crypto'
import { buildBindingIdentity, toExternalIdentity } from './binding.js'
import { authorizeInbound } from './config.js'
import { buildFollowupMessage } from './message-source.js'

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
 *   accounts: Record<string, import('./config.js').AccountConfig>,
 *   observability?: { mint?: Function, bind?: Function, emit?: Function },
 *   createUserMessage?: Function,
 *   onSessionEvent?: (sessionId: string, listener: Function) => () => void,
 *   logger?: { info?: Function, warn?: Function, debug?: Function },
 * }} BridgeOptions
 */

export class DiscordSessionBridge {
  /** @param {BridgeOptions} options */
  constructor(options) {
    this.conversationBinding = options.conversationBinding
    this.agents = options.agents
    this.transport = options.transport
    this.accounts = options.accounts
    this.observability = options.observability
    this.createUserMessage = options.createUserMessage
    this.onSessionEvent = options.onSessionEvent
    this.logger = options.logger
    /** @type {Map<string, any>} session_id → AgentHandle */
    this.handles = new Map()
    /** @type {Map<string, { accountId: string, channelId: string, replyTo?: string, messageId?: string }>} */
    this.deliveryTargets = new Map()
    /** @type {Map<string, { buffer: string, sentId?: string }>} */
    this.streams = new Map()
    this._unsubInbound = null
  }

  start() {
    this._unsubInbound = this.transport.onInbound((event) => this.handleInbound(event))
  }

  stop() {
    if (this._unsubInbound) this._unsubInbound()
    this._unsubInbound = null
  }

  /**
   * @param {import('./types.js').PlatformEvent} event
   */
  async handleInbound(event) {
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
    if (account.ignoreBots !== false && event.isBot) {
      return { ok: false, reason: 'ignored_bot' }
    }
    if (typeof event.content !== 'string') {
      return { ok: false, reason: 'malformed_event' }
    }

    const auth = authorizeInbound(account, event)
    if (!auth.ok) {
      return { ok: false, reason: auth.reason }
    }

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
    // Prefer live AgentRegistry lookup; drop stale bridge cache entries.
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
        /* closed EVENT_TYPES — ignore contract violations in optional path */
      }
    }

    const message = buildFollowupMessage(this.createUserMessage, event.content, {
      accountId: event.accountId,
      channelId: event.channelId,
      messageId: event.messageId,
    })
    handle.agent.followup(message)

    return { ok: true, sessionId, created, identity }
  }

  /**
   * @param {string} sessionId
   * @param {import('./types.js').PlatformEvent} event
   */
  _attachOutput(sessionId, event) {
    if (this.streams.has(sessionId)) return
    this.streams.set(sessionId, { buffer: '', sentId: undefined })

    const listener = async (_session, sessionEvent) => {
      const sid = String(sessionId)
      const stream = this.streams.get(sid)
      const target = this.deliveryTargets.get(sid)
      if (!stream || !target) return

      if (sessionEvent?.type === 'assistant/chunk') {
        const delta = extractAssistantText(sessionEvent)
        if (!delta) return
        stream.buffer += delta
        try {
          if (!stream.sentId) {
            const sent = await this.transport.sendMessage(target.accountId, target.channelId, {
              content: stream.buffer,
              replyTo: target.replyTo,
            })
            stream.sentId = sent.messageId
          } else {
            await this.transport.editMessage(target.accountId, target.channelId, stream.sentId, {
              content: stream.buffer,
            })
          }
        } catch (err) {
          this.logger?.warn?.(`outbound chunk failed: ${err?.message || err}`)
        }
        return
      }

      if (sessionEvent?.type === 'assistant/message') {
        const text = extractAssistantText(sessionEvent) || stream.buffer
        stream.buffer = text
        try {
          if (!stream.sentId) {
            const sent = target.replyTo
              ? await this.transport.replyMessage(target.accountId, target.channelId, target.replyTo, { content: text })
              : await this.transport.sendMessage(target.accountId, target.channelId, { content: text })
            stream.sentId = sent.messageId
          } else {
            await this.transport.editMessage(target.accountId, target.channelId, stream.sentId, { content: text })
          }
        } catch (err) {
          this.logger?.warn?.(`outbound message failed: ${err?.message || err}`)
        }
        return
      }

      if (sessionEvent?.type === 'turn/end' || sessionEvent?.type === 'error/failure') {
        stream.buffer = ''
        // keep sentId for potential later turns on same session
      }
    }

    if (typeof this.onSessionEvent === 'function') {
      this.onSessionEvent(sessionId, listener)
    }

    // Also allow agent handle to push events via test agents
    const handle = this.handles.get(sessionId)
    if (handle?.agent && typeof handle.agent.__emitSessionEvent === 'function') {
      handle.agent.__onSessionEvent = listener
    }

    void event
  }
}
