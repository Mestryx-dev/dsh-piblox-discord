/**
 * Gateway intents exposed to operators (names, not bitfields).
 * Privileged intents are labeled; defaults stay least-privilege.
 */

/** @typedef {{ id: string, label: string, privileged?: boolean, default?: boolean }} IntentOption */

/** @type {readonly IntentOption[]} */
export const INTENT_OPTIONS = Object.freeze([
  { id: 'Guilds', label: 'Guilds', default: true },
  { id: 'GuildMessages', label: 'Guild messages', default: true },
  { id: 'GuildMessageReactions', label: 'Guild message reactions' },
  { id: 'DirectMessages', label: 'Direct messages', default: true },
  { id: 'DirectMessageReactions', label: 'Direct message reactions' },
  { id: 'MessageContent', label: 'Message content', privileged: true, default: true },
  { id: 'GuildMembers', label: 'Guild members', privileged: true },
  { id: 'GuildPresences', label: 'Guild presences', privileged: true },
  { id: 'GuildModeration', label: 'Guild moderation' },
  { id: 'GuildWebhooks', label: 'Guild webhooks' },
  { id: 'GuildInvites', label: 'Guild invites' },
  { id: 'GuildVoiceStates', label: 'Guild voice states' },
  { id: 'GuildScheduledEvents', label: 'Guild scheduled events' },
  { id: 'AutoModerationConfiguration', label: 'AutoMod configuration' },
  { id: 'AutoModerationExecution', label: 'AutoMod execution' },
])

export const INTENT_IDS = Object.freeze(INTENT_OPTIONS.map((i) => i.id))

/**
 * @param {unknown} intents
 * @returns {string[]}
 */
export function normalizeIntents(intents) {
  if (intents == null) {
    return INTENT_OPTIONS.filter((i) => i.default).map((i) => i.id)
  }
  if (!Array.isArray(intents)) throw new TypeError('intents must be an array of intent names')
  const allowed = new Set(INTENT_IDS)
  const out = []
  for (const raw of intents) {
    const id = String(raw)
    if (!allowed.has(id)) throw new TypeError(`unknown intent: ${id}`)
    if (!out.includes(id)) out.push(id)
  }
  return out
}
