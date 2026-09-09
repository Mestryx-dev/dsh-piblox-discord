/**
 * Pure UI helpers for Discord Settings (testable without ModuleLoader).
 * Visual tokens mirror @deepseek-ai/dsh-client-ui-primitives + ui-settings-plugins fields.
 */

/** Common intents shown expanded; the rest live under Advanced. */
export const COMMON_INTENT_IDS = Object.freeze([
  'Guilds',
  'GuildMessages',
  'DirectMessages',
  'MessageContent',
])

/** @typedef {'done'|'warning'|'ongoing'|'error'|'neutral'} StatusTone */

/**
 * Map backend runtime status → StateDot-like tone (DSH StateDot semantics).
 * @param {string} status
 * @returns {StatusTone}
 */
export function statusTone(status) {
  switch (status) {
    case 'connected':
      return 'done'
    case 'starting':
    case 'stopped':
    case 'disconnected':
      return 'ongoing'
    case 'missing_credentials':
    case 'rate_limited':
      return 'warning'
    case 'failed_auth':
    case 'error':
      return 'error'
    case 'disabled':
    default:
      return 'neutral'
  }
}

/**
 * Human label for scope_summary codes from the accounts API.
 * @param {'guilds'|'channels'|'dm'} kind
 * @param {string | undefined} code
 */
export function formatScopeLabel(kind, code) {
  const c = code || 'deny_all'
  if (kind === 'dm') {
    if (c === 'disabled') return 'disabled'
    if (c === 'all_users') return 'allow all users'
    if (c === 'deny_all') return 'deny all'
    if (c.endsWith('_users')) return `${c.replace(/_users$/, '')} users`
    return c
  }
  if (c === 'all') return 'allow all'
  if (c === 'deny_all') return 'deny all'
  return `${c} listed`
}

/**
 * Split intent catalog into common vs advanced.
 * @param {Array<{ id: string, label: string, privileged?: boolean, default?: boolean }>} intents
 */
export function partitionIntents(intents) {
  const list = Array.isArray(intents) ? intents : []
  const commonIds = new Set(COMMON_INTENT_IDS)
  const common = []
  const advanced = []
  for (const intent of list) {
    if (commonIds.has(intent.id)) common.push(intent)
    else advanced.push(intent)
  }
  // Preserve common order from COMMON_INTENT_IDS
  common.sort((a, b) => COMMON_INTENT_IDS.indexOf(a.id) - COMMON_INTENT_IDS.indexOf(b.id))
  return { common, advanced }
}

/**
 * Fail-closed DM summary for operator UI.
 * @param {{ enabled?: boolean, allowAllUsers?: boolean, allowedUsers?: string[] } | null | undefined} dm
 */
export function dmFailClosedSummary(dm) {
  if (!dm || !dm.enabled) return 'disabled'
  if (dm.allowAllUsers) return 'allow_all'
  if (!dm.allowedUsers || dm.allowedUsers.length === 0) return 'deny_all'
  return 'allowlist'
}

/**
 * Assert a public account object never embeds a canary token value.
 * @param {unknown} obj
 * @param {string} canary
 */
export function publicAccountOmitsCanary(obj, canary) {
  return !JSON.stringify(obj).includes(canary)
}
