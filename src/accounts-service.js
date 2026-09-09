/**
 * discordAccounts — operator admin service (NOT model tools).
 *
 * Credential values → dsh-piblox-secrets only.
 * Account config → plugin accounts ledger (SSOT).
 */

import { normalizeAccountConfig, scopeSummary } from './config.js'
import { credentialSecretName, validateAccountId, normalizeSnowflakeList } from './secret-ref.js'
import { INTENT_OPTIONS } from './intents.js'

/**
 * @typedef {'disabled'|'missing_credentials'|'stopped'|'starting'|'connected'|'disconnected'|'rate_limited'|'failed_auth'|'error'} AccountRuntimeStatus
 */

/**
 * @param {{
 *   configStore: ReturnType<import('./accounts-config-store.js').createAccountsConfigStore>,
 *   secrets?: {
 *     set?(name: string, value: string): Promise<{ ok: boolean, name?: string, message?: string, code?: string }>,
 *     delete?(name: string): Promise<{ ok: boolean, deleted?: boolean, message?: string }>,
 *     listNames?(): Promise<{ ok: boolean, names: string[] }>,
 *     hasKey?(name: string): boolean,
 *     resolve?(ref: string): { ok: boolean, value?: string },
 *     store?: {
 *       setSecret(name: string, value: string): Promise<{ name: string }>,
 *       deleteSecret(name: string): Promise<boolean>,
 *       listNames(): Promise<string[]>,
 *       getSecretValue?(name: string): Promise<string | null>,
 *     },
 *   },
 *   transport?: { isAccountRunning(id: string): boolean, startAccount?: Function, stopAccount?: Function },
 *   outbox?: { isAccountIsolated?(id: string): boolean, clearAccountIsolation?(id: string): void },
 *   onConfigChanged?: (cfg: any) => void,
 *   liveGatewayConnected?: (accountId: string) => boolean,
 *   logger?: { info?: Function, warn?: Function, debug?: Function },
 * }} deps
 */
export function createDiscordAccountsService(deps) {
  const configStore = deps.configStore
  const secrets = deps.secrets || null
  const transport = deps.transport || null
  const outbox = deps.outbox || null
  const onConfigChanged = deps.onConfigChanged || (() => {})
  const liveGatewayConnected = deps.liveGatewayConnected || (() => false)
  const logger = deps.logger

  /** Reload classification (evidence-based). */
  const RELOAD = Object.freeze({
    credentialWrite: 'HOT_RELOAD_SUPPORTED', // secrets.set/delete hot-updates vault; resolve() immediate
    applyTokenToGateway: 'ACCOUNT_RESTART_REQUIRED', // live Gateway must restart account (not implemented yet)
    pluginConfigMutation: 'HOT_RELOAD_SUPPORTED', // in-process accounts map updated
    profilePatch: 'PROFILE_RESTART_REQUIRED', // Cordis patch seed only
  })

  /**
   * Prefer credential-plane secrets.set (store + vault atomic). Fallback: store.setSecret.
   * @param {string} ref
   * @param {string} value
   */
  async function writeSecret(ref, value) {
    if (typeof secrets?.set === 'function') {
      const result = await secrets.set(ref, value)
      if (!result?.ok) {
        throw new Error(result?.message || result?.code || 'secrets.set failed')
      }
      return
    }
    if (secrets?.store?.setSecret) {
      await secrets.store.setSecret(ref, value)
      return
    }
    throw new Error('secrets service unavailable — cannot write Discord token')
  }

  /**
   * Prefer secrets.delete (store + vault). Fallback: store.deleteSecret.
   * @param {string} ref
   */
  async function deleteSecret(ref) {
    if (typeof secrets?.delete === 'function') {
      const result = await secrets.delete(ref)
      if (!result?.ok) {
        throw new Error(result?.message || result?.code || 'secrets.delete failed')
      }
      return Boolean(result.deleted)
    }
    if (secrets?.store?.deleteSecret) {
      return secrets.store.deleteSecret(ref)
    }
    throw new Error('secrets service unavailable')
  }

  async function listSecretNames() {
    if (typeof secrets?.listNames === 'function') {
      const result = await secrets.listNames()
      return result?.names || []
    }
    if (secrets?.store?.listNames) {
      return secrets.store.listNames()
    }
    return []
  }

  async function credentialConfigured(ref) {
    if (!ref) return false
    if (typeof secrets?.hasKey === 'function' && secrets.hasKey(ref)) return true
    if (typeof secrets?.resolve === 'function') {
      const r = secrets.resolve(ref)
      if (r?.ok) return true
    }
    const names = await listSecretNames()
    return names.includes(ref)
  }

  /**
   * @param {string} accountId
   * @param {any} account
   * @returns {Promise<AccountRuntimeStatus>}
   */
  async function computeStatus(accountId, account) {
    if (!account?.enabled) return 'disabled'
    const ref = account.credentials || credentialSecretName(accountId)
    const configured = await credentialConfigured(ref)
    if (!configured) return 'missing_credentials'
    if (outbox?.isAccountIsolated?.(accountId)) return 'failed_auth'
    const transportStatus =
      typeof transport?.getAccountStatus === 'function'
        ? transport.getAccountStatus(accountId)
        : null
    if (
      transportStatus === 'failed_auth' ||
      transportStatus === 'error' ||
      transportStatus === 'starting' ||
      transportStatus === 'connected' ||
      transportStatus === 'disconnected'
    ) {
      if (transportStatus === 'connected' || liveGatewayConnected(accountId)) return 'connected'
      if (transportStatus === 'starting') return 'starting'
      if (transportStatus === 'failed_auth') return 'failed_auth'
      if (transportStatus === 'error') return 'error'
      if (transportStatus === 'disconnected' && transport?.isAccountRunning?.(accountId)) {
        return 'disconnected'
      }
    }
    if (liveGatewayConnected(accountId)) return 'connected'
    if (transport?.isAccountRunning?.(accountId)) {
      return 'disconnected'
    }
    return 'stopped'
  }

  /**
   * Public sanitized account — never includes token values.
   * @param {string} accountId
   * @param {any} account
   */
  async function toPublic(accountId, account) {
    const ref = account.credentials || credentialSecretName(accountId)
    const configured = await credentialConfigured(ref)
    const status = await computeStatus(accountId, account)
    return {
      account_id: accountId,
      label: account.label || accountId,
      enabled: Boolean(account.enabled),
      credentials: {
        configured,
        ref, // admin Settings may show reference (Secrets Boundary consistent)
      },
      intents: [...(account.intents || [])],
      allowedGuilds: [...(account.allowedGuilds || [])],
      allowAllGuilds: Boolean(account.allowAllGuilds),
      allowedChannels: [...(account.allowedChannels || [])],
      allowAllChannels: Boolean(account.allowAllChannels),
      dm: {
        enabled: Boolean(account.dm?.enabled),
        allowedUsers: [...(account.dm?.allowedUsers || [])],
        allowAllUsers: Boolean(account.dm?.allowAllUsers),
      },
      ignoreBots: account.ignoreBots !== false,
      proactiveTargets: account.proactiveTargets || {},
      status,
      scope_summary: scopeSummary(account),
      reload: RELOAD,
    }
  }

  function assertNoTokenLeak(obj, canary) {
    const s = JSON.stringify(obj)
    if (canary && s.includes(canary)) {
      throw new Error('security: token canary leaked into public object')
    }
  }

  async function list() {
    const data = configStore.snapshot()
    const items = []
    for (const [id, acc] of Object.entries(data.accounts)) {
      items.push(await toPublic(id, acc))
    }
    items.sort((a, b) => a.account_id.localeCompare(b.account_id))
    return { ok: true, items, transport: data.transport }
  }

  async function get(accountId) {
    const id = validateAccountId(accountId)
    const data = configStore.snapshot()
    const acc = data.accounts[id]
    if (!acc) return { ok: false, code: 'not_found' }
    return { ok: true, account: await toPublic(id, acc) }
  }

  async function status(accountId) {
    const id = validateAccountId(accountId)
    const data = configStore.snapshot()
    const acc = data.accounts[id]
    if (!acc) return { ok: false, code: 'not_found' }
    return { ok: true, account_id: id, status: await computeStatus(id, acc) }
  }

  /**
   * Operator path: optional snowflake shape check (lossless strings).
   * Empty lists remain valid (fail-closed deny-all).
   * @param {Record<string, any>} input
   */
  function validateOperatorIds(input) {
    if (input.allowedGuilds != null) normalizeSnowflakeList(input.allowedGuilds, 'allowedGuilds')
    if (input.allowedChannels != null) normalizeSnowflakeList(input.allowedChannels, 'allowedChannels')
    if (input.dm?.allowedUsers != null) {
      normalizeSnowflakeList(input.dm.allowedUsers, 'dm.allowedUsers')
    }
  }

  /**
   * @param {{
   *   accountId: string,
   *   token?: string,
   *   label?: string,
   *   enabled?: boolean,
   *   intents?: string[],
   *   allowedGuilds?: string[],
   *   allowAllGuilds?: boolean,
   *   allowedChannels?: string[],
   *   allowAllChannels?: boolean,
   *   dm?: any,
   *   ignoreBots?: boolean,
   *   proactiveTargets?: any,
   * }} input
   */
  async function create(input) {
    const id = validateAccountId(input.accountId)
    validateOperatorIds(input)
    const token = input.token != null ? String(input.token) : ''
    const ref = credentialSecretName(id)

    // Reject duplicates before touching the vault (do not clobber existing secrets).
    if (configStore.snapshot().accounts[id]) {
      throw Object.assign(new Error(`account already exists: ${id}`), { code: 'duplicate' })
    }

    const account = normalizeAccountConfig({
      label: input.label,
      enabled: input.enabled,
      credentials: ref,
      intents: input.intents,
      allowedGuilds: input.allowedGuilds,
      allowAllGuilds: input.allowAllGuilds,
      allowedChannels: input.allowedChannels,
      allowAllChannels: input.allowAllChannels,
      dm: input.dm,
      ignoreBots: input.ignoreBots,
      proactiveTargets: input.proactiveTargets,
    })

    let secretCreated = false
    try {
      if (token) {
        const existed = (await listSecretNames()).includes(ref)
        await writeSecret(ref, token)
        secretCreated = !existed
      }

      await configStore.withLock((data) => {
        if (data.accounts[id]) {
          throw Object.assign(new Error(`account already exists: ${id}`), { code: 'duplicate' })
        }
        data.accounts[id] = account
      })
    } catch (err) {
      if (secretCreated) {
        try {
          await deleteSecret(ref)
          logger?.warn?.(`discordAccounts.create: cleaned orphaned secret ${ref} after config failure`)
        } catch (cleanupErr) {
          logger?.warn?.(`discordAccounts.create: orphan cleanup failed for ${ref}: ${cleanupErr}`)
        }
      }
      throw err
    }

    const snap = configStore.snapshot()
    onConfigChanged(snap)
    await syncRuntimeAccount(id, account)
    const pub = await toPublic(id, account)
    assertNoTokenLeak(pub, token || null)
    return { ok: true, account: pub, reload: RELOAD }
  }

  /**
   * @param {string} accountId
   * @param {Record<string, any>} patch
   */
  async function update(accountId, patch = {}) {
    const id = validateAccountId(accountId)
    // Never accept token via generic update — use setCredential
    if (patch.token != null || patch.botToken != null || patch.secret != null) {
      throw new TypeError('use setCredential for token writes')
    }
    validateOperatorIds(patch)

    let updated
    await configStore.withLock((data) => {
      const existing = data.accounts[id]
      if (!existing) {
        throw Object.assign(new Error(`account not found: ${id}`), { code: 'not_found' })
      }
      const next = normalizeAccountConfig({
        ...existing,
        ...patch,
        credentials: existing.credentials || credentialSecretName(id),
        dm: patch.dm ? { ...existing.dm, ...patch.dm } : existing.dm,
      })
      data.accounts[id] = next
      updated = next
    })

    const snap = configStore.snapshot()
    onConfigChanged(snap)
    await syncRuntimeAccount(id, updated)
    return { ok: true, account: await toPublic(id, updated), reload: RELOAD }
  }

  /**
   * @param {string} accountId
   * @param {{ deleteSecret?: boolean }} [opts]
   */
  async function remove(accountId, opts = {}) {
    const id = validateAccountId(accountId)
    let removed
    let ref
    await configStore.withLock((data) => {
      removed = data.accounts[id]
      if (!removed) {
        throw Object.assign(new Error(`account not found: ${id}`), { code: 'not_found' })
      }
      ref = removed.credentials || credentialSecretName(id)
      delete data.accounts[id]
    })

    // Stop runtime; do not destroy ConversationBinding / outbox / dedupe
    try {
      if (transport?.isAccountRunning?.(id) && transport.stopAccount) {
        await transport.stopAccount(id)
      }
    } catch (err) {
      logger?.warn?.(`discordAccounts.remove: stop failed ${err}`)
    }

    let secretDeleted = false
    if (opts.deleteSecret && ref && (typeof secrets?.delete === 'function' || secrets?.store?.deleteSecret)) {
      secretDeleted = await deleteSecret(ref)
    }

    onConfigChanged(configStore.snapshot())
    return {
      ok: true,
      account_id: id,
      secret_deleted: secretDeleted,
      note: 'ConversationBinding and outbox retained; dedupe TTL expires naturally',
    }
  }

  /**
   * Write/replace token. Old secret remains until upsert succeeds.
   * @param {string} accountId
   * @param {string} token
   */
  async function setCredential(accountId, token) {
    const id = validateAccountId(accountId)
    const value = String(token || '')
    if (!value) throw new TypeError('token required')

    const data = configStore.snapshot()
    if (!data.accounts[id]) {
      throw Object.assign(new Error(`account not found: ${id}`), { code: 'not_found' })
    }
    const ref = data.accounts[id].credentials || credentialSecretName(id)

    // Upsert via secrets.set — vault + store hot; previous value remains until success
    await writeSecret(ref, value)

    // Ensure credentials ref persisted
    await configStore.withLock((d) => {
      if (d.accounts[id] && d.accounts[id].credentials !== ref) {
        d.accounts[id].credentials = ref
      }
    })

    onConfigChanged(configStore.snapshot())
    // Live Gateway would need ACCOUNT_RESTART_REQUIRED — do not login here
    const pub = await toPublic(id, configStore.snapshot().accounts[id])
    assertNoTokenLeak(pub, value)
    return {
      ok: true,
      account: pub,
      reload: {
        ...RELOAD,
        applied: 'ACCOUNT_RESTART_REQUIRED',
      },
    }
  }

  /**
   * Remove token; account config remains → missing_credentials.
   * @param {string} accountId
   */
  async function removeCredential(accountId) {
    const id = validateAccountId(accountId)
    const data = configStore.snapshot()
    const acc = data.accounts[id]
    if (!acc) {
      throw Object.assign(new Error(`account not found: ${id}`), { code: 'not_found' })
    }
    const ref = acc.credentials || credentialSecretName(id)

    // Stop runtime first so we never login with empty credentials
    try {
      if (transport?.isAccountRunning?.(id) && transport.stopAccount) {
        await transport.stopAccount(id)
      }
    } catch (err) {
      logger?.warn?.(`removeCredential stop: ${err}`)
    }

    await deleteSecret(ref)
    onConfigChanged(configStore.snapshot())
    const pub = await toPublic(id, configStore.snapshot().accounts[id])
    return { ok: true, account: pub }
  }

  async function credentialStatus(accountId) {
    const id = validateAccountId(accountId)
    const data = configStore.snapshot()
    const acc = data.accounts[id]
    if (!acc) return { ok: false, code: 'not_found' }
    const ref = acc.credentials || credentialSecretName(id)
    return {
      ok: true,
      account_id: id,
      configured: await credentialConfigured(ref),
      ref,
    }
  }

  /**
   * Start account only when enabled + credentials present. Never login with empty token.
   * @param {string} accountId
   * @param {any} account
   */
  async function syncRuntimeAccount(accountId, account) {
    if (!transport) return
    const id = accountId
    const shouldRun = Boolean(account.enabled)
    const ref = account.credentials || credentialSecretName(id)
    const configured = await credentialConfigured(ref)

    if (!shouldRun || !configured) {
      if (transport.isAccountRunning?.(id) && transport.stopAccount) {
        await transport.stopAccount(id)
      }
      return
    }

    // Start when enabled + credentials present. Live Gateway uses secrets.resolve inside transport.
    if (!transport.isAccountRunning?.(id) && transport.startAccount) {
      await transport.startAccount(id, {
        credentialsRef: ref,
        intents: account.intents,
      })
      outbox?.clearAccountIsolation?.(id)
    }
  }

  function meta() {
    return {
      ok: true,
      intents: INTENT_OPTIONS,
      secret_name_format: 'DISCORD_<ACCOUNT_ID>_BOT_TOKEN',
      account_id_pattern: '^[a-z][a-z0-9_]{0,47}$',
      reload: RELOAD,
      fail_closed: {
        allowedGuilds_empty: 'deny_all',
        allowedChannels_empty: 'deny_all',
        dm_allowedUsers_empty: 'deny_all',
      },
    }
  }

  return {
    list,
    get,
    create,
    update,
    remove,
    status,
    setCredential,
    removeCredential,
    credentialStatus,
    meta,
    toPublic,
    RELOAD,
    /** Test helper: current ledger snapshot */
    snapshotConfig: () => configStore.snapshot(),
  }
}
