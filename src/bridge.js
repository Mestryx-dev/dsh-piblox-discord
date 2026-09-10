/**
 * DSH session bridge — ConversationBinding + agents + DeliveryOutbox + inbound dedupe.
 *
 * Outbound path (LOCKED):
 *   assistant/chunk|message → coalesce → outbox.enqueue → outbox.tick → transport
 *
 * Inbound path (LOCKED):
 *   normalize → authorize → dedupe claim → binding/session → followup → complete
 */

import { randomUUID } from 'node:crypto'
import { buildBindingIdentity, toExternalIdentity } from './binding.js'
import { authorizeInbound } from './config.js'
import { buildFollowupMessage } from './message-source.js'
import { inboundEventKey } from './inbound-dedupe.js'

/**
 * Extract assistant text from a session/event payload (best-effort).
 * @param {any} event
 */
export function extractAssistantText(event) {
  if (!event || typeof event !== 'object') return ''
  if (event.type === 'assistant/chunk') {
    const chunk = event.data?.chunk
    if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') return chunk.text
    if (typeof chunk?.text === 'string') return chunk.text
    if (typeof event.data?.text === 'string') return event.data.text
    return ''
  }
  if (event.type === 'assistant/message') {
    const content = event.data?.message?.content
    if (Array.isArray(content)) {
      return content.map((b) => (b?.type === 'text' ? b.text : '')).join('')
    }
    if (typeof event.data?.message?.content === 'string') return event.data.message.content
  }
  return ''
}

/**
 * Mint a session id string (discord-prefixed UUID).
 * Real DSH brands SessionId at the agents boundary; we return a plain string
 * matching ConversationBinding's session_id field.
 */
export function mintDiscordSessionId() {
  return `discord-${randomUUID()}`
}

/**
 * @typedef {{
 *   conversationBinding: {
 *     resolveOrCreate: Function,
 *     unbind: Function,
 *     resolve?: Function,
 *   },
 *   agents: {
 *     create: Function,
 *     get: Function,
 *     resume: Function,
 *   },
 *   transport: import('./transport/transport.js').DiscordTransport,
 *   outbox: ReturnType<import('./outbox/index.js').createDeliveryOutbox>,
 *   inboundDedupe?: ReturnType<import('./inbound-dedupe.js').createInboundDedupe>,
 *   accounts: Record<string, import('./config.js').AccountConfig>,
 *   observability?: { mint?: Function, bind?: Function, emit?: Function },
 *   createUserMessage?: Function,
 *   agentPresets?: {
 *     resolve(id: string): Promise<any>,
 *     mount(agentCtx: any, id: string): Promise<any>,
 *     standingKeyFor?(id: string): Promise<any>,
 *     remoteExportList?(): Promise<any>,
 *     list?(): Promise<any>,
 *   },
 *   agentDefaultModel?: { currentSelection?: () => { provider?: string, model?: string, reasoningEffort?: unknown } },
 *   sessionCwd?: string,
 *   dispatchTimeoutMs?: number,
 *   onSessionEvent?: (sessionId: string, listener: Function) => () => void,
 *   onInteractionIntent?: (event: any) => void | Promise<void>,
 *   logger?: { info?: Function, warn?: Function, debug?: Function },
 * }} BridgeOptions
 */

/** Default bound for create/resume/followup admission (not full AgentLoop turn). */
export const DEFAULT_DISPATCH_TIMEOUT_MS = 60_000

/**
 * Resolve the live Agent face for followup.
 *
 * Real DSH (`@deepseek-ai/dsh-agent` 0.1.2-rc.1):
 *   - `agents.create` / `resume` → {@link AgentHandle} `{ agent, dispose }`
 *   - `agents.get(id)` → bare {@link Agent} (has `.followup`), NOT a handle
 *
 * DSH-INTEGRATION recipe: `agent = agents.get(id) ?? (await resume(...)).agent`
 * then `agent.followup(...)`.
 *
 * @param {any} ownedHandle
 * @param {any} fromGet
 * @returns {{ handle: any | null, agent: any | null }}
 */
export function resolveAgentFace(ownedHandle, fromGet) {
  if (ownedHandle?.agent && typeof ownedHandle.agent.followup === 'function') {
    return { handle: ownedHandle, agent: ownedHandle.agent }
  }
  if (fromGet && typeof fromGet.followup === 'function') {
    return { handle: null, agent: fromGet }
  }
  // Defensive: some test facades historically returned Handle from get()
  if (fromGet?.agent && typeof fromGet.agent.followup === 'function') {
    return { handle: fromGet, agent: fromGet.agent }
  }
  return { handle: null, agent: null }
}

/**
 * Install creation-time model selection until the first durable request header exists.
 * Mirrors webhook `installInitialModelSelection` (orthogonal to agentPreset).
 * @param {any} agentCtx
 * @param {{ provider: string, model: string, reasoningEffort?: unknown }} selection
 */
function installInitialModelSelection(agentCtx, selection) {
  if (typeof agentCtx?.on !== 'function') return
  agentCtx.on('agent/request', async (_payload, next) => {
    const resolved = await next()
    const agent = agentCtx.agent
    if (!agent) return resolved
    if (
      agent.session?.requestHeader?.() !== undefined ||
      resolved.provider !== selection.provider ||
      resolved.model !== selection.model
    ) {
      return resolved
    }
    const { reasoningEffort: _drop, ...rest } = resolved
    return {
      ...rest,
      ...(selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort }),
    }
  })
}

/**
 * Resolve CreateAgentOptions for a **new** Discord session (webhook-parity).
 *
 * Canonical DSH concept: **agent preset** (`ctx.agentPresets`, `meta.agentPreset`).
 * Fail-closed: no silent default / blank agent when assignment is missing or invalid.
 *
 * `sessionCwd` → `meta.cwd` (workspace; not part of the preset composition).
 * `agentDefaultModel` → `agentOptions` + setup hook (LLM route; orthogonal to preset).
 *
 * @param {{
 *   account?: { agentPreset?: string },
 *   sessionCwd?: string,
 *   agentPresets?: BridgeOptions['agentPresets'],
 *   agentDefaultModel?: BridgeOptions['agentDefaultModel'],
 * }} opts
 * @returns {Promise<{
 *   ok: true,
 *   presetId: string,
 *   createOptions: { meta: { cwd: string, agentPreset: string }, agentOptions?: object, setup: Function },
 * } | { ok: false, reason: string, message?: string }>}
 */
export async function prepareDiscordSessionCreate(opts = {}) {
  const presetIdRaw = opts.account?.agentPreset
  const presetId = presetIdRaw != null ? String(presetIdRaw).trim() : ''
  if (!presetId) {
    return { ok: false, reason: 'agent_preset_required' }
  }

  const agentPresets = opts.agentPresets
  if (
    !agentPresets ||
    typeof agentPresets.resolve !== 'function' ||
    typeof agentPresets.mount !== 'function'
  ) {
    return { ok: false, reason: 'agent_presets_unavailable' }
  }

  let preset
  try {
    preset = await agentPresets.resolve(presetId)
  } catch (err) {
    return {
      ok: false,
      reason: 'agent_preset_invalid',
      message: err instanceof Error ? err.message : String(err),
    }
  }
  if (!preset || preset.broken) {
    return {
      ok: false,
      reason: 'agent_preset_invalid',
      message: preset?.broken ? String(preset.broken) : 'preset resolve returned empty',
    }
  }
  const id = String(preset.id || presetId)
  if (typeof agentPresets.standingKeyFor === 'function') {
    try {
      await agentPresets.standingKeyFor(id)
    } catch (err) {
      return {
        ok: false,
        reason: 'agent_preset_invalid',
        message: err instanceof Error ? err.message : String(err),
      }
    }
  }

  const cwd = opts.sessionCwd && String(opts.sessionCwd).trim()
  if (!cwd) {
    return { ok: false, reason: 'session_cwd_required' }
  }

  /** @type {{ provider: string, model: string, reasoningEffort?: unknown } | null} */
  let modelSelection = null
  /** @type {{ provider: string, model: string } | undefined} */
  let agentOptions
  const selection =
    typeof opts.agentDefaultModel?.currentSelection === 'function'
      ? opts.agentDefaultModel.currentSelection()
      : null
  if (selection?.provider && selection?.model) {
    modelSelection = { ...selection }
    agentOptions = { provider: String(selection.provider), model: String(selection.model) }
  }

  return {
    ok: true,
    presetId: id,
    createOptions: {
      meta: { cwd, agentPreset: id },
      ...(agentOptions ? { agentOptions } : {}),
      setup: async (agentCtx) => {
        await agentPresets.mount(agentCtx, id)
        if (modelSelection) installInitialModelSelection(agentCtx, modelSelection)
      },
    },
  }
}

/**
 * Build cwd + default-model extras only (no agentPreset). Prefer {@link prepareDiscordSessionCreate}.
 * @param {{
 *   sessionCwd?: string,
 *   agentDefaultModel?: { currentSelection?: () => { provider?: string, model?: string, reasoningEffort?: unknown } },
 * }} opts
 */
export function buildDiscordCreateAgentExtras(opts = {}) {
  /** @type {{ meta?: { cwd?: string }, agentOptions?: { provider: string, model: string }, setup?: Function }} */
  const extras = {}
  const cwd = opts.sessionCwd && String(opts.sessionCwd).trim()
  if (cwd) {
    extras.meta = { cwd }
  }
  const selection =
    typeof opts.agentDefaultModel?.currentSelection === 'function'
      ? opts.agentDefaultModel.currentSelection()
      : null
  if (selection?.provider && selection?.model) {
    extras.agentOptions = { provider: String(selection.provider), model: String(selection.model) }
    const locked = { ...selection }
    extras.setup = async (agentCtx) => {
      installInitialModelSelection(agentCtx, locked)
    }
  }
  return extras
}

export class DiscordSessionBridge {
  /** @param {BridgeOptions} options */
  constructor(options) {
    this.conversationBinding = options.conversationBinding
    this.agents = options.agents
    this.transport = options.transport
    this.outbox = options.outbox
    this.inboundDedupe = options.inboundDedupe || null
    this.accounts = options.accounts
    this.observability = options.observability
    this.createUserMessage = options.createUserMessage
    this.agentPresets = options.agentPresets || null
    this.agentDefaultModel = options.agentDefaultModel || null
    this.sessionCwd = options.sessionCwd || null
    this.dispatchTimeoutMs =
      options.dispatchTimeoutMs != null ? Number(options.dispatchTimeoutMs) : DEFAULT_DISPATCH_TIMEOUT_MS
    this.onSessionEvent = options.onSessionEvent
    this.onInteractionIntent = options.onInteractionIntent
    this.logger = options.logger
    /** @type {Map<string, any>} session_id → AgentHandle (owner-only; get() returns bare Agent) */
    this.handles = new Map()
    /**
     * Delivery/render target only (NOT a ConversationBinding).
     * @type {Map<string, { accountId: string, channelId: string, replyTo?: string, correlationId?: string }>}
     */
    this.deliveryTargets = new Map()
    /**
     * Per-session stream shell holding **turn-scoped** mutable delivery state.
     * `sentId` is never session-global: cleared on turn/end (and turn/start).
     * ConversationBinding session reuse ≠ Discord message reuse.
     * @type {Map<string, {
     *   buffer: string,
     *   sentId?: string,
     *   dirty: boolean,
     *   flushSeq: number,
     *   lastReceipt?: any,
     *   turnKey?: string,
     *   turnOpen: boolean,
     *   localTurnSeq: number,
     *   flushChain?: Promise<void>,
     * }>}
     */
    this.streams = new Map()
    /** @type {Array<{ accountId: string, interactionId: string }>} */
    this.interactionDispatches = []
    this._unsubInbound = null
  }

  start() {
    if (!this.outbox) {
      throw new Error('DiscordSessionBridge: DeliveryOutbox required (no direct transport bypass)')
    }
    this._unsubInbound = this.transport.onInbound((event) => this.handleInbound(event))
  }

  stop() {
    if (this._unsubInbound) this._unsubInbound()
    this._unsubInbound = null
  }

  /**
   * @param {import('./types.js').PlatformEvent & { interactionId?: string }} event
   */
  async handleInbound(event) {
    if (event.type === 'discord.interaction' || event.interactionId) {
      return this._handleInteraction(event)
    }

    if (event.type !== 'discord.message.created') {
      this.logger?.debug?.(`ignore event type ${event.type}`)
      return { ok: false, reason: 'unsupported_event' }
    }

    const account = this.accounts[event.accountId]
    if (!account) {
      // eslint-disable-next-line no-console
      console.warn(`discord bridge: unknown_account id=${event.accountId}`)
      return { ok: false, reason: 'unknown_account' }
    }
    if (!this.transport.isAccountRunning(event.accountId)) {
      // eslint-disable-next-line no-console
      console.warn(`discord bridge: account_stopped id=${event.accountId}`)
      return { ok: false, reason: 'account_stopped' }
    }
    if (typeof event.content !== 'string') {
      // eslint-disable-next-line no-console
      console.warn(`discord bridge: malformed_event id=${event.accountId} msg=${event.messageId || ''}`)
      return { ok: false, reason: 'malformed_event' }
    }

    // authorize before bot / claim (denied events never enter durable dedupe)
    // Order: account → guild → channel → guild user (see authorizeInbound)
    const auth = authorizeInbound(account, event)
    if (!auth.ok) {
      // eslint-disable-next-line no-console
      console.warn(
        `discord bridge: authorize deny account=${event.accountId} reason=${auth.reason} guild=${event.guildId || ''} channel=${event.channelId || ''} user=${event.userId || ''} isDm=${Boolean(event.isDm)} msg=${event.messageId || ''}`,
      )
      return { ok: false, reason: auth.reason }
    }

    if (account.ignoreBots !== false && event.isBot) {
      return { ok: false, reason: 'ignored_bot' }
    }

    // Existing binding → resume without requiring current account agentPreset.
    // New binding / remint create → fail-closed on missing/invalid agentPreset.
    const identity = buildBindingIdentity(event.accountId, event)
    const external = toExternalIdentity(identity)
    const existingBinding =
      typeof this.conversationBinding.resolve === 'function'
        ? this.conversationBinding.resolve(external)
        : null
    if (!existingBinding) {
      const prep = await prepareDiscordSessionCreate({
        account,
        sessionCwd: this.sessionCwd || undefined,
        agentPresets: this.agentPresets || undefined,
        agentDefaultModel: this.agentDefaultModel || undefined,
      })
      if (!prep.ok) {
        // eslint-disable-next-line no-console
        console.warn(
          `discord bridge: session_create refused account=${event.accountId} reason=${prep.reason}${prep.message ? ` (${prep.message})` : ''} msg=${event.messageId || ''} preset=${account.agentPreset || ''}`,
        )
        this.logger?.warn?.(
          `discord inbound refused account=${event.accountId} reason=${prep.reason}${prep.message ? ` (${prep.message})` : ''}`,
        )
        return { ok: false, reason: prep.reason, message: prep.message }
      }
      // eslint-disable-next-line no-console
      console.warn(
        `discord bridge: session_create armed account=${event.accountId} preset=${prep.presetId} msg=${event.messageId || ''}`,
      )
    }

    const { eventId, eventType } = inboundEventKey(event)
    if (this.inboundDedupe) {
      const claimed = await this.inboundDedupe.claim({
        accountId: event.accountId,
        eventId,
        eventType,
      })
      if (!claimed.ok) {
        return { ok: false, reason: 'duplicate', claim: claimed.claim }
      }
    }

    try {
      const result = await this._withDispatchTimeout(() => this._dispatchMessageTurn(event, { external }))
      if (this.inboundDedupe && result.ok) {
        await this.inboundDedupe.markDispatched(event.accountId, eventId, {
          sessionId: result.sessionId,
        })
        await this.inboundDedupe.markCompleted(event.accountId, eventId)
      }
      // agent_unavailable / other soft failures: leave claim as `claimed` for lease reclaim
      return result
    } catch (err) {
      // Leave claim in `claimed` with lease — reclaim after lease_until (at-least-once).
      this.logger?.warn?.(`inbound dispatch failed: ${err?.message || err}`)
      throw err
    }
  }

  /**
   * Bound create/resume/followup *admission* so a hung registry call cannot wedge
   * an account forever. Does not wait for AgentLoop turn completion (followup is sync void).
   * @template T
   * @param {() => Promise<T>} fn
   * @returns {Promise<T>}
   */
  _withDispatchTimeout(fn) {
    const ms = this.dispatchTimeoutMs
    if (!ms || ms <= 0 || !Number.isFinite(ms)) return fn()
    let timer
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const err = new Error(`discord inbound dispatch timeout after ${ms}ms`)
        err.code = 'dispatch_timeout'
        reject(err)
      }, ms)
    })
    return Promise.race([fn(), timeout]).finally(() => {
      if (timer) clearTimeout(timer)
    })
  }

  /**
   * @param {string} sessionId
   * @returns {{ handle: any | null, agent: any | null }}
   */
  _resolveAgentFace(sessionId) {
    return resolveAgentFace(this.handles.get(String(sessionId)) || null, this.agents.get?.(sessionId) || null)
  }

  /**
   * True when plugin requires sessionCwd but the live Agent session has none
   * (legacy `_no-cwd` Discord mint → `{{cwd}}` prompt assembly failure).
   * @param {any} agent
   */
  _agentLacksRequiredCwd(agent) {
    if (!this.sessionCwd) return false
    const cwd = agent?.session?.header?.cwd
    return cwd == null || String(cwd).trim() === ''
  }

  /**
   * Interaction intent path — same durable dedupe, no approval semantics.
   * @param {any} event
   */
  async _handleInteraction(event) {
    const accountId = event.accountId
    const account = this.accounts[accountId]
    if (!account) return { ok: false, reason: 'unknown_account' }
    if (!this.transport.isAccountRunning(accountId)) {
      return { ok: false, reason: 'account_stopped' }
    }

    const interactionId = String(event.interactionId || event.eventId || '')
    if (!interactionId) return { ok: false, reason: 'malformed_event' }

    if (this.inboundDedupe) {
      const claimed = await this.inboundDedupe.claim({
        accountId,
        eventId: interactionId,
        eventType: 'discord.interaction',
      })
      if (!claimed.ok) {
        return { ok: false, reason: 'duplicate', claim: claimed.claim }
      }
    }

    try {
      this.interactionDispatches.push({ accountId, interactionId })
      if (typeof this.onInteractionIntent === 'function') {
        await this.onInteractionIntent(event)
      }
      if (this.inboundDedupe) {
        await this.inboundDedupe.markDispatched(accountId, interactionId)
        await this.inboundDedupe.markCompleted(accountId, interactionId)
      }
      return { ok: true, interactionId, dispatched: true }
    } catch (err) {
      this.logger?.warn?.(`interaction dispatch failed: ${err?.message || err}`)
      throw err
    }
  }

  /**
   * @param {import('./types.js').PlatformEvent} event
   * @param {{ external?: { provider: string, scope: string, external_id: string } }} [ctx]
   */
  async _dispatchMessageTurn(event, ctx = {}) {
    const identity = buildBindingIdentity(event.accountId, event)
    const external = ctx.external || toExternalIdentity(identity)
    const account = this.accounts[event.accountId]

    let correlationId = event.correlationId
    if (this.observability?.mint) {
      try {
        const minted = this.observability.mint()
        correlationId = minted?.correlation_id || minted?.id || correlationId
        if (correlationId && this.observability.bind) {
          this.observability.bind(correlationId, { provider: 'discord', account_id: event.accountId })
        }
      } catch {
        /* optional */
      }
    }

    const createSessionId = async () => {
      const prep = await prepareDiscordSessionCreate({
        account,
        sessionCwd: this.sessionCwd || undefined,
        agentPresets: this.agentPresets || undefined,
        agentDefaultModel: this.agentDefaultModel || undefined,
      })
      if (!prep.ok) {
        const err = new Error(prep.message || prep.reason)
        err.code = prep.reason
        throw err
      }
      const sessionId = mintDiscordSessionId()
      const handle = await this.agents.create({
        sessionId,
        meta: prep.createOptions.meta,
        ...(prep.createOptions.agentOptions ? { agentOptions: prep.createOptions.agentOptions } : {}),
        setup: prep.createOptions.setup,
      })
      this.handles.set(String(sessionId), handle)
      this._attachOutput(String(sessionId), event)
      return String(sessionId)
    }

    let { binding, created } = await this.conversationBinding.resolveOrCreate(external, {
      createSessionId,
    })

    let sessionId = binding.session_id
    let { handle, agent } = this._resolveAgentFace(sessionId)

    if (!agent) {
      this.handles.delete(sessionId)
      try {
        const resumeOpts = {
          resumeSessionId: sessionId,
          ...(extras.agentOptions ? { agentOptions: extras.agentOptions } : {}),
          ...(extras.setup ? { setup: extras.setup } : {}),
        }
        handle = await this.agents.resume(resumeOpts)
        this.handles.set(sessionId, handle)
        agent = handle?.agent || null
        this._attachOutput(sessionId, event)
      } catch (err) {
        this.logger?.warn?.(`session missing for ${sessionId}, rebinding: ${err?.message || err}`)
        await this.conversationBinding.unbind(external)
        const reminted = await this.conversationBinding.resolveOrCreate(external, { createSessionId })
        binding = reminted.binding
        created = reminted.created
        sessionId = binding.session_id
        ;({ handle, agent } = this._resolveAgentFace(sessionId))
      }
    } else {
      if (handle) this.handles.set(sessionId, handle)
      this._attachOutput(sessionId, event)
    }

    // Legacy Discord sessions minted without meta.cwd land in `_no-cwd` and fail prompt
    // assembly (`{{cwd}}` unset). When sessionCwd is configured, remint with cwd.
    if (agent && this._agentLacksRequiredCwd(agent)) {
      this.logger?.warn?.(
        `discord bridge: reminting session=${sessionId} — missing session.header.cwd (sessionCwd required)`,
      )
      this.handles.delete(sessionId)
      try {
        if (handle && typeof handle.dispose === 'function') await handle.dispose()
      } catch (err) {
        this.logger?.warn?.(`discord bridge: dispose stale session failed: ${err?.message || err}`)
      }
      await this.conversationBinding.unbind(external)
      const reminted = await this.conversationBinding.resolveOrCreate(external, { createSessionId })
      binding = reminted.binding
      created = reminted.created
      sessionId = binding.session_id
      ;({ handle, agent } = this._resolveAgentFace(sessionId))
      this._attachOutput(sessionId, event)
    }

    if (!agent || typeof agent.followup !== 'function') {
      this.logger?.warn?.(
        `discord bridge: agent_unavailable session=${sessionId} (agents.get returns Agent; create/resume returns Handle)`,
      )
      return { ok: false, reason: 'agent_unavailable', sessionId }
    }

    this.deliveryTargets.set(sessionId, {
      accountId: event.accountId,
      channelId: event.channelId,
      replyTo: event.messageId,
      correlationId,
    })

    if (this.observability?.emit) {
      try {
        this.observability.emit('request.received', {
          correlation_id: correlationId,
          provider: 'discord',
          account_id: event.accountId,
          session_id: sessionId,
          event_id: event.eventId,
          created,
        })
      } catch {
        /* closed EVENT_TYPES — ignore */
      }
    }

    const message = buildFollowupMessage(this.createUserMessage, event.content, {
      accountId: event.accountId,
      channelId: event.channelId,
      messageId: event.messageId,
    })
    // Real DSH followup is sync void (inbox splice + wake). Do not await turn completion.
    const followupResult = agent.followup(message)
    if (followupResult != null && typeof followupResult.then === 'function') {
      // Deterministic test agents may return a Promise that emits session/events.
      await followupResult
    }

    return { ok: true, sessionId, created, identity, correlationId }
  }

  /**
   * Open a new turn-scoped delivery window. Clears mutable `sentId` so the next
   * flush creates a new Discord message (session reuse ≠ message reuse).
   * @param {any} stream
   * @param {string | number | null | undefined} turnId from DSH event `data.turn` when present
   */
  _beginTurn(stream, turnId) {
    const fromEvent = turnId != null && String(turnId).trim() !== '' ? String(turnId) : null
    stream.localTurnSeq = fromEvent
      ? Number(fromEvent) || stream.localTurnSeq + 1
      : stream.localTurnSeq + 1
    stream.turnKey = fromEvent || String(stream.localTurnSeq)
    stream.turnOpen = true
    stream.buffer = ''
    stream.dirty = false
    stream.sentId = undefined
    stream.lastReceipt = undefined
  }

  /**
   * Close turn delivery window. Clears mutable sentId/buffer; durable outbox keeps receipts.
   * @param {any} stream
   */
  _finalizeTurn(stream) {
    stream.buffer = ''
    stream.dirty = false
    stream.sentId = undefined
    stream.turnOpen = false
  }

  /**
   * Ensure a turn window is open before buffering assistant output.
   * @param {any} stream
   * @param {any} sessionEvent
   */
  _ensureTurnOpen(stream, sessionEvent) {
    const turnId = sessionEvent?.data?.turn ?? sessionEvent?.turn
    if (!stream.turnOpen) {
      this._beginTurn(stream, turnId)
      return
    }
    if (turnId != null && String(turnId) !== String(stream.turnKey)) {
      // New DSH turn id while previous window still open (missed turn/end) — rotate.
      this._finalizeTurn(stream)
      this._beginTurn(stream, turnId)
    }
  }

  /**
   * Coalesce accumulated stream buffer into a single outbox send or edit.
   * Deterministic tests may call this explicitly; assistant/message and turn/end also flush.
   *
   * Within one DSH turn: first flush → send/reply; later dirty flushes → edit that turn's message.
   * Next DSH turn: `sentId` cleared → new send (never edit the previous turn's final message).
   *
   * Cordis `session/event` does not await async listeners, so assistant/message and turn/end
   * can enter flush concurrently. Serialize per session and claim `dirty` before any await.
   *
   * @param {string} sessionId
   * @param {{ final?: boolean }} [opts]
   */
  async flushOutbound(sessionId, opts = {}) {
    const sid = String(sessionId)
    const stream = this.streams.get(sid)
    const target = this.deliveryTargets.get(sid)
    if (!stream || !target) return null
    if (!this.outbox) throw new Error('outbox required')

    const run = async () => {
      // Re-check after lock: concurrent turn/end must no-op once assistant/message claimed dirty.
      if (!stream.dirty) return stream.lastReceipt || null
      const text = stream.buffer
      if (!text && !stream.sentId) {
        stream.dirty = false
        return stream.lastReceipt || null
      }
      // Empty text with an existing turn message: skip blank edit (tool-only / empty final).
      if (!text && stream.sentId) {
        stream.dirty = false
        return stream.lastReceipt || null
      }

      // Claim synchronously before any await (prevents parallel send:1 + send:2).
      stream.dirty = false
      stream.flushSeq += 1
      const turnPart = stream.turnKey ? `t${stream.turnKey}:` : ''

      /** @type {import('./outbox/types.js').DeliveryReceipt | null} */
      let receipt = null

      if (!stream.sentId) {
        const operationId = `stream:${sid}:${turnPart}send:${stream.flushSeq}`
        const operationType = target.replyTo ? 'replyMessage' : 'sendMessage'
        receipt = await this.outbox.enqueue({
          operationId,
          accountId: target.accountId,
          operationType,
          target: {
            channelId: target.channelId,
            messageId: target.replyTo,
          },
          payload: {
            content: text,
            replyTo: target.replyTo,
          },
          correlationId: target.correlationId,
          useNonce: operationType === 'sendMessage',
        })
        receipt = await this._driveOperation(operationId, target.accountId)
        if (receipt?.state === 'delivered' && receipt.discord_resource_id) {
          stream.sentId = receipt.discord_resource_id
        }
      } else {
        const operationId = `stream:${sid}:${turnPart}edit:${stream.flushSeq}`
        receipt = await this.outbox.enqueue({
          operationId,
          accountId: target.accountId,
          operationType: 'editMessage',
          target: {
            channelId: target.channelId,
            messageId: stream.sentId,
          },
          payload: { content: text },
          correlationId: target.correlationId,
          useNonce: false,
        })
        receipt = await this._driveOperation(operationId, target.accountId)
      }

      stream.lastReceipt = receipt
      return receipt
    }

    const queued = (stream.flushChain || Promise.resolve()).then(run, run)
    stream.flushChain = queued.then(
      () => undefined,
      () => undefined,
    )
    return queued
  }

  /**
   * Drive one operation until delivered, retry_wait, or failed_terminal.
   * Does not fail the DSH turn on transport retry_wait.
   * @param {string} operationId
   * @param {string} accountId
   */
  async _driveOperation(operationId, accountId) {
    for (let i = 0; i < 8; i++) {
      const receipt = this.outbox.getReceipt(operationId)
      if (!receipt) return null
      if (receipt.state === 'delivered' || receipt.state === 'failed_terminal' || receipt.state === 'retry_wait') {
        return receipt
      }
      await this.outbox.tick({ accountId })
    }
    return this.outbox.getReceipt(operationId)
  }

  /**
   * @param {string} sessionId
   * @param {import('./types.js').PlatformEvent} event
   */
  _attachOutput(sessionId, event) {
    if (this.streams.has(sessionId)) return
    this.streams.set(sessionId, {
      buffer: '',
      sentId: undefined,
      dirty: false,
      flushSeq: 0,
      lastReceipt: undefined,
      turnKey: undefined,
      turnOpen: false,
      localTurnSeq: 0,
      /** @type {Promise<void> | undefined} */
      flushChain: undefined,
    })

    const listener = async (_session, sessionEvent) => {
      const sid = String(sessionId)
      const stream = this.streams.get(sid)
      if (!stream) return

      if (sessionEvent?.type === 'turn/start') {
        this._finalizeTurn(stream)
        this._beginTurn(stream, sessionEvent?.data?.turn ?? sessionEvent?.turn)
        return
      }

      if (sessionEvent?.type === 'assistant/chunk') {
        this._ensureTurnOpen(stream, sessionEvent)
        const delta = extractAssistantText(sessionEvent)
        if (!delta) return
        stream.buffer += delta
        stream.dirty = true
        // Coalesce: do not enqueue per token. Flush on message / turn/end / explicit flushOutbound.
        return
      }

      if (sessionEvent?.type === 'assistant/message') {
        this._ensureTurnOpen(stream, sessionEvent)
        const text = extractAssistantText(sessionEvent) || stream.buffer
        if (!text) {
          // Empty assistant message (tool-only): do not create a blank Discord message.
          stream.dirty = false
          return
        }
        stream.buffer = text
        stream.dirty = true
        try {
          await this.flushOutbound(sid, { final: true })
        } catch (err) {
          this.logger?.warn?.(`outbound flush failed: ${err?.message || err}`)
        }
        return
      }

      if (sessionEvent?.type === 'turn/end') {
        if (stream.dirty) {
          try {
            await this.flushOutbound(sid, { final: true })
          } catch (err) {
            this.logger?.warn?.(`outbound end flush failed: ${err?.message || err}`)
          }
        }
        // Drop mutable delivery identity so the next turn cannot edit this turn's message.
        this._finalizeTurn(stream)
        return
      }

      if (sessionEvent?.type === 'error/failure') {
        this._finalizeTurn(stream)
      }
    }

    if (typeof this.onSessionEvent === 'function') {
      this.onSessionEvent(sessionId, listener)
    } else {
      // Test agents without Cordis session bus.
      const handle = this.handles.get(sessionId)
      if (handle?.agent && typeof handle.agent.__emitSessionEvent === 'function') {
        handle.agent.__onSessionEvent = listener
      }
    }

    void event
  }
}
