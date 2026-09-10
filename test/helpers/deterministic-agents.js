/**
 * Deterministic agents facade for spike CI.
 * Mirrors OBSERVED AgentRegistry surface (dsh-agent 0.1.2-rc.1):
 *   - create / resume → AgentHandle `{ agent, dispose }`
 *   - get(id) → bare Agent (has `.followup`), NOT a handle
 * Emits session/event payloads (assistant/chunk, assistant/message, turn/end).
 */

import { randomUUID } from 'node:crypto'

/**
 * Parse smoke instruction: `reply exactly: <token>`
 * @param {unknown} message
 */
function extractUserText(message) {
  const content = message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map((b) => (b?.type === 'text' ? b.text : '')).join('')
  }
  return ''
}

/**
 * @param {string} text
 */
function deterministicReply(text) {
  const m = /^reply exactly:\s*(.+)$/i.exec(text.trim())
  if (m) return m[1].trim()
  return `echo:${text}`
}

export function createDeterministicAgents(options = {}) {
  /** @type {Map<string, any>} */
  const handles = new Map()
  /** @type {Array<(sessionId: string, event: any) => void>} */
  const bus = []
  /** @type {Map<string, number>} */
  const turnCounters = new Map()

  function emit(sessionId, event) {
    for (const fn of bus) fn(sessionId, event)
  }

  /**
   * @param {string} sessionId
   * @param {any} event
   */
  async function emitAsync(sessionId, event) {
    for (const fn of bus) {
      await fn(sessionId, event)
    }
    const handle = handles.get(String(sessionId))
    if (handle?.agent?.__onSessionEvent) {
      await handle.agent.__onSessionEvent({ id: sessionId }, event)
    }
  }

  function nextTurn(id) {
    const n = (turnCounters.get(id) || 0) + 1
    turnCounters.set(id, n)
    return n
  }

  function mintAgent(id) {
    return {
      id,
      session: { id },
      async followup(message) {
        if (options.hangFollowupMs && options.hangFollowupMs > 0) {
          await new Promise((r) => setTimeout(r, options.hangFollowupMs))
        }
        if (options.failFollowup) {
          throw new Error(String(options.failFollowup))
        }
        const text = extractUserText(message)
        const reply = options.replyFn ? options.replyFn(text) : deterministicReply(text)
        const turn = nextTurn(id)
        if (options.concurrentFlush) {
          // Mimic Cordis session/event: listeners are not awaited, so assistant/message
          // flush can race turn/end (historical send:1 + send:2 duplicate).
          emit(id, { type: 'turn/start', data: { turn } })
          emit(id, {
            type: 'assistant/chunk',
            data: { turn, chunk: { type: 'text-delta', text: reply } },
          })
          emit(id, {
            type: 'assistant/message',
            data: { turn, message: { content: [{ type: 'text', text: reply }] } },
          })
          emit(id, { type: 'turn/end', data: { turn } })
          await new Promise((r) => setTimeout(r, 80))
          return
        }
        if (options.streamEditWithinTurn) {
          const first = reply.slice(0, Math.max(1, Math.floor(reply.length / 2)))
          await emitAsync(id, { type: 'turn/start', data: { turn } })
          await emitAsync(id, {
            type: 'assistant/chunk',
            data: { turn, chunk: { type: 'text-delta', text: first } },
          })
          await emitAsync(id, {
            type: 'assistant/message',
            data: { turn, message: { content: [{ type: 'text', text: first }] } },
          })
          await emitAsync(id, {
            type: 'assistant/chunk',
            data: { turn, chunk: { type: 'text-delta', text: reply.slice(first.length) } },
          })
          await emitAsync(id, {
            type: 'assistant/message',
            data: { turn, message: { content: [{ type: 'text', text: reply }] } },
          })
          await emitAsync(id, { type: 'turn/end', data: { turn } })
          return
        }
        if (options.emptyTurn || !String(reply || '').trim()) {
          await emitAsync(id, { type: 'turn/start', data: { turn } })
          await emitAsync(id, {
            type: 'assistant/message',
            data: { turn, message: { content: [] } },
          })
          await emitAsync(id, { type: 'turn/end', data: { turn } })
          return
        }
        // chunk then final message then turn/end — await so outbox flush completes before inbound returns
        await emitAsync(id, { type: 'turn/start', data: { turn } })
        await emitAsync(id, {
          type: 'assistant/chunk',
          data: { turn, chunk: { type: 'text-delta', text: reply } },
        })
        await emitAsync(id, {
          type: 'assistant/message',
          data: { turn, message: { content: [{ type: 'text', text: reply }] } },
        })
        await emitAsync(id, { type: 'turn/end', data: { turn } })
      },
      __onSessionEvent: null,
      __emitSessionEvent: true,
    }
  }

  const api = {
    /**
     * Subscribe to session events (test harness wiring for bridge.onSessionEvent).
     * @param {(sessionId: string, event: any) => void} fn
     */
    onEvent(fn) {
      bus.push(fn)
      return () => {
        const i = bus.indexOf(fn)
        if (i >= 0) bus.splice(i, 1)
      }
    },

    async create({ sessionId, meta, agentOptions, setup } = {}) {
      const id = String(sessionId ?? `discord-${randomUUID()}`)
      if (handles.has(id)) {
        throw new Error(`session already exists: ${id}`)
      }
      const agent = mintAgent(id)
      agent.__createMeta = meta || null
      agent.__agentOptions = agentOptions || null
      agent.session = {
        id,
        header: meta?.cwd ? { cwd: meta.cwd } : {},
        requestHeader() {
          return undefined
        },
      }
      const handle = {
        agent,
        async dispose() {
          handles.delete(id)
        },
      }
      handles.set(id, handle)
      if (typeof setup === 'function') {
        const listeners = []
        await setup({
          agent,
          on(event, fn) {
            listeners.push({ event, fn })
          },
        })
        agent.__setupListeners = listeners
      }
      return handle
    },

    /**
     * Real DSH AgentRegistry.get → bare Agent.
     * @param {string} sessionId
     */
    get(sessionId) {
      return handles.get(String(sessionId))?.agent || null
    },

    async resume({ resumeSessionId }) {
      const id = String(resumeSessionId)
      const existing = handles.get(id)
      if (existing) return existing
      throw new Error(`session not found: ${id}`)
    },

    /** Test helper: drop live handle while leaving binding intact */
    dropHandle(sessionId) {
      handles.delete(String(sessionId))
    },
  }

  return api
}
