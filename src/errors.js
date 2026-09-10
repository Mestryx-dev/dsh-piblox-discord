/**
 * Structured failure classification for Discord transport reliability.
 *
 * LOCKED vocabulary:
 *   transport_failure | discord_domain_failure | dsh_failure | policy_denial
 */

import { createHash } from 'node:crypto'

/**
 * @typedef {'transport_failure'|'discord_domain_failure'|'dsh_failure'|'policy_denial'} ErrorClass
 * @typedef {'retryable'|'terminal'|'ambiguous'} RetryKind
 */

/**
 * @typedef {{
 *   class: ErrorClass,
 *   retry: RetryKind,
 *   code: string,
 *   message: string,
 *   retryAfterMs?: number,
 *   isolateAccount?: boolean,
 * }} ClassifiedError
 */

/**
 * Classify a thrown transport/domain error into retry policy.
 * @param {unknown} err
 * @returns {ClassifiedError}
 */
export function classifyTransportError(err) {
  const code = String(err?.code || err?.name || 'unknown')
  const message = String(err?.message || code)
  const retryAfterMs = Number.isFinite(err?.retryAfterMs) ? Number(err.retryAfterMs) : undefined

  if (code === '429' || /rate.?limit/i.test(message)) {
    return {
      class: 'transport_failure',
      retry: 'retryable',
      code: '429',
      message,
      retryAfterMs: retryAfterMs ?? 1000,
    }
  }
  if (code === '5xx' || /^5\d\d$/.test(code) || /upstream 5/i.test(message)) {
    return {
      class: 'transport_failure',
      retry: 'retryable',
      code: '5xx',
      message,
      retryAfterMs,
    }
  }
  if (code === 'timeout' || /timed? ?out/i.test(message)) {
    return {
      class: 'transport_failure',
      retry: 'ambiguous',
      code: 'timeout',
      message,
    }
  }
  if (code === 'connection_reset' || /ECONNRESET|ECONNREFUSED|ENOTFOUND|network/i.test(message)) {
    return {
      class: 'transport_failure',
      retry: 'retryable',
      code: 'network',
      message,
    }
  }
  if (code === 'auth' || /invalid.?token|unauthorized|401/i.test(message)) {
    return {
      class: 'transport_failure',
      retry: 'terminal',
      code: 'auth',
      message,
      isolateAccount: true,
    }
  }
  if (code === 'permission' || /missing permissions|403|forbidden/i.test(message)) {
    return {
      class: 'discord_domain_failure',
      retry: 'terminal',
      code: 'permission',
      message,
    }
  }
  if (code === 'invalid_payload' || /invalid payload|400/i.test(message)) {
    return {
      class: 'discord_domain_failure',
      retry: 'terminal',
      code: 'invalid_payload',
      message,
    }
  }
  if (code === 'unknown_target' || /unknown channel|unknown message|404/i.test(message)) {
    return {
      class: 'discord_domain_failure',
      retry: 'terminal',
      code: 'unknown_target',
      message,
    }
  }
  if (code === 'nonce_conflict') {
    return {
      class: 'discord_domain_failure',
      retry: 'terminal',
      code: 'nonce_conflict',
      message,
    }
  }
  if (code === 'already_acknowledged' || /already.?been.?acknowledged/i.test(message)) {
    return {
      class: 'discord_domain_failure',
      retry: 'terminal',
      code: 'already_acknowledged',
      message,
    }
  }
  if (code === 'interaction_expired' || /unknown interaction|interaction.?expired/i.test(message)) {
    return {
      class: 'discord_domain_failure',
      retry: 'terminal',
      code: 'interaction_expired',
      message,
    }
  }

  // Default: treat as terminal domain to avoid infinite retry loops on unknowns.
  return {
    class: 'discord_domain_failure',
    retry: 'terminal',
    code: code || 'unknown',
    message,
  }
}

/**
 * Bounded exponential backoff (ms). Jitter is injected for tests.
 * @param {number} attemptCount 1-based after a failure
 * @param {{ baseMs?: number, maxMs?: number, jitterFn?: (n: number) => number }} [opts]
 */
export function computeBackoffMs(attemptCount, opts = {}) {
  const baseMs = opts.baseMs ?? 500
  const maxMs = opts.maxMs ?? 60_000
  const exp = Math.min(maxMs, baseMs * 2 ** Math.max(0, attemptCount - 1))
  const jitterFn = opts.jitterFn || (() => 0)
  const jitter = Math.max(0, Number(jitterFn(exp)) || 0)
  return Math.min(maxMs, exp + jitter)
}

/**
 * Deterministic Discord Create Message nonce from operation_id.
 * Discord enforces nonce length ≤ 25 characters (API v10).
 * @param {string} operationId
 * @returns {string}
 */
export function nonceFromOperationId(operationId) {
  // Hash keeps long stream operation ids (session UUID + turn) within Discord's 25-char cap.
  // Do not prefix with `dsh_` after a 24-char slice — that produced 28-char nonces and
  // failed inaugural thread sends (sendMessage) while replyMessage paths stayed healthy.
  return createHash('sha256').update(String(operationId || '')).digest('hex').slice(0, 25)
}
