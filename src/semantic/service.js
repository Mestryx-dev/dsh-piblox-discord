/**
 * Semantic Discord service API — trusted Cordis consumers + proactive notify.
 * All mutations go through DeliveryOutbox. No tokens, no discord.js leaks.
 */

import { randomUUID } from 'node:crypto'
import { defaultAllowedMentions } from '../components/encode.js'
import { toReceipt } from '../outbox/types.js'
import {
  normalizeTargetInput,
  resolveSemanticTarget,
  authorizeOutboundDelivery,
} from './targets.js'

/**
 * @typedef {{
 *   operation_id: string,
 *   account_id: string,
 *   state: string,
 *   discord_resource_id: string | null,
 *   attempts: number,
 *   error_class: string | null,
 *   correlation_id: string | null,
 * }} SemanticReceipt
 */

/**
 * @param {import('../outbox/types.js').DeliveryReceipt} receipt
 * @returns {SemanticReceipt}
 */
export function toSemanticReceipt(receipt) {
  return {
    operation_id: receipt.operation_id,
    account_id: receipt.account_id,
    state: receipt.state,
    discord_resource_id: receipt.discord_resource_id,
    attempts: receipt.attempts,
    error_class: receipt.error_class,
    correlation_id: receipt.correlation_id,
  }
}

/**
 * @param {{
 *   getAccounts: () => Record<string, any>,
 *   transport: any,
 *   outbox: any,
 *   observability?: any,
 *   logger?: any,
 * }} deps
 */
export function createSemanticDiscordService(deps) {
  const { getAccounts, transport, outbox, observability, logger } = deps

  function requireAccount(accountId) {
    const id = String(accountId || '').trim()
    if (!id) {
      const err = Object.assign(new Error('account_id required'), { code: 'account_required' })
      throw err
    }
    const account = getAccounts()[id]
    if (!account) {
      throw Object.assign(new Error(`unknown account: ${id}`), { code: 'unknown_account' })
    }
    if (!account.enabled) {
      throw Object.assign(new Error(`account disabled: ${id}`), { code: 'account_disabled' })
    }
    return { accountId: id, account }
  }

  function emitObs(type, payload) {
    try {
      observability?.emit?.(type, payload)
    } catch {
      /* closed Core vocabulary — ignore contract violations */
    }
  }

  /**
   * @param {string} accountId
   * @param {unknown} targetInput
   */
  async function resolveAndAuthorize(accountId, targetInput) {
    const { account } = requireAccount(accountId)
    const normalized = normalizeTargetInput(targetInput)
    if (!normalized) {
      return { ok: false, reason: 'target_invalid' }
    }
    const resolved = resolveSemanticTarget(account, normalized)
    if (!resolved.ok) return resolved
    const auth = await authorizeOutboundDelivery(account, resolved.target, {
      transport,
      accountId,
    })
    if (!auth.ok) return auth
    return { ok: true, target: resolved.target, account }
  }

  /**
   * Drive outbox until delivered / retry_wait / failed_terminal (bounded).
   * @param {string} operationId
   * @param {string} accountId
   * @param {number} [maxRounds]
   */
  async function waitDelivery(operationId, accountId, maxRounds = 8) {
    for (let i = 0; i < maxRounds; i++) {
      const receipt = outbox.getReceipt(operationId)
      if (!receipt) return null
      if (
        receipt.state === 'delivered' ||
        receipt.state === 'failed_terminal' ||
        receipt.state === 'retry_wait'
      ) {
        return receipt
      }
      await outbox.tick({ accountId })
    }
    return outbox.getReceipt(operationId)
  }

  /**
   * @param {{
   *   accountId: string,
   *   operationType: string,
   *   target: import('../outbox/types.js').OutboxTarget,
   *   payload?: object,
   *   operationId?: string,
   *   correlationId?: string,
   *   useNonce?: boolean,
   *   wait?: boolean,
   * }} input
   */
  async function enqueueMutation(input) {
    if (!outbox) throw Object.assign(new Error('outbox required'), { code: 'outbox_required' })
    const operationId = String(input.operationId || `discord:${input.operationType}:${randomUUID()}`)
    const receipt = await outbox.enqueue({
      operationId,
      accountId: input.accountId,
      operationType: input.operationType,
      target: input.target,
      payload: input.payload || {},
      correlationId: input.correlationId,
      useNonce: input.useNonce,
    })
    emitObs('tool.called', {
      tool: `discord.service.${input.operationType}`,
      operation_id: operationId,
      account_id: input.accountId,
      correlation_id: input.correlationId || null,
    })
    if (input.wait) {
      const final = await waitDelivery(operationId, input.accountId)
      return toSemanticReceipt(final || receipt)
    }
    return toSemanticReceipt(receipt)
  }

  return {
    /**
     * List guilds visible to the account (normalized DTOs).
     * @param {{ accountId: string }} input
     */
    async guildList(input) {
      const { accountId } = requireAccount(input.accountId)
      if (typeof transport.listGuilds !== 'function') {
        throw Object.assign(new Error('listGuilds not supported by transport'), {
          code: 'unsupported',
        })
      }
      const guilds = await transport.listGuilds(accountId)
      return {
        account_id: accountId,
        guilds: (guilds || []).map((g) => ({
          id: String(g.id),
          name: g.name != null ? String(g.name) : null,
        })),
      }
    },

    /**
     * @param {{ accountId: string, channelId: string }} input
     */
    async channelGet(input) {
      const { accountId, account } = requireAccount(input.accountId)
      const channelId = String(input.channelId || '')
      if (!channelId) throw Object.assign(new Error('channel_id required'), { code: 'invalid_payload' })
      if (typeof transport.getChannel !== 'function') {
        throw Object.assign(new Error('getChannel not supported by transport'), {
          code: 'unsupported',
        })
      }
      const ch = await transport.getChannel(accountId, channelId)
      if (!ch) throw Object.assign(new Error('channel not found'), { code: 'unknown_target' })
      // Read auth: channel or its parent must be allowlisted (or allowAll)
      const auth = await authorizeOutboundDelivery(
        account,
        {
          kind: ch.isThread ? 'thread' : 'channel',
          channelId: String(ch.id),
          threadId: ch.isThread ? String(ch.id) : undefined,
          parentChannelId: ch.parentId != null ? String(ch.parentId) : undefined,
          guildId: ch.guildId != null ? String(ch.guildId) : undefined,
        },
        { transport, accountId },
      )
      if (!auth.ok) {
        throw Object.assign(new Error(`channel denied: ${auth.reason}`), { code: auth.reason })
      }
      return {
        account_id: accountId,
        channel: {
          id: String(ch.id),
          name: ch.name != null ? String(ch.name) : null,
          type: ch.type != null ? Number(ch.type) : null,
          guild_id: ch.guildId != null ? String(ch.guildId) : null,
          parent_id: ch.parentId != null ? String(ch.parentId) : null,
          is_thread: Boolean(ch.isThread),
        },
      }
    },

    /**
     * @param {{ accountId: string, guildId: string, limit?: number }} input
     */
    async channelList(input) {
      const { accountId, account } = requireAccount(input.accountId)
      const guildId = String(input.guildId || '')
      if (!guildId) throw Object.assign(new Error('guild_id required'), { code: 'invalid_payload' })
      if (!account.allowAllGuilds && !account.allowedGuilds.includes(guildId)) {
        throw Object.assign(new Error('guild denied'), { code: 'guild_denied' })
      }
      if (typeof transport.listChannels !== 'function') {
        throw Object.assign(new Error('listChannels not supported by transport'), {
          code: 'unsupported',
        })
      }
      const limit = Math.min(Math.max(Number(input.limit) || 50, 1), 100)
      const channels = await transport.listChannels(accountId, guildId, { limit })
      return {
        account_id: accountId,
        guild_id: guildId,
        channels: (channels || []).slice(0, limit).map((c) => ({
          id: String(c.id),
          name: c.name != null ? String(c.name) : null,
          type: c.type != null ? Number(c.type) : null,
          parent_id: c.parentId != null ? String(c.parentId) : null,
        })),
      }
    },

    /**
     * @param {{ accountId: string, channelId: string, messageId: string }} input
     */
    async messageGet(input) {
      const { accountId } = requireAccount(input.accountId)
      const channelId = String(input.channelId || '')
      const messageId = String(input.messageId || '')
      if (!channelId || !messageId) {
        throw Object.assign(new Error('channel_id and message_id required'), {
          code: 'invalid_payload',
        })
      }
      // Reuse channelGet authorization
      await this.channelGet({ accountId, channelId })
      if (typeof transport.getMessage !== 'function') {
        throw Object.assign(new Error('getMessage not supported by transport'), {
          code: 'unsupported',
        })
      }
      const msg = await transport.getMessage(accountId, channelId, messageId)
      if (!msg) throw Object.assign(new Error('message not found'), { code: 'unknown_target' })
      return {
        account_id: accountId,
        message: {
          id: String(msg.id),
          channel_id: String(msg.channelId || channelId),
          author_id: msg.authorId != null ? String(msg.authorId) : null,
          content: msg.content != null ? String(msg.content).slice(0, 2000) : '',
          timestamp: msg.timestamp || null,
        },
      }
    },

    /**
     * @param {{ accountId: string, channelId: string, limit?: number, before?: string }} input
     */
    async messageHistory(input) {
      const { accountId } = requireAccount(input.accountId)
      const channelId = String(input.channelId || '')
      if (!channelId) throw Object.assign(new Error('channel_id required'), { code: 'invalid_payload' })
      await this.channelGet({ accountId, channelId })
      if (typeof transport.listMessages !== 'function') {
        throw Object.assign(new Error('listMessages not supported by transport'), {
          code: 'unsupported',
        })
      }
      const limit = Math.min(Math.max(Number(input.limit) || 20, 1), 50)
      const messages = await transport.listMessages(accountId, channelId, {
        limit,
        before: input.before,
      })
      return {
        account_id: accountId,
        channel_id: channelId,
        messages: (messages || []).slice(0, limit).map((msg) => ({
          id: String(msg.id),
          author_id: msg.authorId != null ? String(msg.authorId) : null,
          content: msg.content != null ? String(msg.content).slice(0, 2000) : '',
          timestamp: msg.timestamp || null,
        })),
      }
    },

    /**
     * @param {{
     *   accountId: string,
     *   target: unknown,
     *   content?: string,
     *   components?: unknown[],
     *   componentsV2?: boolean,
     *   operationId?: string,
     *   correlationId?: string,
     *   wait?: boolean,
     * }} input
     */
    async messageSend(input) {
      const { accountId } = requireAccount(input.accountId)
      if (!transport.isAccountRunning?.(accountId)) {
        throw Object.assign(new Error('account not running'), { code: 'account_stopped' })
      }
      const resolved = await resolveAndAuthorize(accountId, input.target)
      if (!resolved.ok) {
        throw Object.assign(new Error(`target denied: ${resolved.reason}`), {
          code: resolved.reason,
        })
      }
      /** @type {string} */
      let channelId = resolved.target.channelId
      if (resolved.target.kind === 'dm') {
        if (typeof transport.resolveDmChannel !== 'function') {
          throw Object.assign(new Error('DM send not supported by transport'), {
            code: 'unsupported',
          })
        }
        channelId = await transport.resolveDmChannel(accountId, resolved.target.userId)
      }
      return enqueueMutation({
        accountId,
        operationType: 'sendMessage',
        target: { channelId, guildId: resolved.target.guildId },
        payload: {
          content: input.content,
          components: input.components,
          componentsV2: input.componentsV2,
          allowedMentions: defaultAllowedMentions(),
        },
        operationId: input.operationId,
        correlationId: input.correlationId,
        useNonce: true,
        wait: Boolean(input.wait),
      })
    },

    /**
     * @param {{
     *   accountId: string,
     *   channelId: string,
     *   messageId: string,
     *   content?: string,
     *   components?: unknown[],
     *   componentsV2?: boolean,
     *   operationId?: string,
     *   correlationId?: string,
     *   wait?: boolean,
     * }} input
     */
    async messageReply(input) {
      const { accountId, account } = requireAccount(input.accountId)
      const channelId = String(input.channelId || '')
      const messageId = String(input.messageId || '')
      if (!channelId || !messageId) {
        throw Object.assign(new Error('channel_id and message_id required'), {
          code: 'invalid_payload',
        })
      }
      const auth = await authorizeOutboundDelivery(
        account,
        { kind: 'channel', channelId },
        { transport, accountId },
      )
      // Thread replies: authorize via getChannel parent when channel is a thread
      if (!auth.ok) {
        const meta =
          typeof transport.getChannel === 'function'
            ? await transport.getChannel(accountId, channelId).catch(() => null)
            : null
        if (meta?.isThread || meta?.parentId) {
          const threadAuth = await authorizeOutboundDelivery(
            account,
            {
              kind: 'thread',
              channelId,
              threadId: channelId,
              parentChannelId: meta.parentId != null ? String(meta.parentId) : undefined,
              guildId: meta.guildId != null ? String(meta.guildId) : undefined,
            },
            { transport, accountId },
          )
          if (!threadAuth.ok) {
            throw Object.assign(new Error(`target denied: ${threadAuth.reason}`), {
              code: threadAuth.reason,
            })
          }
        } else {
          throw Object.assign(new Error(`target denied: ${auth.reason}`), { code: auth.reason })
        }
      }
      return enqueueMutation({
        accountId,
        operationType: 'replyMessage',
        target: { channelId, messageId },
        payload: {
          content: input.content,
          components: input.components,
          componentsV2: input.componentsV2,
          replyTo: messageId,
          allowedMentions: defaultAllowedMentions(),
        },
        operationId: input.operationId,
        correlationId: input.correlationId,
        useNonce: false,
        wait: Boolean(input.wait),
      })
    },

    /**
     * @param {{
     *   accountId: string,
     *   channelId: string,
     *   messageId: string,
     *   content?: string,
     *   components?: unknown[],
     *   componentsV2?: boolean,
     *   operationId?: string,
     *   correlationId?: string,
     *   wait?: boolean,
     * }} input
     */
    async messageEdit(input) {
      const { accountId, account } = requireAccount(input.accountId)
      const channelId = String(input.channelId || '')
      const messageId = String(input.messageId || '')
      if (!channelId || !messageId) {
        throw Object.assign(new Error('channel_id and message_id required'), {
          code: 'invalid_payload',
        })
      }
      const meta =
        typeof transport.getChannel === 'function'
          ? await transport.getChannel(accountId, channelId).catch(() => null)
          : null
      const auth = await authorizeOutboundDelivery(
        account,
        meta?.parentId
          ? {
              kind: 'thread',
              channelId,
              threadId: channelId,
              parentChannelId: String(meta.parentId),
              guildId: meta.guildId != null ? String(meta.guildId) : undefined,
            }
          : { kind: 'channel', channelId, guildId: meta?.guildId != null ? String(meta.guildId) : undefined },
        { transport, accountId },
      )
      if (!auth.ok) {
        throw Object.assign(new Error(`target denied: ${auth.reason}`), { code: auth.reason })
      }
      return enqueueMutation({
        accountId,
        operationType: 'editMessage',
        target: { channelId, messageId },
        payload: {
          content: input.content,
          components: input.components,
          componentsV2: input.componentsV2,
          allowedMentions: defaultAllowedMentions(),
        },
        operationId: input.operationId,
        correlationId: input.correlationId,
        useNonce: false,
        wait: Boolean(input.wait),
      })
    },

    /**
     * Reuses proven outbox createThread path (same operation identity).
     * @param {{
     *   accountId: string,
     *   parentChannelId: string,
     *   messageId: string,
     *   name?: string,
     *   operationId?: string,
     *   correlationId?: string,
     *   wait?: boolean,
     * }} input
     */
    async threadCreate(input) {
      const { accountId, account } = requireAccount(input.accountId)
      const parentChannelId = String(input.parentChannelId || '')
      const messageId = String(input.messageId || '')
      if (!parentChannelId || !messageId) {
        throw Object.assign(new Error('parent_channel_id and message_id required'), {
          code: 'invalid_payload',
        })
      }
      const auth = await authorizeOutboundDelivery(
        account,
        { kind: 'channel', channelId: parentChannelId },
        { transport, accountId },
      )
      if (!auth.ok) {
        throw Object.assign(new Error(`target denied: ${auth.reason}`), { code: auth.reason })
      }
      const operationId =
        input.operationId || `thread:create:${accountId}:${messageId}`
      return enqueueMutation({
        accountId,
        operationType: 'createThread',
        target: { parentChannelId, channelId: parentChannelId, messageId },
        payload: {
          threadName: input.name || 'thread',
          allowedMentions: defaultAllowedMentions(),
        },
        operationId,
        correlationId: input.correlationId,
        useNonce: false,
        wait: Boolean(input.wait),
      })
    },

    /**
     * Proactive notification via alias or explicit target.
     * Does NOT create ConversationBinding or AgentLoop.
     *
     * @param {{
     *   accountId: string,
     *   target: unknown,
     *   content?: string,
     *   components?: unknown[],
     *   componentsV2?: boolean,
     *   operationId?: string,
     *   correlationId?: string,
     *   wait?: boolean,
     * }} input
     */
    async notify(input) {
      logger?.info?.(
        `discord notify account=${input.accountId} (no binding/session mint)`,
      )
      return this.messageSend(input)
    },

    /** @deprecated use notify */
    proactiveNotify(input) {
      return this.notify(input)
    },

    resolveTarget: resolveAndAuthorize,
    toSemanticReceipt,
    waitDelivery,
  }
}
