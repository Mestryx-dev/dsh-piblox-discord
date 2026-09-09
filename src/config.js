/**
 * Cordis Config shape + fail-closed allowlist semantics (LOCKED).
 *
 * Empty allowlists deny all. Broad access requires explicit opt-in flags.
 */

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
 *   credentials?: string,
 *   intents?: string[],
 *   allowedGuilds?: string[],
 *   allowedChannels?: string[],
 *   allowAllGuilds?: boolean,
 *   allowAllChannels?: boolean,
 *   dm?: DmConfig,
 *   ignoreBots?: boolean,
 * }} AccountConfig
 */

/**
 * @typedef {{
 *   transport?: 'fake'|'discordjs',
 *   accounts?: Record<string, AccountConfig>,
 * }} PluginConfig
 */

export const DEFAULT_ACCOUNT = Object.freeze({
  enabled: true,
  credentials: undefined,
  intents: ['Guilds', 'GuildMessages', 'DirectMessages', 'MessageContent'],
  allowedGuilds: [],
  allowedChannels: [],
  allowAllGuilds: false,
  allowAllChannels: false,
  dm: Object.freeze({
    enabled: false,
    allowedUsers: [],
    allowAllUsers: false,
  }),
  ignoreBots: true,
})

export const DEFAULT_CONFIG = Object.freeze({
  transport: 'fake',
  accounts: Object.freeze({}),
})

/**
 * Normalize one account config with LOCKED defaults.
 * @param {AccountConfig} raw
 * @returns {Required<AccountConfig> & { dm: Required<DmConfig> }}
 */
export function normalizeAccountConfig(raw = {}) {
  const dm = { ...DEFAULT_ACCOUNT.dm, ...(raw.dm || {}) }
  return {
    ...DEFAULT_ACCOUNT,
    ...raw,
    allowedGuilds: Array.isArray(raw.allowedGuilds) ? [...raw.allowedGuilds] : [...DEFAULT_ACCOUNT.allowedGuilds],
    allowedChannels: Array.isArray(raw.allowedChannels) ? [...raw.allowedChannels] : [...DEFAULT_ACCOUNT.allowedChannels],
    intents: Array.isArray(raw.intents) ? [...raw.intents] : [...DEFAULT_ACCOUNT.intents],
    allowAllGuilds: Boolean(raw.allowAllGuilds),
    allowAllChannels: Boolean(raw.allowAllChannels),
    dm: {
      enabled: Boolean(dm.enabled),
      allowedUsers: Array.isArray(dm.allowedUsers) ? [...dm.allowedUsers] : [],
      allowAllUsers: Boolean(dm.allowAllUsers),
    },
    ignoreBots: raw.ignoreBots !== undefined ? Boolean(raw.ignoreBots) : true,
    enabled: raw.enabled !== undefined ? Boolean(raw.enabled) : true,
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
    if (!accountId.trim()) {
      throw new TypeError('dsh-piblox-discord: account_id must be non-empty')
    }
    accounts[accountId] = normalizeAccountConfig(cfg)
  }
  const transport = raw.transport === 'discordjs' ? 'discordjs' : 'fake'
  return { transport, accounts }
}

/**
 * Fail-closed allowlist evaluation (LOCKED).
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
    if (!event.userId || !account.dm.allowedUsers.includes(event.userId)) {
      return { ok: false, reason: 'dm_user_denied' }
    }
    return { ok: true }
  }

  if (!account.allowAllGuilds) {
    if (!account.allowedGuilds.length) {
      return { ok: false, reason: 'guilds_deny_all' }
    }
    if (!event.guildId || !account.allowedGuilds.includes(event.guildId)) {
      return { ok: false, reason: 'guild_denied' }
    }
  }

  if (!account.allowAllChannels) {
    if (!account.allowedChannels.length) {
      return { ok: false, reason: 'channels_deny_all' }
    }
    if (!event.channelId || !account.allowedChannels.includes(event.channelId)) {
      return { ok: false, reason: 'channel_denied' }
    }
  }

  return { ok: true }
}
