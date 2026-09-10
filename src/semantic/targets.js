/**
 * Semantic Discord target model + outbound authorization (fail-closed).
 *
 * Target ≠ authorization. Resolving an id does not grant send rights —
 * allowlists still apply after resolution.
 */

import { authorizeInbound } from '../config.js'

export const TARGET_KINDS = Object.freeze(['channel', 'thread', 'dm', 'alias'])

/**
 * @typedef {{
 *   kind: 'channel'|'thread'|'dm'|'alias',
 *   id?: string,
 *   alias?: string,
 *   guildId?: string,
 *   parentChannelId?: string,
 *   userId?: string,
 * }} SemanticTarget
 */

/**
 * @typedef {{
 *   kind: 'channel'|'thread'|'dm',
 *   channelId: string,
 *   guildId?: string,
 *   parentChannelId?: string,
 *   userId?: string,
 *   threadId?: string,
 *   alias?: string,
 * }} ResolvedTarget
 */

/**
 * Normalize proactiveTargets / tool target input.
 * @param {unknown} raw
 * @returns {SemanticTarget | null}
 */
export function normalizeTargetInput(raw) {
  if (!raw || typeof raw !== 'object') return null
  const o = /** @type {Record<string, unknown>} */ (raw)
  if (o.alias != null && String(o.alias).trim()) {
    return { kind: 'alias', alias: String(o.alias).trim() }
  }
  const kind = String(o.kind || '').trim()
  if (kind === 'channel') {
    const id = o.id != null ? String(o.id) : o.channelId != null ? String(o.channelId) : ''
    if (!id) return null
    return {
      kind: 'channel',
      id,
      guildId: o.guildId != null ? String(o.guildId) : undefined,
    }
  }
  if (kind === 'thread') {
    const id = o.id != null ? String(o.id) : o.threadId != null ? String(o.threadId) : ''
    if (!id) return null
    return {
      kind: 'thread',
      id,
      guildId: o.guildId != null ? String(o.guildId) : undefined,
      parentChannelId:
        o.parentChannelId != null
          ? String(o.parentChannelId)
          : o.parent_channel_id != null
            ? String(o.parent_channel_id)
            : undefined,
    }
  }
  if (kind === 'dm') {
    const userId = o.userId != null ? String(o.userId) : o.id != null ? String(o.id) : ''
    if (!userId) return null
    return { kind: 'dm', id: userId, userId }
  }
  // Shorthand: { channelId } / { threadId } / { userId }
  if (o.channelId != null) {
    return {
      kind: 'channel',
      id: String(o.channelId),
      guildId: o.guildId != null ? String(o.guildId) : undefined,
    }
  }
  if (o.threadId != null) {
    return {
      kind: 'thread',
      id: String(o.threadId),
      parentChannelId: o.parentChannelId != null ? String(o.parentChannelId) : undefined,
      guildId: o.guildId != null ? String(o.guildId) : undefined,
    }
  }
  if (o.userId != null) {
    return { kind: 'dm', id: String(o.userId), userId: String(o.userId) }
  }
  return null
}

/**
 * Normalize account proactiveTargets map.
 * @param {unknown} raw
 * @returns {Record<string, SemanticTarget>}
 */
export function normalizeProactiveTargets(raw) {
  /** @type {Record<string, SemanticTarget>} */
  const out = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [key, val] of Object.entries(/** @type {Record<string, unknown>} */ (raw))) {
    const alias = String(key || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '')
    if (!alias || alias.length > 64) continue
    if (!val || typeof val !== 'object') continue
    const v = /** @type {Record<string, unknown>} */ (val)
    // Legacy shape: { channelId, guildId } → channel
    if (v.kind == null && (v.channelId != null || v.threadId != null || v.userId != null)) {
      const normalized = normalizeTargetInput({
        kind: v.threadId ? 'thread' : v.userId ? 'dm' : 'channel',
        ...v,
        id: v.threadId || v.userId || v.channelId,
      })
      if (normalized && normalized.kind !== 'alias') out[alias] = normalized
      continue
    }
    const normalized = normalizeTargetInput(v)
    if (normalized && normalized.kind !== 'alias') out[alias] = normalized
  }
  return out
}

/**
 * Resolve alias → concrete target (account-local only).
 * @param {ReturnType<import('../config.js').normalizeAccountConfig>} account
 * @param {SemanticTarget} target
 * @returns {{ ok: true, target: ResolvedTarget } | { ok: false, reason: string }}
 */
export function resolveSemanticTarget(account, target) {
  if (!target) return { ok: false, reason: 'target_required' }

  if (target.kind === 'alias') {
    const alias = String(target.alias || '')
      .trim()
      .toLowerCase()
    const map = account.proactiveTargets || {}
    const hit = map[alias]
    if (!hit) return { ok: false, reason: 'alias_unknown' }
    return resolveSemanticTarget(account, /** @type {SemanticTarget} */ (hit))
  }

  if (target.kind === 'channel') {
    const channelId = String(target.id || '')
    if (!channelId) return { ok: false, reason: 'channel_id_required' }
    return {
      ok: true,
      target: {
        kind: 'channel',
        channelId,
        guildId: target.guildId,
      },
    }
  }

  if (target.kind === 'thread') {
    const threadId = String(target.id || '')
    if (!threadId) return { ok: false, reason: 'thread_id_required' }
    return {
      ok: true,
      target: {
        kind: 'thread',
        channelId: threadId,
        threadId,
        parentChannelId: target.parentChannelId,
        guildId: target.guildId,
      },
    }
  }

  if (target.kind === 'dm') {
    const userId = String(target.userId || target.id || '')
    if (!userId) return { ok: false, reason: 'user_id_required' }
    return {
      ok: true,
      target: {
        kind: 'dm',
        channelId: userId, // DM channel resolved by transport when needed; auth uses userId
        userId,
      },
    }
  }

  return { ok: false, reason: 'target_kind_unsupported' }
}

/**
 * Authorize outbound delivery to a resolved target (fail-closed).
 * Same guild / channel|parent / DM gates as inbound; guild-user allowlist does
 * not apply (bot is the actor for proactive/tool sends).
 *
 * @param {ReturnType<import('../config.js').normalizeAccountConfig>} account
 * @param {ResolvedTarget} resolved
 * @param {{ transport?: any, accountId?: string }} [opts]
 */
export async function authorizeOutboundDelivery(account, resolved, opts = {}) {
  if (!account?.enabled) return { ok: false, reason: 'account_disabled' }

  if (resolved.kind === 'dm') {
    return authorizeInbound(account, { isDm: true, userId: resolved.userId })
  }

  let guildId = resolved.guildId
  let parentChannelId = resolved.parentChannelId

  if (opts.transport?.getChannel) {
    try {
      const meta = await opts.transport.getChannel(opts.accountId, resolved.channelId)
      if (meta?.parentId && !parentChannelId) parentChannelId = String(meta.parentId)
      if (meta?.guildId && !guildId) guildId = String(meta.guildId)
    } catch {
      /* ignore */
    }
  }

  const inThread = resolved.kind === 'thread' || Boolean(parentChannelId)
  if (inThread && !parentChannelId && !account.allowAllChannels) {
    return { ok: false, reason: 'thread_parent_unknown' }
  }

  if (!account.allowAllGuilds) {
    if (!account.allowedGuilds.length) return { ok: false, reason: 'guilds_deny_all' }
    if (!guildId || !account.allowedGuilds.includes(String(guildId))) {
      return { ok: false, reason: 'guild_denied' }
    }
  }

  const channelKey = inThread ? parentChannelId : resolved.channelId
  if (!account.allowAllChannels) {
    if (!account.allowedChannels.length) return { ok: false, reason: 'channels_deny_all' }
    if (!channelKey || !account.allowedChannels.includes(String(channelKey))) {
      return { ok: false, reason: 'channel_denied' }
    }
  }

  return { ok: true }
}
