/**
 * Durable Discord account configuration SSOT (plugin-owned).
 *
 * Gap documented: Cordis/profile plugin config is not a safe mutable runtime API.
 * This ledger is the canonical owner of account configs so
 *   Dashboard config == runtime plugin config.
 *
 * Tokens are NEVER stored here — only credentials secret references.
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
import { normalizePluginConfig } from './config.js'

/**
 * @param {string} [root]
 */
export function defaultAccountsConfigPath(root) {
  const base = root || join(process.env.HOME || '/tmp', 'dsh-lab', 'runtime', 'dsh-home', 'ledger')
  return join(base, 'discord-accounts.json')
}

/**
 * @param {{ storePath: string, lockTimeoutMs?: number }} options
 */
export function createAccountsConfigStore(options) {
  const storePath = options.storePath
  const lockTimeoutMs = options.lockTimeoutMs ?? 5000
  const lockPollMs = 10
  const lockPath = `${storePath}.lock`

  function empty() {
    return { version: 1, transport: 'fake', accounts: {} }
  }

  function load() {
    if (!existsSync(storePath)) return empty()
    const raw = readFileSync(storePath, 'utf8')
    if (!raw.trim()) return empty()
    const parsed = JSON.parse(raw)
    const normalized = normalizePluginConfig({
      transport: parsed.transport,
      accounts: parsed.accounts || {},
    })
    return { version: Number(parsed.version) || 1, ...normalized }
  }

  /** @param {{ version: number, transport: string, accounts: Record<string, any> }} data */
  function save(data) {
    // Defense: never persist token-like keys
    const clone = structuredClone(data)
    for (const acc of Object.values(clone.accounts || {})) {
      if (acc && typeof acc === 'object') {
        delete acc.token
        delete acc.botToken
        delete acc.secret
        delete acc.value
      }
    }
    mkdirSync(dirname(storePath), { recursive: true })
    const tmp = `${storePath}.${process.pid}.${randomUUID()}.tmp`
    writeFileSync(tmp, `${JSON.stringify(clone, null, 2)}\n`, 'utf8')
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
   * @param {(data: { version: number, transport: string, accounts: Record<string, any> }) => T | Promise<T>} fn
   */
  async function withLock(fn) {
    const deadline = Date.now() + lockTimeoutMs
    for (;;) {
      let fd
      try {
        fd = openSync(lockPath, 'wx')
      } catch (err) {
        if (err?.code !== 'EEXIST') throw err
        if (Date.now() >= deadline) throw new Error('accountsConfig: lock timeout')
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
   * Seed empty ledger from Cordis/plugin boot config once.
   * @param {import('./config.js').PluginConfig} seed
   */
  async function seedFromBootConfig(seed) {
    return withLock((data) => {
      if (Object.keys(data.accounts).length > 0) return { seeded: false, data }
      const normalized = normalizePluginConfig(seed || {})
      data.transport = normalized.transport
      data.accounts = { ...normalized.accounts }
      return { seeded: true, data }
    })
  }

  return {
    storePath,
    load,
    save,
    withLock,
    seedFromBootConfig,
    snapshot: () => load(),
  }
}
