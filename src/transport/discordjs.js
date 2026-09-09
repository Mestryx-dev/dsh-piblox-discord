/**
 * Discord.js transport skeleton — compiles against discord.js 14.x.
 * Does NOT connect to Discord Gateway/REST in this spike (no token, no login).
 */

/**
 * @typedef {import('./transport.js').DiscordTransport} DiscordTransport
 * @typedef {import('./transport.js').InboundHandler} InboundHandler
 * @typedef {import('../types.js').OutboundMessage} OutboundMessage
 * @typedef {import('../types.js').SentMessage} SentMessage
 */

/**
 * Skeleton adapter validating discord.js is importable.
 * Calling startAccount without an explicit allowConnect flag throws.
 * @implements {DiscordTransport}
 */
export class DiscordJsTransport {
  constructor(options = {}) {
    /** @type {boolean} */
    this.allowConnect = Boolean(options.allowConnect)
    /** @type {Set<string>} */
    this.running = new Set()
    /** @type {InboundHandler[]} */
    this.handlers = []
    /** @type {typeof import('discord.js') | null} */
    this._discord = null
  }

  async _loadDiscord() {
    if (!this._discord) {
      this._discord = await import('discord.js')
    }
    return this._discord
  }

  /**
   * Type/compile smoke: ensure Client + GatewayIntentBits exist.
   * Also verify reliability-relevant APIs exist for the live phase (DESIGNED_FOR_LIVE).
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
    // RateLimitError / DiscordAPIError surface Retry-After / status for outbox classification.
    const hasRateLimitError = typeof djs.RateLimitError === 'function' || typeof djs.DiscordAPIError === 'function'
    return {
      package: 'discord.js',
      hasClient: true,
      hasGatewayIntentBits: true,
      hasRateLimitErrorSurface: hasRateLimitError,
      supportsNonceEnforceNonce: true, // Create Message body fields; live REST will pass through OutboundMessage
      restCalls: 0,
    }
  }

  /**
   * Document how live REST errors will feed the outbox scheduler later.
   * No network I/O.
   */
  describeReliabilityContract() {
    return {
      rateLimit: 'Map DiscordAPIError/RateLimitError status 429 + retryAfter → TransportError(429, {retryAfterMs})',
      restErrors: '5xx → retryable; 401 → auth isolate account; 403/404 → terminal domain',
      resourceIds: 'Returned message/channel/thread snowflakes become discord_resource_id',
      nonce: 'OutboundMessage.nonce + enforceNonce forwarded on Create Message',
      live: false,
    }
  }

  /** @param {string} accountId */
  async startAccount(accountId) {
    if (!this.allowConnect) {
      throw new Error(
        'DiscordJsTransport: live connect disabled in V1 spike (set allowConnect only under explicit operator authorization)',
      )
    }
    void accountId
    throw new Error('DiscordJsTransport: live Gateway not implemented in this spike')
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

  async sendMessage() {
    throw new Error('DiscordJsTransport: live REST not implemented in this spike')
  }

  async replyMessage() {
    throw new Error('DiscordJsTransport: live REST not implemented in this spike')
  }

  async editMessage() {
    throw new Error('DiscordJsTransport: live REST not implemented in this spike')
  }
}
