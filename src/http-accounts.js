/**
 * Operator HTTP routes for Discord Settings (webServer).
 * Never log or return secret values.
 *
 * AUTH: PLUGIN_REQUIRED — webServer has no upstream admin auth for longer prefixes.
 * Account/credential mutations require Connection.requestRejection; same-origin = CSRF.
 */

import { rejectAdminRequest, sameOrigin } from './admin-auth.js'

/** @typedef {import('./accounts-service.js').createDiscordAccountsService extends (...args: any) => infer R ? R : never} DiscordAccounts */

export const API_PREFIX = '/api/discord'

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {unknown} body
 */
function json(res, status, body) {
  const payload = JSON.stringify(body)
  // Defense: refuse to serialize if canary patterns sneak in (tests assert separately)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(payload)
}

/**
 * @param {import('node:http').IncomingMessage} req
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/**
 * Mutations that change account config or credentials.
 * @param {string} method
 * @param {string[]} parts
 */
function isMutation(method, parts) {
  if (parts[0] !== 'accounts') return false
  if (parts.length === 1 && method === 'POST') return true
  if (parts.length === 2 && (method === 'PATCH' || method === 'PUT' || method === 'DELETE')) return true
  if (parts.length === 3 && parts[2] === 'credential' && (method === 'POST' || method === 'DELETE')) {
    return true
  }
  return false
}

/**
 * @param {{
 *   accounts: ReturnType<import('./accounts-service.js').createDiscordAccountsService>,
 *   uiEnabled?: boolean,
 *   adminAuth?: { requestRejection(request: { headers: import('node:http').IncomingHttpHeaders }): 401 | 403 | undefined },
 * }} opts
 */
export function createDiscordHttpHandlers(opts) {
  const accounts = opts.accounts
  const uiEnabled = opts.uiEnabled !== false
  const adminAuth = opts.adminAuth

  /** @type {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<void>} */
  const router = async (req, res) => {
    if (!uiEnabled) {
      json(res, 404, { ok: false, error: 'ui disabled' })
      return
    }

    const url = new URL(req.url || '/', 'http://localhost')
    let rest = url.pathname
    if (rest.startsWith(API_PREFIX)) rest = rest.slice(API_PREFIX.length)
    rest = rest.replace(/^\//, '')
    const method = req.method || 'GET'
    const parts = rest.split('/').filter(Boolean)

    if (isMutation(method, parts)) {
      const rejection = rejectAdminRequest(req, adminAuth)
      if (rejection != null) {
        const error =
          rejection === 503
            ? 'admin auth unavailable'
            : rejection === 401
              ? 'unauthorized'
              : 'forbidden'
        json(res, rejection, { ok: false, error })
        return
      }
    } else if (!sameOrigin(req)) {
      json(res, 403, { ok: false, error: 'forbidden: cross-origin' })
      return
    }

    try {
      if (parts[0] === 'meta' && (method === 'GET' || method === 'HEAD')) {
        json(res, 200, accounts.meta())
        return
      }

      if (parts[0] === 'accounts' && parts.length === 1) {
        if (method === 'GET' || method === 'HEAD') {
          json(res, 200, await accounts.list())
          return
        }
        if (method === 'POST') {
          const raw = await readBody(req)
          let body
          try {
            body = JSON.parse(raw)
          } catch {
            json(res, 400, { ok: false, error: 'invalid json' })
            return
          }
          const result = await accounts.create({
            accountId: body.account_id || body.accountId,
            token: body.token,
            label: body.label,
            enabled: body.enabled,
            intents: body.intents,
            allowedGuilds: body.allowedGuilds,
            allowAllGuilds: body.allowAllGuilds,
            allowedChannels: body.allowedChannels,
            allowAllChannels: body.allowAllChannels,
            allowedUsers: body.allowedUsers,
            allowAllUsers: body.allowAllUsers,
            dm: body.dm,
            ignoreBots: body.ignoreBots,
            proactiveTargets: body.proactiveTargets,
          })
          json(res, 201, result)
          return
        }
      }

      if (parts[0] === 'accounts' && parts.length === 2) {
        const id = decodeURIComponent(parts[1])
        if (method === 'GET') {
          const result = await accounts.get(id)
          json(res, result.ok ? 200 : 404, result)
          return
        }
        if (method === 'PATCH' || method === 'PUT') {
          const raw = await readBody(req)
          let body
          try {
            body = JSON.parse(raw)
          } catch {
            json(res, 400, { ok: false, error: 'invalid json' })
            return
          }
          const result = await accounts.update(id, body)
          json(res, 200, result)
          return
        }
        if (method === 'DELETE') {
          const deleteSecret = url.searchParams.get('deleteSecret') === 'true'
          const result = await accounts.remove(id, { deleteSecret })
          json(res, 200, result)
          return
        }
      }

      if (parts[0] === 'accounts' && parts[2] === 'credential' && parts.length === 3) {
        const id = decodeURIComponent(parts[1])
        if (method === 'POST') {
          const raw = await readBody(req)
          let body
          try {
            body = JSON.parse(raw)
          } catch {
            json(res, 400, { ok: false, error: 'invalid json' })
            return
          }
          if (!body.token || typeof body.token !== 'string') {
            json(res, 400, { ok: false, error: 'token required' })
            return
          }
          const result = await accounts.setCredential(id, body.token)
          json(res, 200, result)
          return
        }
        if (method === 'DELETE') {
          const result = await accounts.removeCredential(id)
          json(res, 200, result)
          return
        }
        if (method === 'GET') {
          const result = await accounts.credentialStatus(id)
          json(res, result.ok ? 200 : 404, result)
          return
        }
      }

      if (parts[0] === 'accounts' && parts[2] === 'status' && parts.length === 3) {
        const id = decodeURIComponent(parts[1])
        if (method === 'GET') {
          json(res, 200, await accounts.status(id))
          return
        }
      }

      json(res, 404, { ok: false, error: 'not found' })
    } catch (err) {
      const code = err?.code
      const msg = err instanceof Error ? err.message : 'internal error'
      // Never echo secret values in the HTTP body
      if (code === 'duplicate') {
        json(res, 409, { ok: false, error: msg })
        return
      }
      if (code === 'not_found') {
        json(res, 404, { ok: false, error: msg })
        return
      }
      if (code === 'secrets_unavailable') {
        json(res, 503, { ok: false, error: 'secrets service unavailable' })
        return
      }
      if (code === 'secrets_write_failed') {
        json(res, 502, { ok: false, error: 'credential write failed' })
        return
      }
      if (err instanceof TypeError) {
        json(res, 400, { ok: false, error: msg })
        return
      }
      json(res, 500, { ok: false, error: 'internal error' })
    }
  }

  return [{ kind: 'prefix', path: API_PREFIX, handler: router }]
}

/**
 * @param {{ register: Function } | undefined} webServer
 * @param {{ accounts: any, uiEnabled?: boolean, adminAuth?: any }} opts
 */
export function registerDiscordHttpRoutes(webServer, opts) {
  if (!webServer) return
  for (const route of createDiscordHttpHandlers(opts)) {
    webServer.register(route)
  }
}

/**
 * Invoke router without a real HTTP server (unit tests).
 * @param {ReturnType<typeof createDiscordHttpHandlers>[0]['handler']} handler
 * @param {{ method: string, path: string, body?: any, headers?: Record<string, string> }} req
 */
export async function invokeDiscordHttp(handler, req) {
  const chunks = []
  /** @type {any} */
  const res = {
    statusCode: 200,
    headers: {},
    writeHead(status, headers) {
      this.statusCode = status
      this.headers = headers || {}
    },
    end(payload) {
      chunks.push(payload == null ? '' : String(payload))
    },
  }
  const bodyStr = req.body != null ? JSON.stringify(req.body) : ''
  /** @type {any} */
  const incoming = {
    method: req.method,
    url: req.path,
    headers: { host: '127.0.0.1:3080', ...(req.headers || {}) },
    _handlers: {},
    on(ev, fn) {
      this._handlers[ev] = fn
      if (this._handlers.data && this._handlers.end) {
        queueMicrotask(() => {
          if (bodyStr) this._handlers.data(Buffer.from(bodyStr))
          this._handlers.end()
        })
      }
      return this
    },
  }
  await handler(incoming, res)
  const raw = chunks.join('')
  let data = null
  try {
    data = raw ? JSON.parse(raw) : null
  } catch {
    data = raw
  }
  return { status: res.statusCode, data, raw }
}
