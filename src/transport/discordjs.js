/**
 * Discord.js transport — per-account Client lifecycle (discord.js 14.x / API v10).
 *
 * Safety: allowConnect defaults false. Profile boot / imports never login unless
 * Cordis config explicitly sets allowConnect=true (operator-authorized LAB smoke).
 *
 * Credentials: resolve via injected secrets.resolve(ref) only — never process.env,
 * never persist resolved token into ledger/outbox.
 */

import { mapDiscordJsError } from '../discord-errors.js'
import { TransportError } from './fake.js'
import { encodeOutboundComponents, defaultAllowedMentions } from '../components/encode.js'
import { normalizeInteractionCreate } from '../components/normalize-interaction.js'

/**
 * @typedef {import('./transport.js').DiscordTransport} DiscordTransport
 * @typedef {import('./transport.js').InboundHandler} InboundHandler
 * @typedef {import('../types.js').OutboundMessage} OutboundMessage
 * @typedef {import('../types.js').SentMessage} SentMessage
 * @typedef {import('../types.js').PlatformEvent} PlatformEvent
 */

/** Smoke-minimum intents (mission). */
export const LIVE_SMOKE_INTENT_IDS = Object.freeze(['Guilds', 'GuildMessages', 'MessageContent'])

/**
 * Map intent name strings → GatewayIntentBits values.
 * @param {typeof import('discord.js')} djs
 * @param {string[]} intentIds
 */
export function resolveGatewayIntents(djs, intentIds) {
  const bits = djs.GatewayIntentBits
  const out = []
  for (const id of intentIds || []) {
    if (bits[id] == null) {
      throw new TypeError(`unknown GatewayIntentBits: ${id}`)
    }
    out.push(bits[id])
  }
  return out
}

/**
 * Normalize a discord.js Message into the plugin PlatformEvent (no Message object leak).
 * @param {string} accountId
 * @param {any} message
 * @returns {PlatformEvent}
 */
export function normalizeMessageCreate(accountId, message) {
  const channel = message?.channel
  // Fail closed on DM classification: only treat as DM when positively identified.
  // Do NOT infer DM merely because guildId/channel cache is missing (that silently
  // routes guild MESSAGE_CREATE into dm_disabled before dedupe claim).
  const isDm = Boolean(channel?.isDMBased?.() === true)
  const isThread =
    typeof channel?.isThread === 'function'
      ? Boolean(channel.isThread())
      : Boolean(channel?.isThread)
  const threadId = isThread ? String(message.channelId) : undefined
  // Thread channel_id is the thread snowflake; parent_id is the launcher channel.
  const parentChannelId =
    isThread && channel?.parentId != null
      ? String(channel.parentId)
      : isThread && message?.channel?.parentId != null
        ? String(message.channel.parentId)
        : undefined

  return {
    type: 'discord.message.created',
    accountId: String(accountId),
    eventId: String(message?.id || ''),
    messageId: String(message?.id || ''),
    guildId: message?.guildId != null ? String(message.guildId) : undefined,
    channelId: String(message?.channelId || ''),
    threadId,
    parentChannelId,
    userId: String(message?.author?.id || ''),
    content: String(message?.content ?? ''),
    isBot: Boolean(message?.author?.bot),
    isDm,
    raw: {
      timestamp: message?.createdAt?.toISOString?.() || message?.createdTimestamp || null,
      author_bot: Boolean(message?.author?.bot),
      parent_id: parentChannelId || null,
    },
  }
}

/**
 * Build REST create/edit body from OutboundMessage (nonce / enforce_nonce preserved).
 * Components encode from ComponentNode tree (Components V2 when applicable).
 * @param {OutboundMessage} payload
 */
export function toDiscordMessageBody(payload) {
  /** @type {Record<string, unknown>} */
  const body = {}
  const encoded =
    payload?.components && Array.isArray(payload.components) && payload.components.length
      ? encodeOutboundComponents(payload.components, {
          componentsV2: payload.componentsV2,
        })
      : null

  // Components V2 messages must not mix classic `content` with the V2 flag.
  if (encoded?.encoding === 'components_v2') {
    body.components = encoded.components
    body.flags = encoded.flags | (payload?.flags ? Number(payload.flags) : 0)
  } else {
    if (payload?.content != null) body.content = payload.content
    if (encoded?.components?.length) body.components = encoded.components
    if (payload?.flags != null) body.flags = Number(payload.flags)
  }

  if (payload?.embeds != null) body.embeds = payload.embeds
  if (payload?.nonce != null) body.nonce = String(payload.nonce)
  if (payload?.enforceNonce != null) body.enforceNonce = Boolean(payload.enforceNonce)
  body.allowedMentions = payload?.allowedMentions || defaultAllowedMentions()
  if (payload?.ephemeral) {
    // MessageFlags.Ephemeral = 64 — for interaction responses only
    body.flags = (Number(body.flags) || 0) | 64
  }
  if (payload?.replyTo) {
    body.reply = { messageReference: String(payload.replyTo), failIfNotExists: false }
  }
  return body
}

/**
 * @implements {DiscordTransport}
 */
export class DiscordJsTransport {
  /**
   * @param {{
   *   allowConnect?: boolean,
   *   resolveCredential?: (ref: string) => Promise<{ ok?: boolean, value?: string } | string | null> | { ok?: boolean, value?: string } | string | null,
   *   createClient?: (args: { accountId: string, intents: number[], discord: any }) => Promise<any> | any,
   *   importDiscord?: () => Promise<any>,
   *   logger?: { info?: Function, warn?: Function, debug?: Function },
   * }} [options]
   */
  constructor(options = {}) {
    /** @type {boolean} */
    this.allowConnect = Boolean(options.allowConnect)
    this.resolveCredential = options.resolveCredential || null
    this.createClient = options.createClient || null
    this.importDiscord = options.importDiscord || null
    this.logger = options.logger || null

    /** @type {Set<string>} */
    this.running = new Set()
    /** @type {Set<string>} */
    this.connected = new Set()
    /** @type {Map<string, 'starting'|'connected'|'disconnected'|'failed_auth'|'error'>} */
    this.statuses = new Map()
    /** @type {Map<string, { client: any }>} */
    this.clients = new Map()
    /** @type {InboundHandler[]} */
    this.handlers = []
    /** @type {typeof import('discord.js') | null} */
    this._discord = null
    /**
     * Bounded REST/rate-limit observations (no secrets).
     * @type {Array<Record<string, unknown>>}
     */
    this.restObservations = []
    /** @type {Map<string, any>} interactionId → discord.js Interaction (ACK window) */
    this._interactions = new Map()
  }

  async _loadDiscord() {
    if (!this._discord) {
      this._discord = this.importDiscord
        ? await this.importDiscord()
        : await import('discord.js')
    }
    return this._discord
  }

  /**
   * Type/compile smoke: ensure Client + GatewayIntentBits exist.
   * Never logs in.
   */
  async validateDependency() {
    const djs = await this._loadDiscord()
    if (typeof djs.Client !== 'function') {
      throw new Error('discord.js Client missing')
    }
    if (!djs.GatewayIntentBits) {
      throw new Error('discord.js GatewayIntentBits missing')
    }
    const hasRateLimitError =
      typeof djs.RateLimitError === 'function' || typeof djs.DiscordAPIError === 'function'
    return {
      package: 'discord.js',
      hasClient: true,
      hasGatewayIntentBits: true,
      hasRateLimitErrorSurface: hasRateLimitError,
      supportsNonceEnforceNonce: true,
      restCalls: 0,
      allowConnect: this.allowConnect,
    }
  }

  describeReliabilityContract() {
    return {
      rateLimit:
        'mapDiscordJsError(RateLimitError[/route]) → TransportError(429, {retryAfterMs}) via outbox dispatch',
      restErrors:
        'DiscordAPIError[code] 5xx→retryable; 401→auth isolate; 403/50013/50001→permission; 404/10003/10008→unknown_target',
      resourceIds: 'Returned message/channel/thread snowflakes become discord_resource_id',
      nonce: 'OutboundMessage.nonce + enforceNonce forwarded on Create Message',
      live: this.allowConnect,
      observedSurfaces: [
        'discord.js RateLimitError.retryAfter / timeToReset',
        'DiscordAPIError.status / code',
        'HTTPError.status',
        'Client rest rateLimit / invalidRequestWarning (if emitted)',
      ],
      bucketEngineStatus: 'NOT_PROVEN_IN_SMOKE',
    }
  }

  /**
   * @param {string} ref
   * @param {{ token?: string }} [options]
   */
  async _resolveToken(ref, options = {}) {
    // Test-only escape: never used in Cordis production wiring.
    if (options.token != null) {
      throw new Error('DiscordJsTransport: inline token option forbidden')
    }
    if (!ref) {
      throw new TransportError('auth', 'missing credentials ref')
    }
    if (!this.resolveCredential) {
      throw new TransportError('auth', 'secrets.resolve not wired')
    }
    const result = await this.resolveCredential(ref)
    if (result == null) return null
    if (typeof result === 'string') return result || null
    if (typeof result === 'object' && result.ok === false) return null
    if (typeof result === 'object' && typeof result.value === 'string') {
      return result.value || null
    }
    return null
  }

  /** @param {string} accountId */
  getAccountStatus(accountId) {
    return this.statuses.get(accountId) || (this.running.has(accountId) ? 'starting' : 'disconnected')
  }

  /** @param {string} accountId */
  isAccountConnected(accountId) {
    return this.connected.has(accountId)
  }

  /**
   * @param {string} accountId
   * @param {{ credentialsRef?: string, intents?: string[] }} [options]
   */
  async startAccount(accountId, options = {}) {
    if (!this.allowConnect) {
      throw new Error(
        'DiscordJsTransport: live connect disabled (set allowConnect=true only under explicit operator authorization)',
      )
    }
    const id = String(accountId)
    if (this.running.has(id) && this.clients.has(id)) {
      return
    }

    this.statuses.set(id, 'starting')
    let token = null
    /** @type {any} */
    let client = null
    try {
      token = await this._resolveToken(options.credentialsRef || '', options)
      if (!token) {
        this.statuses.set(id, 'failed_auth')
        throw new TransportError('auth', `missing_credentials: ${id}`)
      }

      const djs = await this._loadDiscord()
      const intentIds =
        Array.isArray(options.intents) && options.intents.length
          ? options.intents
          : [...LIVE_SMOKE_INTENT_IDS]
      const intents = resolveGatewayIntents(djs, intentIds)

      client = this.createClient
        ? await this.createClient({ accountId: id, intents, discord: djs })
        : new djs.Client({ intents })

      this._wireClient(id, client)

      await client.login(token)
      this.clients.set(id, { client })
      this.running.add(id)
    } catch (err) {
      const mapped = mapDiscordJsError(err)
      const isAuth =
        mapped instanceof TransportError &&
        (mapped.code === 'auth' || /token|401|unauthorized/i.test(mapped.message))
      this.statuses.set(id, isAuth ? 'failed_auth' : 'error')
      this.connected.delete(id)
      this.running.delete(id)
      this.clients.delete(id)
      if (client) {
        try {
          await client.destroy?.()
        } catch {
          /* ignore */
        }
      }
      this.logger?.warn?.(
        `discordjs: startAccount failed account=${id} status=${this.statuses.get(id)}`,
      )
      throw mapped
    } finally {
      token = null
    }
  }

  /**
   * @param {string} accountId
   * @param {any} client
   */
  _wireClient(accountId, client) {
    const onReady = () => {
      this.connected.add(accountId)
      this.statuses.set(accountId, 'connected')
      this.logger?.info?.(`discordjs: account connected account=${accountId}`)
    }
    const onDisconnect = () => {
      this.connected.delete(accountId)
      if (this.statuses.get(accountId) !== 'failed_auth') {
        this.statuses.set(accountId, 'disconnected')
      }
    }
    client.on?.('clientReady', onReady)
    client.on?.('ready', onReady)
    client.on?.('shardDisconnect', onDisconnect)
    client.on?.('invalidated', () => {
      this.statuses.set(accountId, 'failed_auth')
      this.connected.delete(accountId)
    })
    client.on?.('error', (err) => {
      this.logger?.warn?.(
        `discordjs: client error account=${accountId} name=${err?.name || 'Error'}`,
      )
      if (this.statuses.get(accountId) === 'connected') {
        this.statuses.set(accountId, 'error')
      }
    })

    // Observe rate-limit metadata without claiming a full bucket engine.
    const rest = client.rest
    if (rest?.on) {
      rest.on('rateLimited', (info) => {
        this.restObservations.push({
          kind: 'rateLimited',
          accountId,
          timeout: info?.timeout,
          limit: info?.limit,
          method: info?.method,
          hash: info?.hash,
          url: info?.url ? String(info.url).slice(0, 120) : undefined,
          route: info?.route,
          global: info?.global,
        })
        if (this.restObservations.length > 50) this.restObservations.shift()
      })
    }

    client.on?.('messageCreate', (message) => {
      void this._dispatchMessageCreate(accountId, message)
    })

    client.on?.('interactionCreate', (interaction) => {
      void this._dispatchInteractionCreate(accountId, interaction)
    })

    // Diagnostic: prove whether Gateway delivers MESSAGE_CREATE at all (stdout; no token/content).
    client.on?.('raw', (packet) => {
      if (packet?.t !== 'MESSAGE_CREATE') return
      const d = packet.d || {}
      // eslint-disable-next-line no-console
      console.warn(
        `discordjs: raw MESSAGE_CREATE account=${accountId} id=${d.id || ''} channel=${d.channel_id || ''} guild=${d.guild_id || ''} author=${d.author?.id || ''} handlers=${this.handlers.length}`,
      )
    })
  }

  /**
   * @param {string} accountId
   * @param {any} message
   */
  async _dispatchMessageCreate(accountId, message) {
    // eslint-disable-next-line no-console
    console.warn(
      `discordjs: messageCreate account=${accountId} id=${message?.id || ''} channel=${message?.channelId || ''} guild=${message?.guildId || ''} author=${message?.author?.id || ''} handlers=${this.handlers.length}`,
    )
    let event
    try {
      event = normalizeMessageCreate(accountId, message)
    } catch (err) {
      this.logger?.warn?.(
        `discordjs: normalize failed account=${accountId} err=${err instanceof Error ? err.message : err}`,
      )
      // eslint-disable-next-line no-console
      console.warn(`discordjs: normalize failed account=${accountId}`)
      return
    }
    if (this.handlers.length === 0) {
      // eslint-disable-next-line no-console
      console.warn(`discordjs: DROP messageCreate — no inbound handlers account=${accountId}`)
    }
    for (const handler of [...this.handlers]) {
      try {
        await handler(event)
      } catch (err) {
        this.logger?.warn?.(
          `discordjs: inbound handler error account=${accountId} err=${err instanceof Error ? err.message : err}`,
        )
        // eslint-disable-next-line no-console
        console.warn(
          `discordjs: inbound handler error account=${accountId} err=${err instanceof Error ? err.message : err}`,
        )
      }
    }
  }

  /**
   * @param {string} accountId
   * @param {any} interaction
   */
  async _dispatchInteractionCreate(accountId, interaction) {
    const id = interaction?.id != null ? String(interaction.id) : ''
    if (id) this._interactions.set(`${accountId}:${id}`, interaction)
    // eslint-disable-next-line no-console
    console.warn(
      `discordjs: interactionCreate account=${accountId} id=${id} type=${interaction?.type ?? ''} custom=${interaction?.customId || ''} channel=${interaction?.channelId || ''} handlers=${this.handlers.length}`,
    )
    let event
    try {
      event = normalizeInteractionCreate(accountId, interaction, { deliveryMode: 'gateway' })
    } catch (err) {
      this.logger?.warn?.(
        `discordjs: interaction normalize failed account=${accountId} err=${err instanceof Error ? err.message : err}`,
      )
      return
    }
    for (const handler of [...this.handlers]) {
      try {
        await handler(event)
      } catch (err) {
        this.logger?.warn?.(
          `discordjs: interaction handler error account=${accountId} err=${err instanceof Error ? err.message : err}`,
        )
      }
    }
  }

  /**
   * @param {string} accountId
   * @param {string} interactionId
   */
  _requireInteraction(accountId, interactionId) {
    const key = `${accountId}:${interactionId}`
    const ix = this._interactions.get(key)
    if (!ix) {
      throw new TransportError('unknown_target', `interaction not found: ${interactionId}`)
    }
    return ix
  }

  /**
   * @param {string} accountId
   * @param {string} interactionId
   * @param {{ ephemeral?: boolean, update?: boolean }} [opts]
   */
  async deferInteraction(accountId, interactionId, opts = {}) {
    try {
      const ix = this._requireInteraction(accountId, interactionId)
      if (opts.update && typeof ix.deferUpdate === 'function') {
        await ix.deferUpdate()
      } else {
        await ix.deferReply({ ephemeral: Boolean(opts.ephemeral), fetchReply: false })
      }
      return {
        accountId,
        channelId: String(ix.channelId || ''),
        messageId: String(interactionId),
        threadId: ix.channel?.isThread?.() ? String(ix.channelId) : undefined,
      }
    } catch (err) {
      throw mapDiscordJsError(err)
    }
  }

  /**
   * @param {string} accountId
   * @param {string} interactionId
   * @param {OutboundMessage} payload
   */
  async followUpInteraction(accountId, interactionId, payload) {
    try {
      const ix = this._requireInteraction(accountId, interactionId)
      const body = toDiscordMessageBody(payload)
      delete body.nonce
      delete body.enforceNonce
      delete body.reply
      const sent = await ix.followUp(body)
      return {
        accountId,
        channelId: String(ix.channelId || sent?.channelId || ''),
        messageId: String(sent?.id || ''),
        guildId: sent?.guildId != null ? String(sent.guildId) : undefined,
        threadId: ix.channel?.isThread?.() ? String(ix.channelId) : undefined,
      }
    } catch (err) {
      throw mapDiscordJsError(err)
    }
  }

  /**
   * @param {string} accountId
   * @param {string} interactionId
   * @param {OutboundMessage} payload
   */
  async editInteractionReply(accountId, interactionId, payload) {
    try {
      const ix = this._requireInteraction(accountId, interactionId)
      const body = toDiscordMessageBody(payload)
      delete body.nonce
      delete body.enforceNonce
      delete body.reply
      const sent = await ix.editReply(body)
      return {
        accountId,
        channelId: String(ix.channelId || ''),
        messageId: String(sent?.id || interactionId),
        guildId: sent?.guildId != null ? String(sent.guildId) : undefined,
      }
    } catch (err) {
      throw mapDiscordJsError(err)
    }
  }

  /**
   * Component message update (or reply-as-update when not yet deferred).
   * @param {string} accountId
   * @param {string} interactionId
   * @param {OutboundMessage} payload
   */
  async updateInteraction(accountId, interactionId, payload) {
    try {
      const ix = this._requireInteraction(accountId, interactionId)
      const body = toDiscordMessageBody(payload)
      delete body.nonce
      delete body.enforceNonce
      delete body.reply
      if (typeof ix.update === 'function' && !ix.deferred && !ix.replied) {
        await ix.update(body)
      } else if (typeof ix.editReply === 'function') {
        await ix.editReply(body)
      } else {
        throw new TransportError('invalid_payload', 'interaction update not available')
      }
      return {
        accountId,
        channelId: String(ix.channelId || ''),
        messageId: String(ix.message?.id || interactionId),
      }
    } catch (err) {
      throw mapDiscordJsError(err)
    }
  }

  /** @param {string} accountId */
  async stopAccount(accountId) {
    const id = String(accountId)
    const entry = this.clients.get(id)
    this.running.delete(id)
    this.connected.delete(id)
    this.statuses.set(id, 'disconnected')
    this.clients.delete(id)
    if (entry?.client) {
      try {
        await entry.client.destroy?.()
      } catch (err) {
        this.logger?.warn?.(
          `discordjs: destroy failed account=${id} err=${err instanceof Error ? err.message : err}`,
        )
      }
    }
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
   * @param {string} accountId
   */
  _requireClient(accountId) {
    const entry = this.clients.get(accountId)
    if (!entry?.client) {
      throw new TransportError('auth', `account not connected: ${accountId}`)
    }
    return entry.client
  }

  /**
   * @param {string} accountId
   * @param {string} channelId
   * @param {OutboundMessage} payload
   * @returns {Promise<SentMessage>}
   */
  async sendMessage(accountId, channelId, payload) {
    try {
      const client = this._requireClient(accountId)
      const channel = await client.channels.fetch(String(channelId))
      if (!channel || typeof channel.send !== 'function') {
        throw new TransportError('unknown_target', `channel not sendable: ${channelId}`)
      }
      const body = toDiscordMessageBody(payload)
      const sent = await channel.send(body)
      return {
        accountId,
        channelId: String(channelId),
        messageId: String(sent.id),
        guildId: sent.guildId != null ? String(sent.guildId) : undefined,
      }
    } catch (err) {
      throw mapDiscordJsError(err)
    }
  }

  /**
   * @param {string} accountId
   * @param {string} channelId
   * @param {string} messageId
   * @param {OutboundMessage} payload
   */
  async replyMessage(accountId, channelId, messageId, payload) {
    return this.sendMessage(accountId, channelId, {
      ...payload,
      replyTo: messageId,
    })
  }

  /**
   * @param {string} accountId
   * @param {string} channelId
   * @param {string} messageId
   * @param {OutboundMessage} payload
   */
  async editMessage(accountId, channelId, messageId, payload) {
    try {
      const client = this._requireClient(accountId)
      const channel = await client.channels.fetch(String(channelId))
      if (!channel || typeof channel.messages?.fetch !== 'function') {
        throw new TransportError('unknown_target', `channel not editable: ${channelId}`)
      }
      const msg = await channel.messages.fetch(String(messageId))
      const body = toDiscordMessageBody(payload)
      delete body.nonce
      delete body.enforceNonce
      delete body.reply
      const edited = await msg.edit(body)
      return {
        accountId,
        channelId: String(channelId),
        messageId: String(edited.id),
        guildId: edited.guildId != null ? String(edited.guildId) : undefined,
      }
    } catch (err) {
      throw mapDiscordJsError(err)
    }
  }

  /**
   * Create a public thread from a parent channel message (preferred) or reconcile
   * an existing thread already started from that message.
   *
   * Required Discord permissions (typical): View Channel, Send Messages,
   * Read Message History, Create Public Threads, Send Messages in Threads.
   * Do not request Administrator / Manage Threads unless API forces it.
   *
   * @param {string} accountId
   * @param {string} parentChannelId
   * @param {{ name?: string, messageId?: string, autoArchiveDuration?: number|string, reason?: string }} [opts]
   * @returns {Promise<SentMessage & { threadId: string, id: string }>}
   */
  async createThread(accountId, parentChannelId, opts = {}) {
    try {
      const client = this._requireClient(accountId)
      const parentId = String(parentChannelId)
      const channel = await client.channels.fetch(parentId)
      if (!channel) {
        throw new TransportError('unknown_target', `parent channel not found: ${parentId}`)
      }
      const name = String(opts.name || 'Conversation').slice(0, 100)
      const messageId = opts.messageId != null ? String(opts.messageId) : ''
      if (!messageId) {
        throw new TransportError(
          'invalid_payload',
          'createThread requires messageId (start thread from parent message)',
        )
      }

      const message = await channel.messages.fetch(messageId)
      const toSent = (thread) => ({
        accountId,
        channelId: String(thread.id),
        messageId,
        threadId: String(thread.id),
        guildId: thread.guildId != null ? String(thread.guildId) : undefined,
        id: String(thread.id),
      })

      if (message.hasThread) {
        let thread = message.thread
        if (!thread && typeof channel.threads?.fetch === 'function') {
          try {
            const fetched = await channel.threads.fetchActive?.()
            // Prefer message.thread; fall through to startThread reconcile below if missing
            thread = message.thread
          } catch {
            /* ignore */
          }
        }
        if (thread?.id) return toSent(thread)
        // Refresh message cache — Discord may have created the thread already
        try {
          const refreshed = await channel.messages.fetch(messageId)
          if (refreshed.thread?.id) return toSent(refreshed.thread)
        } catch {
          /* ignore */
        }
      }

      try {
        const thread = await message.startThread({
          name,
          autoArchiveDuration: opts.autoArchiveDuration ?? 60,
          reason: opts.reason,
        })
        return toSent(thread)
      } catch (err) {
        // Idempotent reconcile: thread already exists for this starter message
        const msg = err instanceof Error ? err.message : String(err)
        if (/already|thread/i.test(msg) || message.hasThread) {
          try {
            const refreshed = await channel.messages.fetch(messageId)
            if (refreshed.thread?.id) return toSent(refreshed.thread)
          } catch {
            /* fall through */
          }
        }
        throw err
      }
    } catch (err) {
      throw mapDiscordJsError(err)
    }
  }
}
