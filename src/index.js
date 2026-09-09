/**
 * dsh-piblox-discord — generic first-party Discord provider for DSH.
 *
 * Cordis service key: `discord` (plugin-owned API surface).
 * Transport: FakeTransport (spike) | DiscordJsTransport skeleton (no live connect).
 */

import { normalizePluginConfig } from './config.js'
import { FakeTransport } from './transport/fake.js'
import { DiscordJsTransport } from './transport/discordjs.js'
import { DiscordSessionBridge } from './bridge.js'
import { createDeliveryOutbox } from './outbox/index.js'
import { FakeClock, SystemClock } from './clock.js'

export const name = 'dsh-piblox-discord'
/** Agents + conversationBinding required for the DSH bridge. */
export const inject = ['conversationBinding', 'agents']

export { FakeTransport, TransportError } from './transport/fake.js'
export { DiscordJsTransport } from './transport/discordjs.js'
export { DiscordSessionBridge, mintDiscordSessionId, extractAssistantText } from './bridge.js'
export {
  normalizePluginConfig,
  normalizeAccountConfig,
  authorizeInbound,
  DEFAULT_CONFIG,
  DEFAULT_ACCOUNT,
} from './config.js'
export { buildBindingIdentity, toExternalIdentity } from './binding.js'
export { createDiscordUserMessage, buildFollowupMessage } from './message-source.js'
export { COMPONENT_KINDS, isComponentNode } from './types.js'
export { createDeliveryOutbox } from './outbox/index.js'
export { createOutboxStore, defaultOutboxPath } from './outbox/store.js'
export { toReceipt } from './outbox/types.js'
export { FakeClock, SystemClock } from './clock.js'
export { classifyTransportError, computeBackoffMs, nonceFromOperationId } from './errors.js'

/**
 * Build plugin runtime without Cordis (tests / embedding).
 * @param {object} deps
 * @param {import('./config.js').PluginConfig & { outboxPath?: string }} [config]
 */
export function createDiscordProvider(deps, config = {}) {
  const cfg = normalizePluginConfig(config)
  const transport =
    deps.transport ||
    (cfg.transport === 'discordjs' ? new DiscordJsTransport({ allowConnect: false }) : new FakeTransport())

  const clock = deps.clock || new SystemClock()
  const outbox =
    deps.outbox ||
    (deps.outbox === null
      ? null
      : createDeliveryOutbox({
          transport,
          storePath: config.outboxPath || deps.outboxPath,
          clock,
          observability: deps.observability,
          retry: deps.retry,
        }))

  const bridge = new DiscordSessionBridge({
    conversationBinding: deps.conversationBinding,
    agents: deps.agents,
    transport,
    accounts: cfg.accounts,
    observability: deps.observability,
    createUserMessage: deps.createUserMessage,
    onSessionEvent: deps.onSessionEvent,
    logger: deps.logger,
  })

  const api = {
    config: cfg,
    transport,
    bridge,
    outbox,
    clock,
    async start() {
      if (outbox?.recoverOnLoad) {
        await outbox.recoverOnLoad()
      }
      bridge.start()
      for (const [accountId, account] of Object.entries(cfg.accounts)) {
        if (!account.enabled) continue
        if (cfg.transport === 'discordjs') {
          // Skeleton refuses live connect — skip starting live accounts in spike.
          continue
        }
        await transport.startAccount(accountId, { credentialsRef: account.credentials })
      }
    },
    async stop() {
      bridge.stop()
      for (const accountId of Object.keys(cfg.accounts)) {
        if (transport.isAccountRunning(accountId)) {
          await transport.stopAccount(accountId)
        }
      }
    },
    async startAccount(accountId) {
      const account = cfg.accounts[accountId]
      if (!account?.enabled) throw new Error(`account not enabled: ${accountId}`)
      await transport.startAccount(accountId, { credentialsRef: account.credentials })
      outbox?.clearAccountIsolation?.(accountId)
    },
    async stopAccount(accountId) {
      await transport.stopAccount(accountId)
    },
  }

  return api
}

/**
 * Cordis apply entrypoint.
 * @param {any} ctx
 * @param {import('./config.js').PluginConfig} config
 */
export function apply(ctx, config = {}) {
  const conversationBinding = ctx.conversationBinding
  const agents = ctx.agents
  if (!conversationBinding || !agents) {
    throw new Error('dsh-piblox-discord: requires conversationBinding and agents services')
  }

  const provider = createDiscordProvider(
    {
      conversationBinding,
      agents,
      observability: ctx.observability,
      createUserMessage: ctx.createUserMessage,
      onSessionEvent: (sessionId, listener) => {
        // Cordis root session/event bus — filter by session id when available.
        return ctx.on('session/event', (session, event) => {
          const sid = String(session?.id ?? session?.sessionId ?? '')
          if (sid && sid !== String(sessionId)) return
          return listener(session, event)
        })
      },
      logger: ctx.logger,
    },
    config,
  )

  ctx.effect(() => {
    void provider.start()
    return () => {
      void provider.stop()
    }
  })

  ctx.provide('discord', provider)
  ctx.logger?.info?.(
    `dsh-piblox-discord: loaded transport=${provider.config.transport} accounts=${Object.keys(provider.config.accounts).length}`,
  )
}
