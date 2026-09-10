/**
 * Cordis Config shape + fail-closed allowlist semantics (LOCKED).
 *
 * Empty allowlists deny all. Broad access requires explicit opt-in flags.
 * Snowflake shape checks live in the accounts admin service (operator path),
 * not in normalize — FakeTransport tests use short synthetic ids.
 */

import { validateAccountId } from './secret-ref.js'
import { normalizeIntents } from './intents.js'

/**
 * @typedef {{
 *   enabled?: boolean,
 *   allowedUsers?: string[],
 *   allowAllUsers?: boolean,
 * }} DmConfig
 */

/**
 * @typedef {{
 *   enabled?: boolean,
 *   label?: string,
 *   credentials?: string,
 *   agentPreset?: string,

 *   intents?: string[],
 *   allowedGuilds?: string[],
 *   allowedChannels?: string[],
 *   allowAllGuilds?: boolean,
 *   allowAllChannels?: boolean,
 *   allowedUsers?: string[],
 *   allowAllUsers?: boolean,
 *   dm?: DmConfig,
 *   ignoreBots?: boolean,
 *   proactiveTargets?: Record<string, { guildId?: string, channelId?: string }>,
 * }} AccountConfig
 */

/**
 * @typedef {{
 *   transport?: 'fake'|'discordjs',
 *   allowConnect?: boolean,
 *   accounts?: Record<string, AccountConfig>,
 *   sessionCwd?: string,
 *   dispatchTimeoutMs?: number,
 * }} PluginConfig
 */

export const DEFAULT_ACCOUNT = Object.freeze({
  enabled: true,
  label: undefined,
  credentials: undefined,
  /** unset = fail-closed for AgentLoop (no silent default agent) */
  agentPreset: undefined,
  intents: ['Guilds', 'GuildMessages', 'DirectMessages', 'MessageContent'],
  allowedGuilds: [],
  allowedChannels: [],
  allowAllGuilds: false,
  allowAllChannels: false,
  allowedUsers: [],
  allowAllUsers: false,
  dm: Object.freeze({
    enabled: false,
    allowedUsers: [],
    allowAllUsers: false,
  }),
  ignoreBots: true,
  proactiveTargets: Object.freeze({}),
})

/** Matches `@deepseek-ai/dsh-agent-presets` PRESET_ID. */
export const AGENT_PRESET_ID_RE = /^[a-z0-9][a-z0-9-]*$/

/**
 * Normalize optional agent preset id. Empty → undefined (fail-closed at runtime).
 * @param {unknown} raw
 * @returns {string | undefined}
 */
export function normalizeAgentPresetId(raw) {
  if (raw == null) return undefined
  const id = String(raw).trim()
  if (!id) return undefined
  if (!AGENT_PRESET_ID_RE.test(id)) {
    throw new TypeError(`dsh-piblox-discord: invalid agentPreset (${id})`)
  }
  return id
}

export const DEFAULT_CONFIG = Object.freeze({
  transport: 'fake',
  allowConnect: false,
  accounts: Object.freeze({}),
  /** Absolute workspace cwd for Discord-minted sessions (DSH CreateAgentOptions.meta.cwd). */
  sessionCwd: undefined,
  /** Bound for create/resume/followup admission (ms). */
  dispatchTimeoutMs: 60_000,
})

/**
 * Normalize one account config with LOCKED defaults.
 * @param {AccountConfig} raw
 * @returns {Required<AccountConfig> & { dm: Required<DmConfig> }}
 */
export function normalizeAccountConfig(raw = {}) {
  const dm = { ...DEFAULT_ACCOUNT.dm, ...(raw.dm || {}) }
  const label =
    raw.label != null && String(raw.label).trim() ? String(raw.label).trim() : undefined

  const intents = normalizeIntents(raw.intents ?? DEFAULT_ACCOUNT.intents)

  /** @type {Record<string, { guildId?: string, channelId?: string }>} */
  const proactiveTargets = {}
  if (raw.proactiveTargets && typeof raw.proactiveTargets === 'object') {
    for (const [key, val] of Object.entries(raw.proactiveTargets)) {
      if (!val || typeof val !== 'object') continue
      proactiveTargets[key] = {
        guildId: val.guildId != null ? String(val.guildId) : undefined,
        channelId: val.channelId != null ? String(val.channelId) : undefined,
      }
    }
  }

  return {
    ...DEFAULT_ACCOUNT,
    ...raw,
    label,
    credentials: raw.credentials != null ? String(raw.credentials) : undefined,
    agentPreset: normalizeAgentPresetId(raw.agentPreset),
    allowedGuilds: Array.isArray(raw.allowedGuilds)
      ? raw.allowedGuilds.map(String)
      : [...DEFAULT_ACCOUNT.allowedGuilds],
    allowedChannels: Array.isArray(raw.allowedChannels)
      ? raw.allowedChannels.map(String)
      : [...DEFAULT_ACCOUNT.allowedChannels],
    intents,
    allowAllGuilds: Boolean(raw.allowAllGuilds),
    allowAllChannels: Boolean(raw.allowAllChannels),
    allowedUsers: Array.isArray(raw.allowedUsers)
      ? raw.allowedUsers.map(String)
      : [...DEFAULT_ACCOUNT.allowedUsers],
    allowAllUsers: Boolean(raw.allowAllUsers),
    dm: {
      enabled: Boolean(dm.enabled),
      allowedUsers: Array.isArray(dm.allowedUsers) ? dm.allowedUsers.map(String) : [],
      allowAllUsers: Boolean(dm.allowAllUsers),
    },
    ignoreBots: raw.ignoreBots !== undefined ? Boolean(raw.ignoreBots) : true,
    enabled: raw.enabled !== undefined ? Boolean(raw.enabled) : true,
    proactiveTargets,
  }
}

/**
 * @param {PluginConfig} raw
 */
export function normalizePluginConfig(raw = {}) {
  const accountsIn = raw.accounts && typeof raw.accounts === 'object' ? raw.accounts : {}
  /** @type {Record<string, ReturnType<typeof normalizeAccountConfig>>} */
  const accounts = {}
  for (const [accountId, cfg] of Object.entries(accountsIn)) {
    if (accountId.includes(':')) {
      throw new TypeError(`dsh-piblox-discord: account_id must not contain ':' (${accountId})`)
    }
    // Soft path: allow legacy test ids that aren't fully validateAccountId-strict
    // when already present; admin create/update always validates strictly.
    let id = String(accountId).trim()
    if (!id) throw new TypeError('dsh-piblox-discord: account_id must be non-empty')
    try {
      id = validateAccountId(id)
    } catch {
      // Keep existing non-strict ids for FakeTransport fixtures (e.g. still lowercase)
      if (!/^[a-zA-Z0-9_]+$/.test(id) || id.includes(':')) {
        throw new TypeError(`dsh-piblox-discord: invalid account_id (${accountId})`)
      }
    }
    accounts[id] = normalizeAccountConfig(cfg)
  }
  const transport = raw.transport === 'discordjs' ? 'discordjs' : 'fake'
  // Live Gateway login is opt-in only — never default true.
  const allowConnect = Boolean(raw.allowConnect)
  const sessionCwd =
    raw.sessionCwd != null && String(raw.sessionCwd).trim() ? String(raw.sessionCwd).trim() : undefined
  const dispatchTimeoutMs =
    raw.dispatchTimeoutMs != null && Number.isFinite(Number(raw.dispatchTimeoutMs))
      ? Number(raw.dispatchTimeoutMs)
      : DEFAULT_CONFIG.dispatchTimeoutMs
  return { transport, allowConnect, accounts, sessionCwd, dispatchTimeoutMs }
}

/**
 * Fail-closed allowlist evaluation (LOCKED).
 *
 * Guild MESSAGE_CREATE order (bot rejection / dedupe live in the bridge after this):
 *   account → guild → channel → guild user
 *
 * DM policy is independent (dm.enabled / dm.allowAllUsers / dm.allowedUsers).
 * No Discord Administrator / permission-bit implicit bypass.
 *
 * @param {ReturnType<typeof normalizeAccountConfig>} account
 * @param {{ guildId?: string, channelId?: string, userId?: string, isDm?: boolean }} event
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function authorizeInbound(account, event) {
  if (!account.enabled) {
    return { ok: false, reason: 'account_disabled' }
  }

  if (event.isDm) {
    if (!account.dm.enabled) {
      return { ok: false, reason: 'dm_disabled' }
    }
    if (account.dm.allowAllUsers) {
      return { ok: true }
    }
    if (!account.dm.allowedUsers.length) {
      return { ok: false, reason: 'dm_users_deny_all' }
    }
    if (!event.userId || !account.dm.allowedUsers.includes(String(event.userId))) {
      return { ok: false, reason: 'dm_user_denied' }
    }
    return { ok: true }
  }

  if (!account.allowAllGuilds) {
    if (!account.allowedGuilds.length) {
      return { ok: false, reason: 'guilds_deny_all' }
    }
    if (!event.guildId || !account.allowedGuilds.includes(String(event.guildId))) {
      return { ok: false, reason: 'guild_denied' }
    }
  }

  if (!account.allowAllChannels) {
    if (!account.allowedChannels.length) {
      return { ok: false, reason: 'channels_deny_all' }
    }
    if (!event.channelId || !account.allowedChannels.includes(String(event.channelId))) {
      return { ok: false, reason: 'channel_denied' }
    }
  }

  // Guild user allowlist — distinct from dm.allowedUsers / dm.allowAllUsers
  if (!account.allowAllUsers) {
    if (!account.allowedUsers.length) {
      return { ok: false, reason: 'guild_users_deny_all' }
    }
    if (!event.userId || !account.allowedUsers.includes(String(event.userId))) {
      return { ok: false, reason: 'guild_user_denied' }
    }
  }

  return { ok: true }
}

/**
 * Human-readable allowlist summary for operator UI (no tokens).
 * @param {ReturnType<typeof normalizeAccountConfig>} account
 */
export function scopeSummary(account) {
  return {
    guilds: account.allowAllGuilds
      ? 'all'
      : account.allowedGuilds.length === 0
        ? 'deny_all'
        : `${account.allowedGuilds.length}`,
    channels: account.allowAllChannels
      ? 'all'
      : account.allowedChannels.length === 0
        ? 'deny_all'
        : `${account.allowedChannels.length}`,
    users: account.allowAllUsers
      ? 'all'
      : account.allowedUsers.length === 0
        ? 'deny_all'
        : `${account.allowedUsers.length}`,
    dm: !account.dm.enabled
      ? 'disabled'
      : account.dm.allowAllUsers
        ? 'all_users'
        : account.dm.allowedUsers.length === 0
          ? 'deny_all'
          : `${account.dm.allowedUsers.length}_users`,
  }
}
