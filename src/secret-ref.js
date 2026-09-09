/**
 * Discord credential secret references — must satisfy dsh-piblox-secrets name rules:
 *   /^[A-Z][A-Z0-9_]*$/
 *
 * Preferred dotted form `discord.<account_id>.bot_token` is NOT allowed by the vault.
 * LOCKED encoding: DISCORD_<ACCOUNT_ID>_BOT_TOKEN
 *   account_id "lab" → DISCORD_LAB_BOT_TOKEN
 */

/** Account id: lowercase alphanumeric + underscore; maps 1:1 to secret suffix. */
export const ACCOUNT_ID_RE = /^[a-z][a-z0-9_]{0,47}$/

/**
 * @param {string} accountId
 * @returns {string}
 */
export function validateAccountId(accountId) {
  const id = String(accountId || '').trim()
  if (!ACCOUNT_ID_RE.test(id)) {
    throw new TypeError(
      'account_id must match /^[a-z][a-z0-9_]{0,47}$/ (no colon, no uppercase, no dots)',
    )
  }
  return id
}

/**
 * Deterministic vault key for a Discord bot token.
 * @param {string} accountId
 */
export function credentialSecretName(accountId) {
  const id = validateAccountId(accountId)
  return `DISCORD_${id.toUpperCase()}_BOT_TOKEN`
}

/**
 * Discord snowflake as decimal string (never Number).
 * @param {string} value
 */
export function isSnowflakeString(value) {
  return typeof value === 'string' && /^\d{17,20}$/.test(value)
}

/**
 * @param {unknown} list
 * @param {string} field
 * @returns {string[]}
 */
export function normalizeSnowflakeList(list, field = 'id') {
  if (list == null) return []
  if (!Array.isArray(list)) throw new TypeError(`${field} must be an array of snowflake strings`)
  const out = []
  for (const item of list) {
    const s = String(item)
    if (!isSnowflakeString(s)) {
      throw new TypeError(`${field} entries must be Discord snowflake decimal strings (17–20 digits)`)
    }
    out.push(s)
  }
  return out
}
