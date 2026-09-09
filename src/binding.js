/**
 * ConversationBinding identity encoding for Discord (LOCKED after tests).
 *
 * Constraints (OBSERVED conversationBinding):
 * - provider / scope / external_id non-empty
 * - no ':' in any field
 */

/**
 * @typedef {'dm'|'channel'|'thread'|'channel_user'} ConversationKind
 */

/**
 * @typedef {{
 *   provider: 'discord',
 *   scope: string,
 *   external_id: string,
 *   kind: ConversationKind,
 * }} DiscordBindingIdentity
 */

/**
 * @param {string} accountId
 * @param {{
 *   guildId?: string,
 *   channelId: string,
 *   threadId?: string,
 *   userId: string,
 *   isDm?: boolean,
 *   kind?: ConversationKind,
 * }} event
 * @returns {DiscordBindingIdentity}
 */
export function buildBindingIdentity(accountId, event) {
  if (!accountId || accountId.includes(':')) {
    throw new TypeError('buildBindingIdentity: invalid accountId')
  }
  const kind = resolveKind(event)
  switch (kind) {
    case 'dm':
      return {
        provider: 'discord',
        scope: `${accountId}.dm`,
        external_id: requireId(event.userId, 'userId'),
        kind,
      }
    case 'thread':
      return {
        provider: 'discord',
        scope: `${accountId}.thread`,
        external_id: requireId(event.threadId || event.channelId, 'threadId'),
        kind,
      }
    case 'channel_user':
      return {
        provider: 'discord',
        scope: `${accountId}.channel_user`,
        external_id: `${requireId(event.channelId, 'channelId')}.${requireId(event.userId, 'userId')}`,
        kind,
      }
    case 'channel':
      return {
        provider: 'discord',
        scope: `${accountId}.channel`,
        external_id: requireId(event.channelId, 'channelId'),
        kind,
      }
    default: {
      const _exhaustive = kind
      throw new Error(`buildBindingIdentity: unknown kind ${_exhaustive}`)
    }
  }
}

/**
 * @param {{ isDm?: boolean, threadId?: string, kind?: ConversationKind }} event
 * @returns {ConversationKind}
 */
function resolveKind(event) {
  if (event.kind) return event.kind
  if (event.isDm) return 'dm'
  if (event.threadId) return 'thread'
  return 'channel'
}

/** @param {string|undefined} value @param {string} field */
function requireId(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`buildBindingIdentity: ${field} required`)
  }
  if (value.includes(':')) {
    throw new TypeError(`buildBindingIdentity: ${field} must not contain ':'`)
  }
  return value.trim()
}

/**
 * Strip Cordis/ConversationBinding identity fields for resolveOrCreate.
 * @param {DiscordBindingIdentity} identity
 */
export function toExternalIdentity(identity) {
  return {
    provider: identity.provider,
    scope: identity.scope,
    external_id: identity.external_id,
  }
}
