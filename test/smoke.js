/**
 * Deterministic end-to-end smoke:
 * Fake Discord inbound → dedupe → ConversationBinding → agents → outbox → FakeTransport
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createConversationBindingForTest } from '../../dsh-conversation-binding/src/index.js'
import { createDiscordProvider } from '../src/index.js'
import { FakeTransport } from '../src/transport/fake.js'
import { createDeterministicAgents } from './helpers/deterministic-agents.js'
import { createMockAgentPresets } from './helpers/mock-agent-presets.js'

const dir = mkdtempSync(join(tmpdir(), 'dsh-discord-smoke-'))
const conversationBinding = createConversationBindingForTest({
  storePath: join(dir, 'bindings.json'),
})
const agents = createDeterministicAgents()
const agentPresets = createMockAgentPresets(['standard'])
const transport = new FakeTransport()

const provider = createDiscordProvider(
  {
    conversationBinding,
    agents,
    transport,
    agentPresets,
    onSessionEvent: (sessionId, listener) =>
      agents.onEvent((sid, event) => {
        if (String(sid) === String(sessionId)) return listener({ id: sid }, event)
      }),
  },
  {
    accounts: {
      account_alpha: {
        enabled: true,
        agentPreset: 'standard',
        allowAllGuilds: true,
        allowAllChannels: true,
        allowAllUsers: true,
      },
    },
    sessionCwd: '/tmp/dsh-discord-test-cwd',
    outboxPath: join(dir, 'outbox.json'),
    inboundDedupePath: join(dir, 'inbound-dedupe.json'),
    accountsConfigPath: join(dir, 'discord-accounts.json'),
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

const outbound = transport.outbound.filter((o) => o.payload?.content?.includes('DSH_DISCORD_SMOKE_OK'))
assert.ok(outbound.length >= 1, 'expected FakeTransport outbound with smoke token')

const delivered = provider.outbox.listOperations({ accountId: 'account_alpha', state: 'delivered' })
assert.ok(delivered.length >= 1, 'expected delivered outbox receipt')

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
      outbox_delivered: delivered.length,
    },
    null,
    2,
  ),
)

await provider.stop()
rmSync(dir, { recursive: true, force: true })
