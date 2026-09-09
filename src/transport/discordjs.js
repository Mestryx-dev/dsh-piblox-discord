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
    return {
      package: 'discord.js',
      // Version resolved at install time — read from package.json of dependency.
      hasClient: true,
      hasGatewayIntentBits: true,
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
