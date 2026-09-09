/**
 * Durable inbound event dedupe (transport claim store).
 *
 * Ordering (LOCKED):
 *   normalize → authorize → dedupe claim → binding/session → followup → complete
 *
 * Crash semantics:
 *   claimed with lease_until in the future → duplicate (in-flight)
 *   claimed with expired lease → reclaim (at-least-once ingestion)
 *   completed within TTL → duplicate (no second followup)
 *   after TTL expiry → new claim allowed (documented; prefer Discord snowflake uniqueness)
 */

import {
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  renameSync,
  fsyncSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { SystemClock } from './clock.js'

/**
 * @typedef {'claimed'|'dispatched'|'completed'} DedupeState
 */

/**
 * @typedef {{
 *   account_id: string,
 *   event_id: string,
 *   event_type: string,
 *   state: DedupeState,
 *   first_seen_at: number,
 *   expires_at: number,
 *   lease_until: number,
 *   session_id?: string | null,
 * }} DedupeRecord
 */

/**
 * @param {{
 *   storePath: string,
 *   clock?: { now(): number },
 *   ttlMs?: number,
 *   leaseMs?: number,
 *   lockTimeoutMs?: number,
 * }} options
 */
export function createInboundDedupe(options) {
  const storePath = options.storePath
  const clock = options.clock || new SystemClock()
  const ttlMs = options.ttlMs ?? 24 * 60 * 60 * 1000
  const leaseMs = options.leaseMs ?? 5 * 60 * 1000
  const lockTimeoutMs = options.lockTimeoutMs ?? 5000
  const lockPollMs = 10
  const lockPath = `${storePath}.lock`

  function load() {
    if (!existsSync(storePath)) return { version: 1, claims: {} }
    const raw = readFileSync(storePath, 'utf8')
    if (!raw.trim()) return { version: 1, claims: {} }
    const parsed = JSON.parse(raw)
    return { version: Number(parsed.version) || 1, claims: { ...(parsed.claims || {}) } }
  }

  /** @param {{ version: number, claims: Record<string, DedupeRecord> }} data */
  function save(data) {
    mkdirSync(dirname(storePath), { recursive: true })
    const tmp = `${storePath}.${process.pid}.${randomUUID()}.tmp`
    writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
    try {
      const fd = openSync(tmp, 'r+')
      try {
        fsyncSync(fd)
      } finally {
        closeSync(fd)
      }
    } catch {
      /* best-effort */
    }
    renameSync(tmp, storePath)
  }

  /**
   * @template T
   * @param {(data: { version: number, claims: Record<string, DedupeRecord> }) => T | Promise<T>} fn
   */
  async function withLock(fn) {
    const deadline = Date.now() + lockTimeoutMs
    for (;;) {
      let fd
      try {
        fd = openSync(lockPath, 'wx')
      } catch (err) {
        if (err?.code !== 'EEXIST') throw err
        if (Date.now() >= deadline) throw new Error(`inboundDedupe: lock timeout`)
        await new Promise((r) => setTimeout(r, lockPollMs))
        continue
      }
      try {
        const data = load()
        const result = await fn(data)
        save(data)
        return result
      } finally {
        closeSync(fd)
        try {
          unlinkSync(lockPath)
        } catch {
          /* ignore */
        }
      }
    }
  }

  /**
   * @param {string} accountId
   * @param {string} eventId
   */
  function keyOf(accountId, eventId) {
    return `${accountId}:${eventId}`
  }

  /**
   * Claim an inbound event before DSH dispatch.
   * @param {{ accountId: string, eventId: string, eventType: string }} input
   * @returns {Promise<{ ok: true, claim: DedupeRecord } | { ok: false, reason: 'duplicate', claim: DedupeRecord }>}
   */
  async function claim(input) {
    const accountId = String(input.accountId)
    const eventId = String(input.eventId)
    const eventType = String(input.eventType || 'unknown')
    if (!accountId || !eventId) throw new TypeError('inboundDedupe.claim: accountId+eventId required')

    return withLock((data) => {
      const now = clock.now()
      // Opportunistic GC of expired claims
      for (const [k, rec] of Object.entries(data.claims)) {
        if (rec.expires_at <= now) delete data.claims[k]
      }

      const key = keyOf(accountId, eventId)
      const existing = data.claims[key]
      if (existing) {
        if (existing.state === 'completed' && existing.expires_at > now) {
          return { ok: false, reason: 'duplicate', claim: existing }
        }
        if (existing.state === 'dispatched' && existing.expires_at > now) {
          return { ok: false, reason: 'duplicate', claim: existing }
        }
        if (existing.state === 'claimed' && existing.lease_until > now) {
          return { ok: false, reason: 'duplicate', claim: existing }
        }
        // Lease expired or TTL edge → reclaim
      }

      /** @type {DedupeRecord} */
      const claimRec = {
        account_id: accountId,
        event_id: eventId,
        event_type: eventType,
        state: 'claimed',
        first_seen_at: existing?.first_seen_at || now,
        expires_at: now + ttlMs,
        lease_until: now + leaseMs,
        session_id: null,
      }
      data.claims[key] = claimRec
      return { ok: true, claim: claimRec }
    })
  }

  /**
   * @param {string} accountId
   * @param {string} eventId
   * @param {{ sessionId?: string }} [extra]
   */
  async function markDispatched(accountId, eventId, extra = {}) {
    return withLock((data) => {
      const key = keyOf(accountId, eventId)
      const rec = data.claims[key]
      if (!rec) return null
      rec.state = 'dispatched'
      rec.lease_until = clock.now() + leaseMs
      if (extra.sessionId) rec.session_id = extra.sessionId
      return rec
    })
  }

  /**
   * @param {string} accountId
   * @param {string} eventId
   */
  async function markCompleted(accountId, eventId) {
    return withLock((data) => {
      const key = keyOf(accountId, eventId)
      const rec = data.claims[key]
      if (!rec) return null
      rec.state = 'completed'
      rec.lease_until = 0
      return rec
    })
  }

  function get(accountId, eventId) {
    return load().claims[keyOf(accountId, eventId)] || null
  }

  return {
    storePath,
    ttlMs,
    leaseMs,
    claim,
    markDispatched,
    markCompleted,
    get,
    snapshot: () => load(),
  }
}

/** @param {string} [root] */
export function defaultInboundDedupePath(root) {
  const base = root || join(process.env.HOME || '/tmp', 'dsh-lab', 'runtime', 'dsh-home', 'ledger')
  return join(base, 'discord-inbound-dedupe.json')
}

/**
 * Stable inbound event key from a platform event.
 * @param {{ type?: string, messageId?: string, eventId?: string, interactionId?: string, accountId: string }} event
 */
export function inboundEventKey(event) {
  if (event.interactionId) {
    return { eventId: String(event.interactionId), eventType: event.type || 'discord.interaction' }
  }
  if (event.type === 'discord.message.created' || event.messageId) {
    return {
      eventId: String(event.messageId || event.eventId),
      eventType: 'discord.message.created',
    }
  }
  return { eventId: String(event.eventId), eventType: String(event.type || 'discord.unknown') }
}
