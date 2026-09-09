/**
 * Shared admin HTTP fence for Discord operator routes on webServer.
 *
 * OBSERVED: @deepseek-ai/dsh-host-webserver has NO server-wide auth.
 * Canonical guard: ctx.connection.requestRejection.
 * Same-origin alone is CSRF defense — never sufficient for account/credential mutation.
 */

/** @typedef {401|403} AdminRejection */

/**
 * @param {import('node:http').IncomingMessage} req
 */
export function sameOrigin(req) {
  const LOOPBACK = /^(127\.0\.0\.1|\[::1\]|localhost)(:\d+)?$/i
  const host = String(req.headers.host || '')
  if (!LOOPBACK.test(host)) {
    const origin = req.headers.origin
    if (!origin) return true
    try {
      const oh = new URL(String(origin)).host
      return oh === host || LOOPBACK.test(oh)
    } catch {
      return false
    }
  }
  const origin = req.headers.origin
  if (!origin) return true
  try {
    return LOOPBACK.test(new URL(String(origin)).host)
  } catch {
    return false
  }
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {{ requestRejection(request: { headers: import('node:http').IncomingHttpHeaders }): AdminRejection | undefined } | undefined} adminAuth
 * @returns {AdminRejection | 503 | null}
 */
export function rejectAdminRequest(req, adminAuth) {
  if (!sameOrigin(req)) return 403
  if (!adminAuth || typeof adminAuth.requestRejection !== 'function') {
    return 503
  }
  const rejection = adminAuth.requestRejection({ headers: req.headers })
  return rejection ?? null
}
