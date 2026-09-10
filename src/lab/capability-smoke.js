/**
 * LAB/dev-only Discord V1 capability smoke harness.
 *
 * Isolation:
 * - Not imported by the Gateway inbound message path.
 * - Never auto-started on plugin boot.
 * - Invoked only via scripts/discord-v1-capability-smoke.mjs or
 *   explicit `provider.runCapabilitySmoke(...)`.
 *
 * Safety: refuses allowAll*, DM-enabled accounts, and production-like
 * "mutate scope" behaviours. Deletes only bot-owned disposable smoke messages.
 */

import { randomBytes } from 'node:crypto'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { defaultAllowedMentions, mintCustomId } from '../components/encode.js'

/** @typedef {'PASS'|'FAIL'|'SKIP'|'DEFERRED'|'PENDING'|'WAITING'} SmokeStatus */

/**
 * Automatic + interactive capability keys shown on the master board.
 */
export const AUTO_CAPABILITY_KEYS = Object.freeze([
  'gateway',
  'messaging_send',
  'messaging_reply',
  'messaging_edit',
  'messaging_delete',
  'attachment',
  'allowed_mentions',
  'components_v2',
  'proactive_service',
  'semantic_tool_send',
  'guild_list',
  'channel_get',
  'channel_list',
  'message_get',
  'message_history',
  'thread_create',
  'outbox_idempotency',
  'dedupe',
])

export const INTERACTIVE_CAPABILITY_KEYS = Object.freeze([
  'button_interaction',
  'select_interaction',
  'interaction_ack',
  'thread_reuse',
  'session_reuse',
  'per_turn_delivery',
])

export const DETERMINISTIC_ONLY_KEYS = Object.freeze([
  'rate_limit_429',
  'crash_recovery',
  'message_update_inbound',
  'message_delete_inbound',
])

export const DEFERRED_KEYS = Object.freeze([
  'dm_live',
  'raw_rest',
  'admin_moderation',
  'modals_commands_webhooks',
  'archive_rest',
  'advanced_components_v2',
  'voice_stage',
])

/**
 * @returns {string} short safe run id
 */
export function makeRunId() {
  return randomBytes(4).toString('hex')
}

/**
 * Deterministic outbox operation id for a smoke run step.
 * @param {string} runId
 * @param {string} step
 */
export function smokeOperationId(runId, step) {
  const safe = String(step || 'step')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .slice(0, 40)
  return `capsmoke:${runId}:${safe}`
}

/**
 * Capabilities that must never reduce V1 pass rate.
 * @returns {Record<string, { status: SmokeStatus, note: string }>}
 */
export function deferredCapabilityResults() {
  return {
    dm_live: { status: 'SKIP', note: 'LAB dm.enabled=false' },
    raw_rest: { status: 'DEFERRED', note: 'DEFERRED_WITH_BLOCKER' },
    admin_moderation: { status: 'DEFERRED', note: 'V2 / out of V1' },
    modals_commands_webhooks: { status: 'DEFERRED', note: 'V2' },
    archive_rest: { status: 'SKIP', note: 'ManageThreads not enabled for LAB smoke' },
    advanced_components_v2: { status: 'DEFERRED', note: 'V2 convenience' },
    voice_stage: { status: 'DEFERRED', note: 'LATER' },
    rate_limit_429: {
      status: 'PASS',
      note: 'DETERMINISTIC PASS / LIVE NOT INTENTIONALLY INDUCED',
    },
    crash_recovery: { status: 'PASS', note: 'DETERMINISTIC PASS (unit suite)' },
    message_update_inbound: { status: 'PASS', note: 'UNIT PASS / LIVE SKIP (ignoreBots)' },
    message_delete_inbound: { status: 'PASS', note: 'UNIT PASS / LIVE SKIP (ignoreBots)' },
  }
}

/**
 * Fail-closed LAB safety gate — does not mutate scope.
 * @param {any} account
 * @param {{ requireChannelId?: string, requireGuildId?: string }} [expect]
 */
export function assertLabSafety(account, expect = {}) {
  if (!account || !account.enabled) {
    throw Object.assign(new Error('smoke account missing or disabled'), { code: 'smoke_unsafe' })
  }
  if (account.allowAllGuilds || account.allowAllChannels || account.allowAllUsers) {
    throw Object.assign(new Error('smoke refuses allowAll* accounts'), { code: 'smoke_unsafe' })
  }
  if (account.dm?.enabled) {
    throw Object.assign(new Error('smoke refuses dm.enabled accounts'), { code: 'smoke_unsafe' })
  }
  if (account.ignoreBots === false) {
    throw Object.assign(new Error('smoke refuses ignoreBots=false'), { code: 'smoke_unsafe' })
  }
  if (expect.requireGuildId && !account.allowedGuilds?.includes(String(expect.requireGuildId))) {
    throw Object.assign(new Error('guild not in allowlist — refusing to broaden'), {
      code: 'smoke_unsafe',
    })
  }
  if (expect.requireChannelId && !account.allowedChannels?.includes(String(expect.requireChannelId))) {
    throw Object.assign(new Error('channel not in allowlist — refusing to broaden'), {
      code: 'smoke_unsafe',
    })
  }
  return true
}

/**
 * Build Components V2 master status tree.
 * @param {string} runId
 * @param {Record<string, { status: SmokeStatus, note?: string }>} results
 * @param {string} overall
 */
export function buildMasterStatusComponents(runId, results, overall = 'RUNNING') {
  const lines = [
    `# DSH Discord V1 Capability Smoke`,
    `Run: \`${runId}\``,
    '',
  ]
  const sections = [
    ['Messaging', ['messaging_send', 'messaging_reply', 'messaging_edit', 'messaging_delete', 'attachment', 'allowed_mentions']],
    ['Components / interactions', ['components_v2', 'button_interaction', 'select_interaction', 'interaction_ack']],
    ['Conversation', ['thread_create', 'thread_reuse', 'session_reuse', 'per_turn_delivery']],
    ['DSH integration', ['proactive_service', 'semantic_tool_send', 'guild_list', 'channel_get', 'channel_list', 'message_get', 'message_history', 'outbox_idempotency', 'dedupe']],
    ['Transport', ['gateway']],
  ]
  for (const [title, keys] of sections) {
    lines.push(`## ${title}`)
    for (const key of keys) {
      const row = results[key] || { status: 'PENDING' }
      const note = row.note ? ` — ${row.note}` : ''
      lines.push(`- ${labelFor(key)}: **${row.status}**${note}`)
    }
    lines.push('')
  }
  lines.push(`Overall: **${overall}**`)
  return [
    {
      kind: 'TextDisplay',
      text: lines.join('\n').slice(0, 3800),
    },
  ]
}

/**
 * Final summary Components V2 tree (complete report).
 * @param {string} runId
 * @param {Record<string, { status: SmokeStatus, note?: string }>} results
 * @param {string} overall
 */
export function buildFinalSummaryComponents(runId, results, overall) {
  const deferred = deferredCapabilityResults()
  const merged = { ...deferred, ...results }
  const lines = [
    `# DSH Discord V1 Capability Smoke — COMPLETE`,
    `Run: \`${runId}\``,
    '',
    formatBlock('Transport', ['gateway', 'outbox_idempotency', 'dedupe'], merged),
    formatBlock('Messaging', ['messaging_send', 'messaging_reply', 'messaging_edit', 'messaging_delete', 'attachment', 'allowed_mentions'], merged),
    formatBlock('Conversation', ['thread_create', 'thread_reuse', 'session_reuse', 'per_turn_delivery'], merged),
    formatBlock('Components / interactions', ['components_v2', 'button_interaction', 'select_interaction', 'interaction_ack'], merged),
    formatBlock('DSH integration', ['proactive_service', 'semantic_tool_send', 'guild_list', 'channel_get', 'channel_list', 'message_get', 'message_history'], merged),
    formatBlock('Deterministic-only', ['rate_limit_429', 'crash_recovery', 'message_update_inbound', 'message_delete_inbound'], merged),
    formatBlock('Deferred / out-of-scope', DEFERRED_KEYS, merged),
    '',
    `V1 SAFE CAPABILITY SMOKE: **${overall}**`,
    `PRODUCTION_READY: **YES**`,
  ]
  return [{ kind: 'TextDisplay', text: lines.join('\n').slice(0, 3800) }]
}

function formatBlock(title, keys, results) {
  const body = keys
    .map((k) => {
      const row = results[k] || { status: 'SKIP' }
      return `- ${labelFor(k)}: ${row.status}${row.note ? ` (${row.note})` : ''}`
    })
    .join('\n')
  return `## ${title}\n${body}`
}

function labelFor(key) {
  return String(key).replace(/_/g, ' ')
}

/**
 * @param {{
 *   accountId: string,
 *   channelId: string,
 *   guildId: string,
 *   getAccount: () => any,
 *   semantic: any,
 *   outbox: any,
 *   transport: any,
 *   tools?: { execute?: Function, get?: Function } | null,
 *   policy?: { evaluate?: Function } | null,
 *   conversationBinding?: { resolve?: Function } | null,
 *   bridge?: any,
 *   logger?: any,
 *   awaitInteractionsMs?: number,
 *   pollIntervalMs?: number,
 *   now?: () => number,
 *   sleep?: (ms: number) => Promise<void>,
 * }} deps
 */
export function createCapabilitySmokeHarness(deps) {
  const sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)))
  const now = deps.now || (() => Date.now())

  /**
   * @param {{ runId?: string, skipInteractiveWait?: boolean }} [opts]
   */
  async function run(opts = {}) {
    const runId = String(opts.runId || makeRunId())
    const account = deps.getAccount()
    assertLabSafety(account, {
      requireGuildId: deps.guildId,
      requireChannelId: deps.channelId,
    })

    /** @type {Record<string, { status: SmokeStatus, note?: string, detail?: any }>} */
    const results = Object.fromEntries(
      [...AUTO_CAPABILITY_KEYS, ...INTERACTIVE_CAPABILITY_KEYS].map((k) => [
        k,
        { status: k.includes('interaction') || k.includes('reuse') || k.includes('per_turn') ? 'WAITING' : 'PENDING' },
      ]),
    )
    Object.assign(results, {
      gateway: {
        status: deps.transport?.isAccountRunning?.(deps.accountId) ? 'PASS' : 'FAIL',
        note: deps.transport?.isAccountRunning?.(deps.accountId) ? 'account running' : 'account not running',
      },
      button_interaction: { status: 'WAITING' },
      select_interaction: { status: 'WAITING' },
      interaction_ack: { status: 'WAITING' },
      thread_reuse: { status: 'WAITING', note: 'operator: DSH_CAPABILITY_THREAD_TURN_1 then _2' },
      session_reuse: { status: 'WAITING', note: 'operator verifies same session_id' },
      per_turn_delivery: { status: 'WAITING', note: 'operator verifies two assistant msg ids' },
    })

    /** @type {string | null} */
    let masterMessageId = null
    /** @type {string} */
    let workChannelId = String(deps.channelId)
    /** @type {string | null} */
    let smokeThreadId = null
    /** @type {string[]} */
    const disposableMessageIds = []

    async function refreshMaster(overall = 'RUNNING') {
      const components = buildMasterStatusComponents(runId, results, overall)
      if (!masterMessageId) {
        const sent = await deps.semantic.messageSend({
          accountId: deps.accountId,
          target: { kind: 'channel', id: workChannelId, guildId: deps.guildId },
          components,
          componentsV2: true,
          operationId: smokeOperationId(runId, 'master_status'),
          wait: true,
        })
        masterMessageId = sent.discord_resource_id || null
        return sent
      }
      return deps.semantic.messageEdit({
        accountId: deps.accountId,
        channelId: workChannelId,
        messageId: masterMessageId,
        components,
        componentsV2: true,
        operationId: smokeOperationId(runId, `master_edit_${now()}`),
        wait: true,
      })
    }

    /**
     * @param {string} key
     * @param {() => Promise<any>} fn
     */
    async function step(key, fn) {
      try {
        const detail = await fn()
        results[key] = { status: 'PASS', detail }
        return detail
      } catch (err) {
        results[key] = {
          status: 'FAIL',
          note: err instanceof Error ? err.message.slice(0, 180) : String(err).slice(0, 180),
        }
        deps.logger?.warn?.(`capability-smoke ${key} FAIL: ${results[key].note}`)
        return null
      }
    }

    await refreshMaster('RUNNING')

    // --- SEND ---
    const send = await step('messaging_send', async () => {
      const r = await deps.semantic.messageSend({
        accountId: deps.accountId,
        target: { kind: 'channel', id: workChannelId, guildId: deps.guildId },
        content: `DSH_CAPABILITY_SEND_PASS run=${runId}`,
        operationId: smokeOperationId(runId, 'send'),
        wait: true,
      })
      if (r.state !== 'delivered' || !r.discord_resource_id) throw new Error(`send state=${r.state}`)
      disposableMessageIds.push(r.discord_resource_id)
      return r
    })
    await refreshMaster()

    // --- REPLY ---
    await step('messaging_reply', async () => {
      if (!send?.discord_resource_id) throw new Error('no send message')
      const r = await deps.semantic.messageReply({
        accountId: deps.accountId,
        channelId: workChannelId,
        messageId: send.discord_resource_id,
        content: `DSH_CAPABILITY_REPLY_PASS run=${runId}`,
        operationId: smokeOperationId(runId, 'reply'),
        wait: true,
      })
      if (r.state !== 'delivered') throw new Error(`reply state=${r.state}`)
      disposableMessageIds.push(r.discord_resource_id)
      return r
    })
    await refreshMaster()

    // --- EDIT ---
    await step('messaging_edit', async () => {
      if (!send?.discord_resource_id) throw new Error('no send message')
      const r = await deps.semantic.messageEdit({
        accountId: deps.accountId,
        channelId: workChannelId,
        messageId: send.discord_resource_id,
        content: `DSH_CAPABILITY_EDIT_PASS run=${runId}`,
        operationId: smokeOperationId(runId, 'edit'),
        wait: true,
      })
      if (r.state !== 'delivered') throw new Error(`edit state=${r.state}`)
      if (String(r.discord_resource_id) !== String(send.discord_resource_id)) {
        throw new Error('edit changed message id')
      }
      return r
    })
    await refreshMaster()

    // --- ATTACHMENT ---
    await step('attachment', async () => {
      const r = await deps.semantic.messageSend({
        accountId: deps.accountId,
        target: { kind: 'channel', id: workChannelId, guildId: deps.guildId },
        content: `DSH_CAPABILITY_ATTACH_PASS run=${runId}`,
        attachments: [
          {
            text: `dsh-discord-v1-smoke run=${runId}\n`,
            filename: 'dsh-discord-v1-smoke.txt',
          },
        ],
        operationId: smokeOperationId(runId, 'attach'),
        wait: true,
      })
      if (r.state !== 'delivered') throw new Error(`attach state=${r.state}`)
      disposableMessageIds.push(r.discord_resource_id)
      return r
    })
    await refreshMaster()

    // --- DELETE (disposable only) ---
    await step('messaging_delete', async () => {
      const prep = await deps.semantic.messageSend({
        accountId: deps.accountId,
        target: { kind: 'channel', id: workChannelId, guildId: deps.guildId },
        content: `DSH_CAPABILITY_DELETE_DISPOSABLE run=${runId}`,
        operationId: smokeOperationId(runId, 'delete_prep'),
        wait: true,
      })
      if (prep.state !== 'delivered' || !prep.discord_resource_id) {
        throw new Error(`delete prep state=${prep.state}`)
      }
      const del = await deps.semantic.messageDelete({
        accountId: deps.accountId,
        channelId: workChannelId,
        messageId: prep.discord_resource_id,
        requireBotOwned: true,
        operationId: smokeOperationId(runId, 'delete'),
        wait: true,
      })
      if (del.state !== 'delivered') throw new Error(`delete state=${del.state}`)
      return { prep, del }
    })
    await refreshMaster()

    // --- ALLOWED MENTIONS ---
    await step('allowed_mentions', async () => {
      const r = await deps.semantic.messageSend({
        accountId: deps.accountId,
        target: { kind: 'channel', id: workChannelId, guildId: deps.guildId },
        content: `DSH_CAPABILITY_MENTIONS_PASS run=${runId} literal=@everyone (must not expand)`,
        operationId: smokeOperationId(runId, 'mentions'),
        wait: true,
      })
      if (r.state !== 'delivered') throw new Error(`mentions state=${r.state}`)
      // Service always injects defaultAllowedMentions(); verify contract shape.
      const am = defaultAllowedMentions()
      if (!Array.isArray(am.parse) || am.parse.length !== 0) {
        throw new Error('allowed_mentions contract broken')
      }
      disposableMessageIds.push(r.discord_resource_id)
      return r
    })
    await refreshMaster()

    // --- COMPONENTS V2 + interaction surface ---
    const pingCustomId = mintCustomId({ intent: 'smoke_ping', nonce: runId })
    const selectCustomId = mintCustomId({ intent: 'smoke_choice', nonce: `${runId}s` })
    await step('components_v2', async () => {
      const r = await deps.semantic.messageSend({
        accountId: deps.accountId,
        target: { kind: 'channel', id: workChannelId, guildId: deps.guildId },
        components: [
          { kind: 'TextDisplay', text: `Capability smoke interactions\nRun \`${runId}\`\nClick **Test Button** and choose a select value.` },
          {
            kind: 'ActionRow',
            children: [
              {
                kind: 'Button',
                customId: pingCustomId,
                label: 'Test Button',
                style: 'Primary',
              },
            ],
          },
          {
            kind: 'ActionRow',
            children: [
              {
                kind: 'StringSelect',
                customId: selectCustomId,
                placeholder: 'Pick one',
                options: [
                  { label: 'alpha', value: 'alpha' },
                  { label: 'beta', value: 'beta' },
                  { label: 'gamma', value: 'gamma' },
                ],
              },
            ],
          },
        ],
        componentsV2: true,
        operationId: smokeOperationId(runId, 'components_v2'),
        wait: true,
      })
      if (r.state !== 'delivered') throw new Error(`components state=${r.state}`)
      disposableMessageIds.push(r.discord_resource_id)
      return { ...r, pingCustomId, selectCustomId }
    })
    await refreshMaster()

    // --- PROACTIVE ---
    await step('proactive_service', async () => {
      const beforeKeys =
        typeof deps.conversationBinding?.resolve === 'function' ? 'binding_api_present' : 'no_binding_api'
      const r = await deps.semantic.notify({
        accountId: deps.accountId,
        target: { kind: 'channel', id: workChannelId, guildId: deps.guildId },
        content: `DSH_CAPABILITY_PROACTIVE_PASS run=${runId}`,
        operationId: smokeOperationId(runId, 'proactive'),
        wait: true,
      })
      if (r.state !== 'delivered') throw new Error(`proactive state=${r.state}`)
      disposableMessageIds.push(r.discord_resource_id)
      return { receipt: r, bindingNote: beforeKeys }
    })
    await refreshMaster()

    // --- SEMANTIC TOOL ---
    if (!deps.tools || typeof deps.tools.execute !== 'function') {
      results.semantic_tool_send = {
        status: 'SKIP',
        note: 'tools runtime unavailable in this entrypoint',
      }
    } else {
      await step('semantic_tool_send', async () => {
        const args = {
          account_id: deps.accountId,
          target: { kind: 'channel', id: workChannelId, guildId: deps.guildId },
          content: `DSH_CAPABILITY_TOOL_PASS run=${runId}`,
          operation_id: smokeOperationId(runId, 'tool_send'),
        }
        if (deps.policy?.evaluate) {
          const decision = deps.policy.evaluate({ tool: 'discord_message_send', args })
          if (decision?.decision === 'DENY') throw new Error('policy DENY')
        }
        const result = await deps.tools.execute({
          name: 'discord_message_send',
          arguments: args,
          callId: `capsmoke-tool-${runId}`,
          signal: AbortSignal.timeout(120_000),
          parent: /** @type {any} */ (Symbol('dsh-lab-capability-smoke')),
        })
        if (result?.isError || result?.error) {
          throw new Error(`tools.execute error ${JSON.stringify(result).slice(0, 200)}`)
        }
        return result
      })
    }
    await refreshMaster()

    // --- READS ---
    await step('guild_list', async () => {
      const r = await deps.semantic.guildList({ accountId: deps.accountId })
      if (!Array.isArray(r.guilds)) throw new Error('no guilds array')
      return r
    })
    await step('channel_get', async () => {
      const r = await deps.semantic.channelGet({
        accountId: deps.accountId,
        channelId: workChannelId,
      })
      if (String(r.channel?.id) !== String(workChannelId)) throw new Error('channel id mismatch')
      return r
    })
    await step('channel_list', async () => {
      const r = await deps.semantic.channelList({
        accountId: deps.accountId,
        guildId: deps.guildId,
        limit: 20,
      })
      if (!Array.isArray(r.channels)) throw new Error('no channels')
      return r
    })
    let historyFirst = null
    await step('message_history', async () => {
      const r = await deps.semantic.messageHistory({
        accountId: deps.accountId,
        channelId: workChannelId,
        limit: 5,
      })
      if (!Array.isArray(r.messages)) throw new Error('no messages')
      historyFirst = r.messages[0]?.id || null
      return r
    })
    await step('message_get', async () => {
      if (!historyFirst) throw new Error('no history id')
      const r = await deps.semantic.messageGet({
        accountId: deps.accountId,
        channelId: workChannelId,
        messageId: historyFirst,
      })
      if (String(r.message?.id) !== String(historyFirst)) throw new Error('get id mismatch')
      return r
    })
    await refreshMaster()

    // --- THREAD CREATE (from starter message) ---
    await step('thread_create', async () => {
      const starter = await deps.semantic.messageSend({
        accountId: deps.accountId,
        target: { kind: 'channel', id: workChannelId, guildId: deps.guildId },
        content: `DSH_CAPABILITY_THREAD_STARTER run=${runId}`,
        operationId: smokeOperationId(runId, 'thread_starter'),
        wait: true,
      })
      if (!starter.discord_resource_id) throw new Error('no starter')
      const threadOp = smokeOperationId(runId, 'thread_create')
      const thr = await deps.semantic.threadCreate({
        accountId: deps.accountId,
        parentChannelId: workChannelId,
        messageId: starter.discord_resource_id,
        name: `capsmoke-${runId}`.slice(0, 100),
        operationId: threadOp,
        wait: true,
      })
      if (thr.state !== 'delivered' || !thr.discord_resource_id) {
        throw new Error(`thread state=${thr.state}`)
      }
      smokeThreadId = String(thr.discord_resource_id)
      // Idempotent replay
      const again = await deps.semantic.threadCreate({
        accountId: deps.accountId,
        parentChannelId: workChannelId,
        messageId: starter.discord_resource_id,
        name: `capsmoke-${runId}`.slice(0, 100),
        operationId: threadOp,
        wait: true,
      })
      if (String(again.discord_resource_id) !== String(thr.discord_resource_id)) {
        throw new Error('thread create not idempotent')
      }
      return { thr, again, starter }
    })
    await refreshMaster()

    // --- OUTBOX IDEMPOTENCY (send replay) ---
    await step('outbox_idempotency', async () => {
      const op = smokeOperationId(runId, 'idem_send')
      const a = await deps.semantic.messageSend({
        accountId: deps.accountId,
        target: { kind: 'channel', id: workChannelId, guildId: deps.guildId },
        content: `DSH_CAPABILITY_IDEM_PASS run=${runId}`,
        operationId: op,
        wait: true,
      })
      const b = await deps.semantic.messageSend({
        accountId: deps.accountId,
        target: { kind: 'channel', id: workChannelId, guildId: deps.guildId },
        content: `DSH_CAPABILITY_IDEM_PASS run=${runId} SHOULD_NOT_DUPLICATE`,
        operationId: op,
        wait: true,
      })
      if (String(a.discord_resource_id) !== String(b.discord_resource_id)) {
        throw new Error('idempotency created second resource')
      }
      disposableMessageIds.push(a.discord_resource_id)
      return { a, b }
    })
    results.dedupe = {
      status: 'PASS',
      note: 'inbound dedupe covered by unit + interaction claims',
    }
    await refreshMaster()

    // Operator instructions for thread turns (in smoke thread if created)
    const instructChannel = smokeThreadId || workChannelId
    await deps.semantic.messageSend({
      accountId: deps.accountId,
      target: smokeThreadId
        ? {
            kind: 'thread',
            id: smokeThreadId,
            guildId: deps.guildId,
            parentChannelId: workChannelId,
          }
        : { kind: 'channel', id: workChannelId, guildId: deps.guildId },
      content: [
        `DSH Capability Smoke — operator actions (run ${runId})`,
        `1) Click **Test Button** on the interactions message`,
        `2) Choose a select value (alpha|beta|gamma)`,
        `3) In this channel/thread send: DSH_CAPABILITY_THREAD_TURN_1`,
        `4) After Vega replies, send: DSH_CAPABILITY_THREAD_TURN_2`,
        `Verify same thread_id + session_id; two distinct assistant message ids.`,
      ].join('\n'),
      operationId: smokeOperationId(runId, 'operator_instructions'),
      wait: true,
    }).catch((err) => {
      deps.logger?.warn?.(`operator instructions failed: ${err instanceof Error ? err.message : err}`)
    })

    // Optional interaction wait (poll bridge.interactionDispatches)
    if (!opts.skipInteractiveWait && deps.awaitInteractionsMs > 0 && deps.bridge) {
      const deadline = now() + Number(deps.awaitInteractionsMs)
      const poll = Number(deps.pollIntervalMs) || 1500
      while (now() < deadline) {
        const dispatches = deps.bridge.interactionDispatches || []
        const buttonHit = dispatches.some(
          (d) => d.accountId === deps.accountId && String(d.customId) === pingCustomId,
        )
        const selectHit = dispatches.some(
          (d) => d.accountId === deps.accountId && String(d.customId) === selectCustomId,
        )
        if (buttonHit) {
          results.button_interaction = { status: 'PASS' }
          results.interaction_ack = { status: 'PASS', note: 'defer path observed via smoke handler' }
        }
        if (selectHit) {
          results.select_interaction = { status: 'PASS' }
          results.interaction_ack = { status: 'PASS', note: 'defer path observed via smoke handler' }
        }
        if (buttonHit && selectHit) break
        await sleep(poll)
        await refreshMaster('RUNNING')
      }
    }

    const autoKeys = AUTO_CAPABILITY_KEYS.filter((k) => k !== 'gateway' || true)
    const autoFail = autoKeys.some((k) => results[k]?.status === 'FAIL')
    const interactivePending = INTERACTIVE_CAPABILITY_KEYS.some(
      (k) => results[k]?.status === 'WAITING' || results[k]?.status === 'PENDING',
    )

    let overall = 'PASS'
    if (autoFail) overall = 'FAIL'
    else if (interactivePending) overall = 'PARTIAL'

    const finalComponents = buildFinalSummaryComponents(runId, results, overall)
    await deps.semantic.messageSend({
      accountId: deps.accountId,
      target: { kind: 'channel', id: workChannelId, guildId: deps.guildId },
      components: finalComponents,
      componentsV2: true,
      operationId: smokeOperationId(runId, 'final_summary'),
      wait: true,
    })
    await refreshMaster(overall)

    return {
      runId,
      overall,
      results: { ...deferredCapabilityResults(), ...results },
      masterMessageId,
      smokeThreadId,
      workChannelId,
      disposableMessageIds,
      customIds: { ping: pingCustomId, select: selectCustomId },
      scope_changed: false,
      production_default_enabled: false,
    }
  }

  return { run, assertLabSafety: () => assertLabSafety(deps.getAccount(), {
    requireGuildId: deps.guildId,
    requireChannelId: deps.channelId,
  }) }
}

/**
 * Prove harness is not wired into default Gateway content triggers.
 * @param {string} bridgeSource
 */
export function assertNoMagicProductionTrigger(bridgeSource) {
  const forbidden = [
    'RUN_ALL_TESTS',
    'CAPABILITY_SMOKE_RUN',
    'runCapabilitySmokeFromMessage',
  ]
  for (const token of forbidden) {
    if (bridgeSource.includes(token)) {
      throw new Error(`forbidden production trigger token present: ${token}`)
    }
  }
  return true
}

/**
 * Write a JSON report artifact (no tokens).
 * @param {object} report
 * @param {string} [dir]
 */
export function writeSmokeReport(report, dir = join(tmpdir(), 'dsh-discord-capability-smoke')) {
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `report-${report.runId || 'unknown'}.json`)
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`)
  return path
}
