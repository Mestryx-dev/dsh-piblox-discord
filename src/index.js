/**
 * dsh-piblox-discord — generic first-party Discord provider for DSH.
 *
 * Cordis service key: `discord` (plugin-owned API surface).
 * Admin: `discord.accounts` + HTTP `/api/discord/*` (not model tools).
 *
 * ALL_NORMAL_OUTBOUND_VIA_OUTBOX = LOCKED
 * Credential ownership = dsh-piblox-secrets (LOCKED)
 */

import { normalizePluginConfig } from './config.js'
import { FakeTransport } from './transport/fake.js'
import { DiscordJsTransport } from './transport/discordjs.js'
import { DiscordSessionBridge } from './bridge.js'
import { createDeliveryOutbox } from './outbox/index.js'
import { FakeClock, SystemClock } from './clock.js'
import { createInboundDedupe, defaultInboundDedupePath } from './inbound-dedupe.js'
import { createOutboundApi } from './outbound-api.js'
import { defaultOutboxPath } from './outbox/store.js'
import {
  createAccountsConfigStore,
  defaultAccountsConfigPath,
} from './accounts-config-store.js'
import { createDiscordAccountsService } from './accounts-service.js'
import { registerDiscordHttpRoutes } from './http-accounts.js'
import { credentialSecretName } from './secret-ref.js'
import { createSemanticDiscordService } from './semantic/service.js'
import { registerDiscordTools } from './semantic/tools.js'

export const name = 'dsh-piblox-discord'
/** Bridge + credential plane (ADR-0012) — secrets required for token write/resolve.
 * agentPresets required for new-session mint (webhook-parity); soft-get was silently
 * unavailable and failed closed before dedupe claim with no stdout evidence.
 */
export const inject = ['conversationBinding', 'agents', 'secrets', 'agentPresets', 'agentDefaultModel']

export { FakeTransport, TransportError } from './transport/fake.js'
export { DiscordJsTransport, normalizeMessageCreate, toDiscordMessageBody, LIVE_SMOKE_INTENT_IDS, resolveGatewayIntents } from './transport/discordjs.js'
export { DiscordSessionBridge, mintDiscordSessionId, extractAssistantText, resolveAgentFace, buildDiscordCreateAgentExtras, prepareDiscordSessionCreate, DEFAULT_DISPATCH_TIMEOUT_MS } from './bridge.js'
export {
  normalizePluginConfig,
  normalizeAccountConfig,
  normalizeAgentPresetId,
  normalizeConversationMode,
  authorizeInbound,
  scopeSummary,
  DEFAULT_CONFIG,
  DEFAULT_ACCOUNT,
  AGENT_PRESET_ID_RE,
  CONVERSATION_MODES,
} from './config.js'
export { buildBindingIdentity, toExternalIdentity } from './binding.js'
export { threadNameFromContent, DEFAULT_THREAD_NAME, DISCORD_THREAD_NAME_MAX } from './thread-name.js'
export { createDiscordUserMessage, buildFollowupMessage } from './message-source.js'
export { COMPONENT_KINDS, isComponentNode } from './types.js'
export {
  DISCORD_COMPONENT_TYPE,
  DISCORD_CUSTOM_ID_MAX,
  CUSTOM_ID_SCHEME,
  MESSAGE_FLAG_IS_COMPONENTS_V2,
  BUTTON_STYLE,
  mintCustomId,
  parseCustomId,
  defaultAllowedMentions,
  encodeOutboundComponents,
  buildLabInteractionSmokeMessage,
  normalizeInteractionCreate,
} from './components/index.js'
export { createDeliveryOutbox } from './outbox/index.js'
export { createOutboxStore, defaultOutboxPath } from './outbox/store.js'
export { toReceipt } from './outbox/types.js'
export { FakeClock, SystemClock } from './clock.js'
export { classifyTransportError, computeBackoffMs, nonceFromOperationId } from './errors.js'
export { createInboundDedupe, defaultInboundDedupePath, inboundEventKey } from './inbound-dedupe.js'
export { createOutboundApi } from './outbound-api.js'
export { mapDiscordJsError, toClassifiableError } from './discord-errors.js'
export {
  credentialSecretName,
  validateAccountId,
  ACCOUNT_ID_RE,
  isSnowflakeString,
  normalizeSnowflakeList,
} from './secret-ref.js'
export { INTENT_OPTIONS, INTENT_IDS, normalizeIntents } from './intents.js'
export { createAccountsConfigStore, defaultAccountsConfigPath } from './accounts-config-store.js'
export { createDiscordAccountsService } from './accounts-service.js'
export {
  createDiscordHttpHandlers,
  registerDiscordHttpRoutes,
  invokeDiscordHttp,
  API_PREFIX as DISCORD_API_PREFIX,
} from './http-accounts.js'
export {
  createSemanticDiscordService,
  toSemanticReceipt,
  registerDiscordTools,
  buildDiscordToolDefinitions,
  DISCORD_TOOL_RISK,
  DISCORD_TOOL_NAME_MAP,
  normalizeTargetInput,
  normalizeProactiveTargets,
  resolveSemanticTarget,
  authorizeOutboundDelivery,
} from './semantic/index.js'

/**
 * Build plugin runtime without Cordis (tests / embedding).
 * @param {object} deps
 * @param {import('./config.js').PluginConfig & {
 *   outboxPath?: string,
 *   inboundDedupePath?: string,
 *   accountsConfigPath?: string,
 *   inboundDedupeTtlMs?: number,
 *   inboundDedupeLeaseMs?: number,
 * }} [config]
 */
export function createDiscordProvider(deps, config = {}) {
  const bootCfg = normalizePluginConfig(config)
  const transport =
    deps.transport ||
    (bootCfg.transport === 'discordjs'
      ? new DiscordJsTransport({
          allowConnect: Boolean(bootCfg.allowConnect),
          resolveCredential: async (ref) => {
            if (!deps.secrets || typeof deps.secrets.resolve !== 'function') {
              return { ok: false }
            }
            return deps.secrets.resolve(ref)
          },
          logger: deps.logger,
        })
      : new FakeTransport())

  const clock = deps.clock || new SystemClock()
  const outboxPath = config.outboxPath || deps.outboxPath || defaultOutboxPath()
  const outbox =
    deps.outbox === null
      ? null
      : deps.outbox ||
        createDeliveryOutbox({
          transport,
          storePath: outboxPath,
          clock,
          observability: deps.observability,
          retry: deps.retry,
        })

  const inboundDedupe =
    deps.inboundDedupe === null
      ? null
      : deps.inboundDedupe ||
        createInboundDedupe({
          storePath: config.inboundDedupePath || deps.inboundDedupePath || defaultInboundDedupePath(),
          clock,
          ttlMs: config.inboundDedupeTtlMs ?? deps.inboundDedupeTtlMs ?? 72 * 60 * 60 * 1000,
          leaseMs: config.inboundDedupeLeaseMs ?? deps.inboundDedupeLeaseMs ?? 5 * 60 * 1000,
        })

  if (!outbox) {
    throw new Error('createDiscordProvider: DeliveryOutbox is required for normal outbound paths')
  }

  const accountsConfigPath =
    config.accountsConfigPath || deps.accountsConfigPath || defaultAccountsConfigPath()
  const accountsConfigStore =
    deps.accountsConfigStore ||
    createAccountsConfigStore({ storePath: accountsConfigPath })

  // Mutable runtime config — SSOT is the accounts ledger (seeded from Cordis boot once).
  /** @type {{ transport: string, allowConnect?: boolean, accounts: Record<string, any> }} */
  let liveConfig = {
    transport: bootCfg.transport,
    allowConnect: bootCfg.allowConnect,
    accounts: { ...bootCfg.accounts },
  }

  const messages = createOutboundApi({ outbox })

  const bridge = new DiscordSessionBridge({
    conversationBinding: deps.conversationBinding,
    agents: deps.agents,
    transport,
    outbox,
    inboundDedupe,
    accounts: liveConfig.accounts,
    observability: deps.observability,
    createUserMessage: deps.createUserMessage,
    agentPresets: deps.agentPresets,
    agentDefaultModel: deps.agentDefaultModel,
    sessionCwd: bootCfg.sessionCwd || deps.sessionCwd,
    dispatchTimeoutMs: bootCfg.dispatchTimeoutMs ?? deps.dispatchTimeoutMs,
    onSessionEvent: deps.onSessionEvent,
    onInteractionIntent: deps.onInteractionIntent,
    logger: deps.logger,
  })

  const semantic = createSemanticDiscordService({
    getAccounts: () => liveConfig.accounts,
    transport,
    outbox,
    observability: deps.observability,
    logger: deps.logger,
  })

  /** @type {any} */
  const api = {
    config: liveConfig,
    transport,
    bridge,
    outbox,
    clock,
    inboundDedupe,
    accountsConfigStore,
    messages,
    semantic,
    // Convenience aliases on the Cordis service surface
    guildList: (input) => semantic.guildList(input),
    channelGet: (input) => semantic.channelGet(input),
    channelList: (input) => semantic.channelList(input),
    messageGet: (input) => semantic.messageGet(input),
    messageHistory: (input) => semantic.messageHistory(input),
    messageSend: (input) => semantic.messageSend(input),
    messageReply: (input) => semantic.messageReply(input),
    messageEdit: (input) => semantic.messageEdit(input),
    threadCreate: (input) => semantic.threadCreate(input),
    notify: (input) => semantic.notify(input),
    postLabInteractionSmoke: (input) => bridge.postLabInteractionSmoke(input),
  }

  function applyLiveConfig(next) {
    liveConfig = {
      transport: next.transport || liveConfig.transport,
      allowConnect:
        next.allowConnect !== undefined ? Boolean(next.allowConnect) : liveConfig.allowConnect,
      accounts: { ...(next.accounts || {}) },
    }
    for (const key of Object.keys(bridge.accounts)) {
      if (!(key in liveConfig.accounts)) delete bridge.accounts[key]
    }
    Object.assign(bridge.accounts, liveConfig.accounts)
    api.config = liveConfig
  }

  const discordAccounts = createDiscordAccountsService({
    configStore: accountsConfigStore,
    secrets: deps.secrets || null,
    transport,
    outbox,
    agentPresets: deps.agentPresets || null,
    logger: deps.logger,
    onConfigChanged: applyLiveConfig,
    liveGatewayConnected: (accountId) =>
      Boolean(
        deps.liveGatewayConnected?.(accountId) ||
          transport.isAccountConnected?.(accountId) ||
          (transport.isAccountRunning?.(accountId) &&
            transport.getAccountStatus?.(accountId) === 'connected'),
      ),
  })

  api.accounts = discordAccounts
  api.discordAccounts = discordAccounts
  api.drainOutbound = async function drainOutbound(opts = {}) {
    const maxRounds = opts.maxRounds ?? 30
    let total = 0
    for (let i = 0; i < maxRounds; i++) {
      const { processed } = await outbox.tick({ accountId: opts.accountId })
      total += processed
      if (processed === 0) break
    }
    return { processed: total }
  }

  async function startConfiguredAccount(accountId, account) {
    const ref = account.credentials || credentialSecretName(accountId)
    let configured = true
    if (typeof deps.secrets?.hasKey === 'function') {
      configured = deps.secrets.hasKey(ref)
    } else if (typeof deps.secrets?.resolve === 'function') {
      configured = Boolean(deps.secrets.resolve(ref)?.ok)
    } else if (typeof deps.secrets?.listNames === 'function') {
      const names = (await deps.secrets.listNames())?.names || []
      configured = names.includes(ref)
    } else if (deps.secrets?.store?.listNames) {
      const names = await deps.secrets.store.listNames()
      configured = names.includes(ref)
    } else if (!account.credentials && !deps.secrets) {
      configured = true
    } else if (!account.credentials) {
      configured = false
    }
    if (!configured) {
      deps.logger?.info?.(`discord: skip start ${accountId} (missing_credentials)`)
      return
    }
    try {
      await transport.startAccount(accountId, {
        credentialsRef: ref,
        intents: account.intents,
      })
      outbox?.clearAccountIsolation?.(accountId)
    } catch (err) {
      // Isolate failure: do not rethrow into Cordis boot.
      deps.logger?.warn?.(
        `discord: startAccount isolated failure account=${accountId} err=${err instanceof Error ? err.message : err}`,
      )
    }
  }

  api.start = async function start() {
    await accountsConfigStore.seedFromBootConfig(bootCfg)
    applyLiveConfig(accountsConfigStore.snapshot())

    if (outbox?.recoverOnLoad) {
      await outbox.recoverOnLoad()
    }
    bridge.start()

    for (const [accountId, account] of Object.entries(liveConfig.accounts)) {
      if (!account.enabled) continue
      if (liveConfig.transport === 'discordjs' && !transport.allowConnect) {
        deps.logger?.info?.(
          `discord: skip Gateway start ${accountId} (allowConnect=false)`,
        )
        continue
      }
      await startConfiguredAccount(accountId, account)
    }

    // Optional one-shot LAB interaction smoke (Components V2 Button+Select). Not product UI.
    const smokeAccount = process.env.DSH_INTERACTION_SMOKE_ACCOUNT
    const smokeChannel = process.env.DSH_INTERACTION_SMOKE_CHANNEL
    if (smokeAccount && smokeChannel) {
      setTimeout(() => {
        bridge
          .postLabInteractionSmoke({
            accountId: String(smokeAccount),
            channelId: String(smokeChannel),
            operationId: `lab:interaction-smoke:${smokeAccount}:${smokeChannel}`,
          })
          .then((r) => {
            deps.logger?.info?.(
              `discord: LAB interaction smoke posted account=${smokeAccount} channel=${smokeChannel} ok=${r.ok} resource=${r.discord_resource_id || ''} encoding=${r.encoding || ''}`,
            )
            // eslint-disable-next-line no-console
            console.info(
              `discord LAB interaction smoke: ok=${r.ok} resource=${r.discord_resource_id || ''} customIds=${JSON.stringify(r.customIds || {})}`,
            )
          })
          .catch((err) => {
            deps.logger?.warn?.(
              `discord: LAB interaction smoke failed err=${err instanceof Error ? err.message : err}`,
            )
          })
      }, 2500)
    }

    // Optional LAB proactive / tool-path smokes (explicit env only — not product).
    const proactiveAccount = process.env.DSH_PROACTIVE_SMOKE_ACCOUNT
    const proactiveAlias = process.env.DSH_PROACTIVE_SMOKE_ALIAS
    const proactiveContent = process.env.DSH_PROACTIVE_SMOKE_CONTENT || 'DSH_PROACTIVE_SERVICE_OK'
    if (proactiveAccount && proactiveAlias) {
      setTimeout(() => {
        semantic
          .notify({
            accountId: String(proactiveAccount),
            target: { alias: String(proactiveAlias) },
            content: String(proactiveContent),
            operationId: `lab:proactive:${proactiveAccount}:${proactiveAlias}`,
            wait: true,
          })
          .then((r) => {
            // eslint-disable-next-line no-console
            console.info(
              `discord LAB proactive: ok=${r.state} op=${r.operation_id} resource=${r.discord_resource_id || ''}`,
            )
          })
          .catch((err) => {
            // eslint-disable-next-line no-console
            console.warn(`discord LAB proactive failed: ${err instanceof Error ? err.message : err}`)
          })
      }, 3500)
    }

    const toolSmokeContent = process.env.DSH_DISCORD_TOOL_SMOKE_CONTENT
    const toolSmokeAccount = process.env.DSH_DISCORD_TOOL_SMOKE_ACCOUNT || proactiveAccount
    const toolSmokeAlias = process.env.DSH_DISCORD_TOOL_SMOKE_ALIAS || proactiveAlias
    if (toolSmokeContent && toolSmokeAccount && toolSmokeAlias) {
      setTimeout(() => {
        const args = {
          account_id: String(toolSmokeAccount),
          target: { alias: String(toolSmokeAlias) },
          content: String(toolSmokeContent),
          operation_id: `lab:tool-send:${toolSmokeAccount}:${Date.now()}`,
        }
        const tools = api._tools
        // eslint-disable-next-line no-console
        console.info(
          `discord LAB tool smoke: tools_runtime=${Boolean(tools?.execute)} invoking discord_message_send args=${JSON.stringify({ account_id: args.account_id, target: args.target, content: args.content, operation_id: args.operation_id })}`,
        )
        const run = async () => {
          if (!tools || typeof tools.execute !== 'function') {
            throw new Error('tools runtime unavailable — cannot prove tools/pre-execute path')
          }
          const result = await tools.execute({
            name: 'discord_message_send',
            arguments: args,
            callId: `lab-discord-tool-${Date.now()}`,
          })
          // eslint-disable-next-line no-console
          console.info(
            `discord LAB tool smoke: tools.execute done isError=${Boolean(result?.isError || result?.error)} content=${JSON.stringify(result?.content ?? result).slice(0, 400)}`,
          )
          return result
        }
        run().catch((err) => {
          // eslint-disable-next-line no-console
          console.warn(`discord LAB tool smoke failed: ${err instanceof Error ? err.message : err}`)
        })
      }, 5000)
    }
  }
  api.stop = async function stop() {
    bridge.stop()
    for (const accountId of Object.keys(liveConfig.accounts)) {
      if (transport.isAccountRunning(accountId)) {
        await transport.stopAccount(accountId)
      }
    }
  }
  api.startAccount = async function startAccount(accountId) {
    const account = liveConfig.accounts[accountId]
    if (!account?.enabled) throw new Error(`account not enabled: ${accountId}`)
    if (liveConfig.transport === 'discordjs' && !transport.allowConnect) {
      throw new Error('allowConnect=false — live Gateway blocked')
    }
    const ref = account.credentials || credentialSecretName(accountId)
    let configured = true
    if (typeof deps.secrets?.hasKey === 'function') {
      configured = deps.secrets.hasKey(ref)
    } else if (typeof deps.secrets?.resolve === 'function') {
      configured = Boolean(deps.secrets.resolve(ref)?.ok)
    } else if (typeof deps.secrets?.listNames === 'function') {
      const names = (await deps.secrets.listNames())?.names || []
      configured = names.includes(ref)
    } else if (deps.secrets?.store?.listNames) {
      const names = await deps.secrets.store.listNames()
      configured = names.includes(ref)
    } else if (!account.credentials) {
      configured = false
    }
    if (!configured) {
      throw new Error(`missing_credentials: ${accountId}`)
    }
    await transport.startAccount(accountId, {
      credentialsRef: ref,
      intents: account.intents,
    })
    outbox?.clearAccountIsolation?.(accountId)
  }
  api.stopAccount = async function stopAccount(accountId) {
    await transport.stopAccount(accountId)
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
  const secrets = ctx.secrets
  if (!conversationBinding || !agents) {
    throw new Error('dsh-piblox-discord: requires conversationBinding and agents services')
  }
  if (!secrets) {
    throw new Error('dsh-piblox-discord: requires secrets service (dsh-piblox-secrets)')
  }

  const get = (key) => (typeof ctx.get === 'function' ? ctx.get(key) : undefined)
  // Soft-resolve optional services — never access as a property without inject
  // (Cordis throws "cannot get property without inject").
  const observability = get('observability')
  const createUserMessage = get('createUserMessage')
  // Hard-injected (see `inject`) — webhook-parity session mint.
  const agentPresets = ctx.agentPresets
  const agentDefaultModel = ctx.agentDefaultModel
  if (!agentPresets || typeof agentPresets.resolve !== 'function' || typeof agentPresets.mount !== 'function') {
    throw new Error('dsh-piblox-discord: requires agentPresets service (resolve + mount)')
  }

  const provider = createDiscordProvider(
    {
      conversationBinding,
      agents,
      secrets,
      observability,
      createUserMessage,
      agentPresets,
      agentDefaultModel,
      onSessionEvent: (sessionId, listener) => {
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
  // Admin surface alias (not registered as model tools)
  ctx.provide('discordAccounts', provider.accounts)

  // Model-facing tools — soft-inject tools (secrets cookbook). Default on when available.
  const exposeTools = config.exposeTools !== false
  if (exposeTools && typeof ctx.inject === 'function') {
    try {
      ctx.inject(['tools'], (tctx) => {
        const toolsCtx = /** @type {any} */ (tctx)
        provider._tools = toolsCtx.tools
        registerDiscordTools(
          {
            tools: toolsCtx.tools,
            effect: toolsCtx.effect?.bind(toolsCtx) || ctx.effect?.bind(ctx),
            logger: ctx.logger,
          },
          provider.semantic,
          { names: config.toolNames },
        )
      })
    } catch (err) {
      ctx.logger?.warn?.(
        `dsh-piblox-discord: tools inject skipped — ${err instanceof Error ? err.message : err}`,
      )
    }
  }

  if (typeof ctx.inject === 'function') {
    try {
      ctx.inject(['webServer'], (httpCtx) => {
        const scoped = /** @type {any} */ (httpCtx)
        const web = scoped.webServer
        const register = (adminAuth) => {
          registerDiscordHttpRoutes(web, {
            accounts: provider.accounts,
            uiEnabled: config.uiEnabled !== false,
            adminAuth,
          })
        }
        if (typeof scoped.inject === 'function') {
          try {
            scoped.inject(['connection'], (cctx) => {
              const connection = /** @type {any} */ (cctx).connection
              const adminAuth =
                connection && typeof connection.requestRejection === 'function'
                  ? { requestRejection: connection.requestRejection.bind(connection) }
                  : undefined
              register(adminAuth)
            })
            return
          } catch (err) {
            ctx.logger?.warn?.(
              `dsh-piblox-discord: connection inject skipped — ${err instanceof Error ? err.message : err}`,
            )
          }
        }
        register(undefined)
      })
    } catch (err) {
      ctx.logger?.warn?.(
        `dsh-piblox-discord: webServer inject skipped — ${err instanceof Error ? err.message : err}`,
      )
    }
  }

  ctx.logger?.info?.(
    `dsh-piblox-discord: loaded transport=${provider.config.transport} accounts=${Object.keys(provider.config.accounts).length}`,
  )
}
