/**
 * Crash-safe durable JSON store for the Discord delivery outbox.
 * Pattern mirrors dsh-conversation-binding: temp + fsync + rename + O_EXCL lock.
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

/**
 * @typedef {import('./types.js').OutboxOperation} OutboxOperation
 * @typedef {import('./types.js').OutboxGroup} OutboxGroup
 */

/**
 * @typedef {{
 *   version: number,
 *   operations: Record<string, OutboxOperation>,
 *   groups: Record<string, OutboxGroup>,
 * }} OutboxStoreData
 */

/**
 * @param {string} storePath
 * @param {number} lockTimeoutMs
 * @param {number} lockPollMs
 */
export function createOutboxStore(storePath, lockTimeoutMs = 5000, lockPollMs = 10) {
  const lockPath = `${storePath}.lock`

  function load() {
    if (!existsSync(storePath)) {
      return /** @type {OutboxStoreData} */ ({ version: 1, operations: {}, groups: {} })
    }
    const raw = readFileSync(storePath, 'utf8')
    if (!raw.trim()) return { version: 1, operations: {}, groups: {} }
    const parsed = JSON.parse(raw)
    return {
      version: Number(parsed.version) || 1,
      operations: { ...(parsed.operations || {}) },
      groups: { ...(parsed.groups || {}) },
    }
  }

  /** @param {OutboxStoreData} data */
  function save(data) {
    mkdirSync(dirname(storePath), { recursive: true })
    const tmp = `${storePath}.${process.pid}.${randomUUID()}.tmp`
    const body = `${JSON.stringify(data, null, 2)}\n`
    writeFileSync(tmp, body, { encoding: 'utf8' })
    try {
      const fd = openSync(tmp, 'r+')
      try {
        fsyncSync(fd)
      } finally {
        closeSync(fd)
      }
    } catch {
      /* best-effort fsync */
    }
    renameSync(tmp, storePath)
  }

  /**
   * @template T
   * @param {(data: OutboxStoreData) => T | Promise<T>} fn
   */
  async function withLock(fn) {
    const deadline = Date.now() + lockTimeoutMs
    for (;;) {
      let fd
      try {
        fd = openSync(lockPath, 'wx')
      } catch (err) {
        if (err?.code !== 'EEXIST') throw err
        if (Date.now() >= deadline) {
          throw new Error(`outbox: lock timeout on ${lockPath}`)
        }
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

  return {
    storePath,
    load,
    withLock,
    /** Read-only snapshot without lock (tests / receipts). */
    snapshot() {
      return load()
    },
  }
}

/**
 * Default on-disk path under DSH_HOME-ish layout.
 * @param {string} [root]
 */
export function defaultOutboxPath(root) {
  const base = root || join(process.env.HOME || '/tmp', 'dsh-lab', 'runtime', 'dsh-home', 'ledger')
  return join(base, 'discord-outbox.json')
}
