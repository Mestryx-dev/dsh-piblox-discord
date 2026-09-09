/**
 * Shared types and forward-compatible message model for dsh-piblox-discord.
 * No discord.js types leak into the public plugin API.
 */

/**
 * @typedef {'TextDisplay'|'Container'|'Section'|'Button'|'Select'|'File'|'ActionRow'|'Unknown'} ComponentKind
 */

/**
 * Forward-compatible component node (Components V2-ready).
 * Unknown kinds use bounded raw metadata — do not assume ActionRow-only.
 * @typedef {{
 *   kind: ComponentKind,
 *   children?: ComponentNode[],
 *   text?: string,
 *   customId?: string,
 *   raw?: Record<string, unknown>,
 * }} ComponentNode
 */

/**
 * Outbound message payload (transport-neutral).
 * @typedef {{
 *   content?: string,
 *   components?: ComponentNode[],
 *   replyTo?: string,
 *   nonce?: string,
 *   enforceNonce?: boolean,
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
 * Normalized inbound platform event (plugin-local; not a Core EVENT_TYPE).
 * @typedef {{
 *   type: 'discord.message.created',
 *   accountId: string,
 *   eventId: string,
 *   guildId?: string,
 *   channelId: string,
 *   threadId?: string,
 *   userId: string,
 *   messageId: string,
 *   content: string,
 *   isBot?: boolean,
 *   isDm?: boolean,
 *   correlationId?: string,
 *   raw?: Record<string, unknown>,
 * }} PlatformEvent
 */

/**
 * Simulated transport failure kinds for FakeTransport hooks.
 * @typedef {'429'|'5xx'|'timeout'|'permission'} SimulatedFailure
 */

/**
 * @typedef {{
 *   code: SimulatedFailure,
 *   message?: string,
 *   retryAfterMs?: number,
 * }} TransportFailure
 */

export const COMPONENT_KINDS = Object.freeze([
  'TextDisplay',
  'Container',
  'Section',
  'Button',
  'Select',
  'File',
  'ActionRow',
  'Unknown',
])

/**
 * @param {unknown} node
 * @returns {node is ComponentNode}
 */
export function isComponentNode(node) {
  return Boolean(node && typeof node === 'object' && typeof /** @type {any} */ (node).kind === 'string')
}
