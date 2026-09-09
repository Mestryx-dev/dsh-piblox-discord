/**
 * Durable Discord delivery outbox + per-account scheduler.
 *
 * Restart semantics (LOCKED for V1):
 *   operations in `sending` are recovered to `queued` with next_attempt_at = now
 *   (never strand mid-flight). Completed steps keep discord_resource_id and are skipped.
 */

import { createHash } from 'node:crypto'
import { createOutboxStore, defaultOutboxPath } from './store.js'
import { toReceipt } from './types.js'
import { classifyTransportError, computeBackoffMs, nonceFromOperationId } from '../errors.js'
import { SystemClock } from '../clock.js'

/**
 * @typedef {import('./types.js').OutboxOperation} OutboxOperation
 * @typedef {import('./types.js').OutboxGroup} OutboxGroup
 * @typedef {import('./types.js').DeliveryReceipt} DeliveryReceipt
 * @typedef {import('./types.js').OperationType} OperationType
 * @typedef {import('../transport/transport.js').DiscordTransport} DiscordTransport
 */

const DEFAULT_MAX_ATTEMPTS = 8

/**
 * @param {object} options
 * @param {DiscordTransport} options.transport
 * @param {string} [options.storePath]
 * @param {{ now(): number }} [options.clock]
 * @param {{ emit?: Function, info?: Function, warn?: Function }} [options.observability]
 * @param {{ baseMs?: number, maxMs?: number, jitterFn?: Function, maxAttempts?: number }} [options.retry]
 * @param {Set<string>|string[]} [options.isolatedAccounts]
 */
export function createDeliveryOutbox(options) {
  const transport = options.transport
  const clock = options.clock || new SystemClock()
  const store = createOutboxStore(options.storePath || defaultOutboxPath())
  const retry = {
    baseMs: options.retry?.baseMs ?? 500,
    maxMs: options.retry?.maxMs ?? 60_000,
    jitterFn: options.retry?.jitterFn || (() => 0),
    maxAttempts: options.retry?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
  }
  const observability = options.observability
  /** @type {Set<string>} */
  const isolatedAccounts = new Set(options.isolatedAccounts || [])
  /** @type {Set<string>} accounts currently mid-tick (in-process concurrency guard) */
  const busyAccounts = new Set()

  function emitObs(type, payload) {
    try {
      observability?.emit?.(type, payload)
    } catch {
      /* closed EVENT_TYPES — ignore */
    }
  }

  /**
   * Crash recovery: `sending` → `queued` at now.
   */
  async function recoverOnLoad() {
    return store.withLock((data) => {
      const now = clock.now()
      let recovered = 0
      for (const op of Object.values(data.operations)) {
        if (op.state === 'sending') {
          op.state = 'queued'
          op.next_attempt_at = now
          op.updated_at = now
          op.last_error = {
            class: 'transport_failure',
            code: 'crash_recovery',
            message: 'recovered stranded sending state after restart',
          }
          recovered += 1
        }
        if (op.state === 'accepted') {
          op.state = 'queued'
          op.next_attempt_at = Math.min(op.next_attempt_at || now, now)
          op.updated_at = now
        }
      }
      for (const group of Object.values(data.groups)) {
        if (group.state === 'accepted') {
          group.state = 'in_progress'
          group.updated_at = now
        }
      }
      return { recovered }
    })
  }

  /**
   * Enqueue a single outbound operation. Dedupes on operation_id.
   * @param {{
   *   operationId: string,
   *   accountId: string,
   *   operationType: OperationType,
   *   target: import('./types.js').OutboxTarget,
   *   payload?: import('./types.js').OutboxPayload,
   *   correlationId?: string,
   *   groupId?: string,
   *   groupStep?: number,
   *   useNonce?: boolean,
   * }} input
   * @returns {Promise<DeliveryReceipt>}
   */
  async function enqueue(input) {
    const operationId = String(input.operationId || '').trim()
    if (!operationId) throw new TypeError('outbox.enqueue: operationId required')
    if (!input.accountId) throw new TypeError('outbox.enqueue: accountId required')
    if (!input.target?.channelId && input.operationType !== 'createThread') {
      // createThread may use parentChannelId in target
      if (!input.target?.parentChannelId) {
        throw new TypeError('outbox.enqueue: target.channelId required')
      }
    }

    return store.withLock((data) => {
      const existing = data.operations[operationId]
      if (existing) {
        return toReceipt(existing)
      }
      const now = clock.now()
      const useNonce = input.useNonce !== false && input.operationType === 'sendMessage'
      /** @type {OutboxOperation} */
      const op = {
        operation_id: operationId,
        account_id: input.accountId,
        operation_type: input.operationType,
        target: { ...input.target },
        payload: sanitizePayload(input.payload || {}),
        state: 'queued',
        attempt_count: 0,
        next_attempt_at: now,
        created_at: now,
        updated_at: now,
        last_error: null,
        discord_resource_id: null,
        nonce: useNonce ? nonceFromOperationId(operationId) : null,
        enforce_nonce: useNonce,
        correlation_id: input.correlationId || null,
        group_id: input.groupId || null,
        group_step: input.groupStep ?? null,
        max_attempts: retry.maxAttempts,
      }
      // Persist accepted→queued atomically as queued (accepted is momentary).
      data.operations[operationId] = op
      emitObs('tool.called', {
        tool: 'discord.outbox.enqueue',
        operation_id: operationId,
        account_id: input.accountId,
        correlation_id: op.correlation_id,
      })
      return toReceipt(op)
    })
  }

  /**
   * Persist a multi-step group before executing step 1.
   * @param {{
   *   groupId: string,
   *   accountId: string,
   *   correlationId?: string,
   *   steps: Array<{
   *     operationId: string,
   *     operationType: OperationType,
   *     target: import('./types.js').OutboxTarget,
   *     payload?: import('./types.js').OutboxPayload,
   *     useNonce?: boolean,
   *   }>,
   * }} input
   */
  async function enqueueGroup(input) {
    const groupId = String(input.groupId || '').trim()
    if (!groupId) throw new TypeError('outbox.enqueueGroup: groupId required')
    if (!Array.isArray(input.steps) || input.steps.length === 0) {
      throw new TypeError('outbox.enqueueGroup: steps required')
    }

    return store.withLock((data) => {
      if (data.groups[groupId]) {
        return {
          group: data.groups[groupId],
          receipts: data.groups[groupId].step_operation_ids.map((id) => toReceipt(data.operations[id])),
        }
      }
      const now = clock.now()
      const stepIds = []
      let stepIndex = 0
      for (const step of input.steps) {
        const operationId = String(step.operationId || '').trim()
        if (!operationId) throw new TypeError('outbox.enqueueGroup: step.operationId required')
        if (data.operations[operationId]) {
          throw new Error(`outbox.enqueueGroup: operation already exists: ${operationId}`)
        }
        const useNonce = step.useNonce !== false && step.operationType === 'sendMessage'
        /** @type {OutboxOperation} */
        const op = {
          operation_id: operationId,
          account_id: input.accountId,
          operation_type: step.operationType,
          target: { ...step.target },
          payload: sanitizePayload(step.payload || {}),
          state: 'queued',
          attempt_count: 0,
          // Only first incomplete step is due; others wait behind group ordering.
          next_attempt_at: stepIndex === 0 ? now : Number.MAX_SAFE_INTEGER,
          created_at: now,
          updated_at: now,
          last_error: null,
          discord_resource_id: null,
          nonce: useNonce ? nonceFromOperationId(operationId) : null,
          enforce_nonce: useNonce,
          correlation_id: input.correlationId || null,
          group_id: groupId,
          group_step: stepIndex,
          max_attempts: retry.maxAttempts,
        }
        data.operations[operationId] = op
        stepIds.push(operationId)
        stepIndex += 1
      }
      /** @type {OutboxGroup} */
      const group = {
        group_id: groupId,
        account_id: input.accountId,
        state: 'in_progress',
        step_operation_ids: stepIds,
        created_at: now,
        updated_at: now,
        correlation_id: input.correlationId || null,
      }
      data.groups[groupId] = group
      return {
        group,
        receipts: stepIds.map((id) => toReceipt(data.operations[id])),
      }
    })
  }

  /** @param {string} operationId */
  function getReceipt(operationId) {
    const data = store.snapshot()
    const op = data.operations[operationId]
    return op ? toReceipt(op) : null
  }

  /** @param {string} groupId */
  function getGroup(groupId) {
    return store.snapshot().groups[groupId] || null
  }

  function listOperations(filter = {}) {
    const data = store.snapshot()
    return Object.values(data.operations).filter((op) => {
      if (filter.accountId && op.account_id !== filter.accountId) return false
      if (filter.state && op.state !== filter.state) return false
      return true
    })
  }

  /**
   * Process due operations. Per-account isolation: one account's wait never blocks others.
   * @param {{ accountId?: string, maxOps?: number }} [opts]
   */
  async function tick(opts = {}) {
    const maxOps = opts.maxOps ?? 50
    let processed = 0
    const now = clock.now()

    // Snapshot due candidates under lock, then execute outside lock (transport I/O).
    const due = await store.withLock((data) => {
      /** @type {OutboxOperation[]} */
      const candidates = []
      for (const op of Object.values(data.operations)) {
        if (opts.accountId && op.account_id !== opts.accountId) continue
        if (isolatedAccounts.has(op.account_id)) continue
        if (op.state !== 'queued' && op.state !== 'retry_wait') continue
        if (op.next_attempt_at > now) continue
        if (op.group_id) {
          const group = data.groups[op.group_id]
          if (!group || group.state === 'failed_terminal') continue
          // Only the first non-delivered step in a group may run.
          const nextStepId = group.step_operation_ids.find((id) => {
            const step = data.operations[id]
            return step && step.state !== 'delivered'
          })
          if (nextStepId !== op.operation_id) continue
        }
        candidates.push(op)
      }
      candidates.sort((a, b) => a.next_attempt_at - b.next_attempt_at || a.created_at - b.created_at)
      const selected = candidates.slice(0, maxOps)
      for (const op of selected) {
        // Claim as sending under lock.
        const live = data.operations[op.operation_id]
        live.state = 'sending'
        live.updated_at = now
        live.attempt_count += 1
      }
      return selected.map((op) => structuredClone(data.operations[op.operation_id]))
    })

    for (const claimed of due) {
      if (busyAccounts.has(claimed.account_id)) continue
      busyAccounts.add(claimed.account_id)
      try {
        await executeClaimed(claimed)
        processed += 1
      } finally {
        busyAccounts.delete(claimed.account_id)
      }
    }
    return { processed, due: due.length }
  }

  /** @param {OutboxOperation} claimed */
  async function executeClaimed(claimed) {
    try {
      const result = await dispatchToTransport(claimed)
      await store.withLock((data) => {
        const op = data.operations[claimed.operation_id]
        if (!op) return
        op.state = 'delivered'
        op.discord_resource_id = result.messageId || result.threadId || result.id || null
        if (result.channelId) op.target.channelId = result.channelId
        if (result.threadId) op.target.threadId = result.threadId
        op.last_error = null
        op.updated_at = clock.now()
        advanceGroupLocked(data, op)
        emitObs('tool.returned', {
          tool: 'discord.outbox.deliver',
          operation_id: op.operation_id,
          account_id: op.account_id,
          discord_resource_id: op.discord_resource_id,
          correlation_id: op.correlation_id,
          attempts: op.attempt_count,
        })
      })
    } catch (err) {
      const classified = classifyTransportError(err)
      await store.withLock((data) => {
        const op = data.operations[claimed.operation_id]
        if (!op) return
        const now = clock.now()
        op.last_error = {
          class: classified.class,
          code: classified.code,
          message: classified.message,
          retryAfterMs: classified.retryAfterMs,
        }
        op.updated_at = now

        if (classified.isolateAccount) {
          isolatedAccounts.add(op.account_id)
        }

        const exhausted = op.attempt_count >= op.max_attempts
        const terminal = classified.retry === 'terminal' || exhausted

        if (terminal) {
          op.state = 'failed_terminal'
          if (op.group_id && data.groups[op.group_id]) {
            data.groups[op.group_id].state = 'failed_terminal'
            data.groups[op.group_id].updated_at = now
          }
          emitObs('tool.failed', {
            tool: 'discord.outbox.deliver',
            operation_id: op.operation_id,
            account_id: op.account_id,
            error_class: classified.class,
            code: classified.code,
            correlation_id: op.correlation_id,
            attempts: op.attempt_count,
          })
          return
        }

        // retryable or ambiguous timeout → retry_wait
        const delay =
          classified.retryAfterMs != null
            ? classified.retryAfterMs
            : computeBackoffMs(op.attempt_count, retry)
        op.state = 'retry_wait'
        op.next_attempt_at = now + delay
        emitObs('tool.failed', {
          tool: 'discord.outbox.retry',
          operation_id: op.operation_id,
          account_id: op.account_id,
          error_class: classified.class,
          code: classified.code,
          next_attempt_at: op.next_attempt_at,
          correlation_id: op.correlation_id,
          attempts: op.attempt_count,
        })
      })
    }
  }

  /** @param {OutboxOperation} op */
  async function dispatchToTransport(op) {
    const payload = {
      content: op.payload.content,
      components: op.payload.components,
      replyTo: op.payload.replyTo || op.target.messageId,
      nonce: op.nonce || undefined,
      enforceNonce: op.enforce_nonce || undefined,
      raw: op.payload.raw,
    }

    switch (op.operation_type) {
      case 'sendMessage':
        return transport.sendMessage(op.account_id, op.target.channelId, payload)
      case 'replyMessage':
        return transport.replyMessage(
          op.account_id,
          op.target.channelId,
          op.target.messageId || op.payload.replyTo,
          payload,
        )
      case 'editMessage':
        return transport.editMessage(op.account_id, op.target.channelId, op.target.messageId, payload)
      case 'createThread': {
        if (typeof transport.createThread !== 'function') {
          // FakeTransport implements createThread; live skeleton may not yet.
          throw Object.assign(new Error('createThread not supported by transport'), {
            code: 'invalid_payload',
          })
        }
        return transport.createThread(op.account_id, op.target.parentChannelId || op.target.channelId, {
          name: op.payload.threadName || 'thread',
          messageId: op.target.messageId,
        })
      }
      default: {
        const _exhaustive = op.operation_type
        throw Object.assign(new Error(`unknown operation_type: ${_exhaustive}`), {
          code: 'invalid_payload',
        })
      }
    }
  }

  /**
   * @param {import('./store.js').OutboxStoreData} data
   * @param {OutboxOperation} op
   */
  function advanceGroupLocked(data, op) {
    if (!op.group_id) return
    const group = data.groups[op.group_id]
    if (!group) return
    const now = clock.now()
    group.updated_at = now
    const nextId = group.step_operation_ids.find((id) => {
      const step = data.operations[id]
      return step && step.state !== 'delivered'
    })
    if (!nextId) {
      group.state = 'delivered'
      return
    }
    const next = data.operations[nextId]
    if (next && (next.state === 'queued' || next.state === 'retry_wait')) {
      next.next_attempt_at = now
      next.updated_at = now
      if (next.state === 'retry_wait') next.state = 'queued'
    }
  }

  function isolateAccount(accountId) {
    isolatedAccounts.add(accountId)
  }

  function clearAccountIsolation(accountId) {
    isolatedAccounts.delete(accountId)
  }

  function isAccountIsolated(accountId) {
    return isolatedAccounts.has(accountId)
  }

  return {
    storePath: store.storePath,
    recoverOnLoad,
    enqueue,
    enqueueGroup,
    tick,
    getReceipt,
    getGroup,
    listOperations,
    isolateAccount,
    clearAccountIsolation,
    isAccountIsolated,
    snapshot: () => store.snapshot(),
  }
}

/** @param {import('./types.js').OutboxPayload} payload */
function sanitizePayload(payload) {
  const content = payload.content
  const preview =
    payload.contentPreview ||
    (typeof content === 'string' ? content.slice(0, 120) : undefined)
  return {
    content,
    contentPreview: preview,
    replyTo: payload.replyTo,
    components: payload.components,
    threadName: payload.threadName,
    raw: payload.raw ? { ...payload.raw } : undefined,
  }
}

/**
 * Content fingerprint for nonce reconciliation helpers.
 * @param {string} [content]
 */
export function contentHash(content) {
  return createHash('sha256').update(String(content || '')).digest('hex').slice(0, 16)
}
