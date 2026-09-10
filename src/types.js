/**
 * Shared types and forward-compatible message model for dsh-piblox-discord.
 * No discord.js types leak into the public plugin API.
 *
 * Component kinds / encode helpers live in `./components/` (canonical SSOT for V2 tree).
 */

/**
 * @typedef {import('./components/encode.js').ComponentKind} ComponentKind
 * @typedef {import('./components/encode.js').ComponentNode} ComponentNode
 */

/**
 * Outbound message payload (transport-neutral).
 * @typedef {{
 *   content?: string,
 *   components?: ComponentNode[],
 *   componentsV2?: boolean,
 *   flags?: number,
 *   embeds?: unknown[],
 *   replyTo?: string,
 *   nonce?: string,
 *   enforceNonce?: boolean,
 *   ephemeral?: boolean,
 *   allowedMentions?: { parse?: string[], users?: string[], roles?: string[], repliedUser?: boolean },
 *   raw?: Record<string, unknown>,
 * }} OutboundMessage
 */

/**
 * Sent message receipt.
 * @typedef {{
 *   accountId: string,
 *   channelId: string,
 *   messageId: string,
 *   guildId?: string,
 *   threadId?: string,
 * }} SentMessage
 */

/**
 * Normalized inbound message event (plugin-local; not a Core EVENT_TYPE).
 * @typedef {{
 *   type: 'discord.message.created',
 *   accountId: string,
 *   eventId: string,
 *   guildId?: string,
 *   channelId: string,
 *   threadId?: string,
 *   parentChannelId?: string,
 *   parentMessageId?: string,
 *   userId: string,
 *   messageId: string,
 *   content: string,
 *   isBot?: boolean,
 *   isDm?: boolean,
 *   correlationId?: string,
 *   raw?: Record<string, unknown>,
 * }} PlatformMessageEvent
 */

/**
 * Normalized inbound interaction (delivery-agnostic).
 * Interaction = authenticated transport intent, NOT authorization.
 * @typedef {{
 *   type: 'discord.interaction.created'|'discord.button.clicked'|'discord.select.changed',
 *   accountId: string,
 *   eventId: string,
 *   interactionId: string,
 *   applicationId?: string,
 *   guildId?: string,
 *   channelId: string,
 *   threadId?: string,
 *   parentChannelId?: string,
 *   userId: string,
 *   messageId?: string,
 *   customId?: string,
 *   componentType?: string,
 *   values?: string[],
 *   isBot?: boolean,
 *   isDm?: boolean,
 *   deliveryMode?: 'gateway'|'http_endpoint',
 *   installationContext?: string | null,
 *   interactionContext?: string | null,
 *   timestamp?: string,
 *   correlationId?: string,
 *   sessionId?: string,
 *   raw?: Record<string, unknown>,
 * }} PlatformInteraction
 */

/**
 * @typedef {PlatformMessageEvent | PlatformInteraction} PlatformEvent
 */

/**
 * Simulated transport failure kinds for FakeTransport hooks.
 * @typedef {'429'|'5xx'|'timeout'|'permission'|'auth'|'invalid_payload'|'unknown_target'|'network'|'interaction_expired'|'already_acknowledged'} SimulatedFailure
 */

/**
 * @typedef {{
 *   code: SimulatedFailure,
 *   message?: string,
 *   retryAfterMs?: number,
 * }} TransportFailure
 */

export {
  COMPONENT_KINDS,
  isComponentNode,
} from './components/encode.js'
