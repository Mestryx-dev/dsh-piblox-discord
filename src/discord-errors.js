/**
 * Map discord.js 14.x error shapes into TransportError / classifyTransportError input.
 * OBSERVED constructors from discord.js@14.27.0 (no live REST).
 *
 * Note: discord.js sets `name` to `RateLimitError[/route]` / `DiscordAPIError[code]` —
 * match via startsWith / instanceof, not exact equality.
 */

import { TransportError } from './transport/fake.js'

/**
 * @param {unknown} err
 * @returns {TransportError | Error}
 */
export function mapDiscordJsError(err) {
  if (!err || typeof err !== 'object') {
    return new TransportError('unknown', String(err))
  }

  const name = String(/** @type {any} */ (err).name || '')
  const status = Number(/** @type {any} */ (err).status)
  const code = /** @type {any} */ (err).code
  const message = String(/** @type {any} */ (err).message || name || 'discord_error')
  const isRateLimit =
    name.startsWith('RateLimitError') ||
    status === 429 ||
    code === 429 ||
    (Number.isFinite(/** @type {any} */ (err).retryAfter) && !Number.isFinite(status))
  const isDiscordApi = name.startsWith('DiscordAPIError') || Number.isFinite(status)
  const isHttp = name.startsWith('HTTPError')

  // RateLimitError (discord.js) exposes retryAfter / timeToReset (ms).
  if (isRateLimit && (name.startsWith('RateLimitError') || status === 429 || code === 429)) {
    const retryAfterMs =
      Number(/** @type {any} */ (err).retryAfter) ||
      Number(/** @type {any} */ (err).timeToReset) ||
      1000
    return new TransportError('429', message || 'rate limited', { retryAfterMs })
  }

  // Pure RateLimitError often has no HTTP status — still map when retryAfter present.
  if (name.startsWith('RateLimitError')) {
    const retryAfterMs =
      Number(/** @type {any} */ (err).retryAfter) ||
      Number(/** @type {any} */ (err).timeToReset) ||
      1000
    return new TransportError('429', message || 'rate limited', { retryAfterMs })
  }

  if (isDiscordApi) {
    if (status >= 500) {
      return new TransportError('5xx', message)
    }
    if (status === 401 || code === 0 || /unauthorized|invalid.?token/i.test(message)) {
      return new TransportError('auth', message)
    }
    // Missing Permissions / Missing Access
    if (status === 403 || code === 50013 || code === 50001) {
      return new TransportError('permission', message)
    }
    // Unknown Channel / Unknown Message
    if (status === 404 || code === 10003 || code === 10008) {
      return new TransportError('unknown_target', message)
    }
    if (status === 400) {
      return new TransportError('invalid_payload', message)
    }
  }

  if (isHttp) {
    if (status >= 500) return new TransportError('5xx', message)
    if (status === 429) {
      return new TransportError('429', message, {
        retryAfterMs: Number(/** @type {any} */ (err).retryAfter) || 1000,
      })
    }
  }

  if (/ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|fetch failed|network/i.test(message)) {
    if (/timed? ?out|ETIMEDOUT/i.test(message)) {
      return new TransportError('timeout', message)
    }
    return new TransportError('connection_reset', message)
  }

  if (err instanceof TransportError) return err

  return new TransportError('unknown', message)
}

/**
 * Wrap a thrown value so outbox classifyTransportError sees normalized codes.
 * @param {unknown} err
 */
export function toClassifiableError(err) {
  const mapped = mapDiscordJsError(err)
  return mapped
}
