/**
 * DiscordTransport contract — plugin-owned, no discord.js types in the public API.
 */

/**
 * @typedef {import('../types.js').OutboundMessage} OutboundMessage
 * @typedef {import('../types.js').SentMessage} SentMessage
 * @typedef {import('../types.js').PlatformEvent} PlatformEvent
 * @typedef {import('../types.js').SimulatedFailure} SimulatedFailure
 */

/**
 * @typedef {(event: PlatformEvent) => void | Promise<void>} InboundHandler
 */

/**
 * @typedef {{
 *   startAccount(accountId: string, options?: { credentialsRef?: string }): Promise<void>,
 *   stopAccount(accountId: string): Promise<void>,
 *   isAccountRunning(accountId: string): boolean,
 *   onInbound(handler: InboundHandler): () => void,
 *   sendMessage(accountId: string, channelId: string, payload: OutboundMessage): Promise<SentMessage>,
 *   replyMessage(accountId: string, channelId: string, messageId: string, payload: OutboundMessage): Promise<SentMessage>,
 *   editMessage(accountId: string, channelId: string, messageId: string, payload: OutboundMessage): Promise<SentMessage>,
 *   createThread?(accountId: string, parentChannelId: string, opts?: { name?: string, messageId?: string }): Promise<SentMessage & { threadId: string }>,
 *   deferInteraction?(accountId: string, interactionId: string, opts?: { ephemeral?: boolean, update?: boolean }): Promise<SentMessage>,
 *   followUpInteraction?(accountId: string, interactionId: string, payload: OutboundMessage): Promise<SentMessage>,
 *   editInteractionReply?(accountId: string, interactionId: string, payload: OutboundMessage): Promise<SentMessage>,
 *   updateInteraction?(accountId: string, interactionId: string, payload: OutboundMessage): Promise<SentMessage>,
 * }} DiscordTransport
 */

export {}
