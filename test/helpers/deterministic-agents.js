/**
 * Deterministic agents facade for spike CI.
 * Mirrors OBSERVED AgentRegistry surface: create / get / resume + agent.followup.
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

  function emit(sessionId, event) {
    for (const fn of bus) fn(sessionId, event)
    const handle = handles.get(String(sessionId))
    if (handle?.agent?.__onSessionEvent) {
      void handle.agent.__onSessionEvent({ id: sessionId }, event)
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

    async create({ sessionId }) {
      const id = String(sessionId ?? `discord-${randomUUID()}`)
      if (handles.has(id)) {
        throw new Error(`session already exists: ${id}`)
      }
      const agent = {
        id,
        session: { id },
        followup(message) {
          const text = extractUserText(message)
          const reply = options.replyFn ? options.replyFn(text) : deterministicReply(text)
          // chunk then final message then turn/end
          emit(id, {
            type: 'assistant/chunk',
            data: { chunk: { type: 'text-delta', text: reply } },
          })
          emit(id, {
            type: 'assistant/message',
            data: { message: { content: [{ type: 'text', text: reply }] } },
          })
          emit(id, { type: 'turn/end', data: {} })
        },
        __onSessionEvent: null,
        __emitSessionEvent: true,
      }
      const handle = {
        agent,
        async dispose() {
          handles.delete(id)
        },
      }
      handles.set(id, handle)
      return handle
    },

    get(sessionId) {
      return handles.get(String(sessionId)) || null
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
