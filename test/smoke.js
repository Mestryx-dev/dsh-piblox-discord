/**
 * Deterministic end-to-end smoke:
 * Fake Discord inbound → ConversationBinding → agents.create → followup → FakeTransport outbound
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createConversationBindingForTest } from '../../dsh-conversation-binding/src/index.js'
import { createDiscordProvider } from '../src/index.js'
import { FakeTransport } from '../src/transport/fake.js'
import { createDeterministicAgents } from './helpers/deterministic-agents.js'

const dir = mkdtempSync(join(tmpdir(), 'dsh-discord-smoke-'))
const conversationBinding = createConversationBindingForTest({
  storePath: join(dir, 'bindings.json'),
})
const agents = createDeterministicAgents()
const transport = new FakeTransport()

const provider = createDiscordProvider(
  {
    conversationBinding,
    agents,
    transport,
    onSessionEvent: (sessionId, listener) =>
      agents.onEvent((sid, event) => {
        if (String(sid) === String(sessionId)) listener({ id: sid }, event)
      }),
  },
  {
    accounts: {
      account_alpha: {
        enabled: true,
        allowAllGuilds: true,
        allowAllChannels: true,
      },
    },
  },
)

await provider.start()

await transport.injectMessage({
  accountId: 'account_alpha',
  channelId: 'smoke-channel',
  guildId: 'smoke-guild',
  userId: 'smoke-user',
  messageId: 'smoke-msg',
  content: 'reply exactly: DSH_DISCORD_SMOKE_OK',
})

await new Promise((r) => setTimeout(r, 20))

const outbound = transport.outbound.filter((o) => o.payload?.content?.includes('DSH_DISCORD_SMOKE_OK'))
assert.ok(outbound.length >= 1, 'expected FakeTransport outbound with smoke token')

const bindings = Object.values(conversationBinding.dump().bindings)
assert.equal(bindings.length, 1)
const sessionId = bindings[0].session_id
assert.ok(sessionId.startsWith('discord-'))

console.log(
  JSON.stringify(
    {
      smoke: 'PASS',
      input: 'reply exactly: DSH_DISCORD_SMOKE_OK',
      session_id: sessionId,
      output: outbound[outbound.length - 1].payload.content,
    },
    null,
    2,
  ),
)

await provider.stop()
rmSync(dir, { recursive: true, force: true })
