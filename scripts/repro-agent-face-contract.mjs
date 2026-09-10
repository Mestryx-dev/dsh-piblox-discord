/**
 * Contract repro (no Discord): mirrors real @deepseek-ai/dsh-agent 0.1.2-rc.1 shapes.
 *
 * create() → AgentHandle { agent, dispose }
 * get(id)  → bare Agent (followup on the agent itself)
 *
 * Run: node scripts/repro-agent-face-contract.mjs
 */
import assert from 'node:assert/strict'
import { resolveAgentFace } from '../src/bridge.js'

/** Minimal stand-in for AgentRegistry create/get (not DeterministicAgents / not AgentLoop). */
function makeRegistry() {
  /** @type {Map<string, { agent: any, dispose: Function }>} */
  const owned = new Map()
  return {
    async create({ sessionId }) {
      const agent = {
        id: sessionId,
        followupCalls: 0,
        followup(msg) {
          this.followupCalls += 1
          this.lastMsg = msg
        },
      }
      const handle = {
        agent,
        async dispose() {
          owned.delete(sessionId)
        },
      }
      owned.set(sessionId, handle)
      return handle
    },
    get(sessionId) {
      return owned.get(sessionId)?.agent
    },
  }
}

const agents = makeRegistry()
const handle = await agents.create({ sessionId: 'discord-repro-1' })
assert.equal(typeof handle.agent.followup, 'function')
assert.equal(handle.agent.agent, undefined)

const fromGet = agents.get('discord-repro-1')
assert.equal(typeof fromGet.followup, 'function')
assert.equal(fromGet.agent, undefined)

// BUG pattern (pre-fix): treat get() as Handle → agent_unavailable
assert.equal(fromGet?.agent?.followup, undefined)

// FIX pattern: resolveAgentFace
const resolved = resolveAgentFace(handle, fromGet)
assert.ok(resolved.agent)
resolved.agent.followup({ content: [{ type: 'text', text: 'ping' }], source: { kind: 'user' } })
assert.equal(resolved.agent.followupCalls, 1)

console.log(
  JSON.stringify({
    ok: true,
    create_returns: 'AgentHandle',
    get_returns: 'Agent',
    bug_pattern: 'get().agent.followup → undefined',
    fix: 'resolveAgentFace(ownedHandle, agents.get(id)).agent.followup',
  }),
)
