/**
 * Model-facing discord.* tools — wrappers over semantic service via ctx.tools.
 *
 * Registered names use underscore ids for policy/Vega id compatibility.
 * Conceptual namespace remains discord.* (see TOOL-CONTRACT.md).
 *
 * Path: ctx.tools → tools/pre-execute → policy → execute → semantic service → outbox
 */

/** @typedef {ReturnType<import('./service.js').createSemanticDiscordService>} SemanticService */

const RECEIPT_SCHEMA = {
  type: 'object',
  properties: {
    operation_id: { type: 'string' },
    account_id: { type: 'string' },
    state: { type: 'string' },
    discord_resource_id: { type: 'string' },
    attempts: { type: 'number' },
    error_class: { type: 'string' },
    correlation_id: { type: 'string' },
  },
  additionalProperties: true,
}

function jsonOutput() {
  return {
    schema: { type: 'object', additionalProperties: true },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
  }
}

const TARGET_PARAM = {
  type: 'object',
  description:
    'Semantic target: { kind:"channel"|"thread"|"dm"|"alias", id?, alias?, parentChannelId?, guildId?, userId? }',
  additionalProperties: true,
}

/**
 * Canonical V1 tool definitions (underscore names).
 * @param {SemanticService} service
 */
export function buildDiscordToolDefinitions(service) {
  return [
    {
      name: 'discord_guild_list',
      description: 'List Discord guilds visible to the account. Requires account_id.',
      parameters: {
        type: 'object',
        properties: {
          account_id: { type: 'string' },
        },
        required: ['account_id'],
        additionalProperties: false,
      },
      output: jsonOutput(),
      async execute(args) {
        return service.guildList({ accountId: args.account_id })
      },
    },
    {
      name: 'discord_channel_get',
      description: 'Get Discord channel metadata (allowlisted). Requires account_id + channel_id.',
      parameters: {
        type: 'object',
        properties: {
          account_id: { type: 'string' },
          channel_id: { type: 'string' },
        },
        required: ['account_id', 'channel_id'],
        additionalProperties: false,
      },
      output: jsonOutput(),
      async execute(args) {
        return service.channelGet({ accountId: args.account_id, channelId: args.channel_id })
      },
    },
    {
      name: 'discord_channel_list',
      description: 'List channels in a guild (bounded). Requires account_id + guild_id.',
      parameters: {
        type: 'object',
        properties: {
          account_id: { type: 'string' },
          guild_id: { type: 'string' },
          limit: { type: 'number' },
        },
        required: ['account_id', 'guild_id'],
        additionalProperties: false,
      },
      output: jsonOutput(),
      async execute(args) {
        return service.channelList({
          accountId: args.account_id,
          guildId: args.guild_id,
          limit: args.limit,
        })
      },
    },
    {
      name: 'discord_message_get',
      description: 'Fetch one Discord message (bounded content). Requires account_id, channel_id, message_id.',
      parameters: {
        type: 'object',
        properties: {
          account_id: { type: 'string' },
          channel_id: { type: 'string' },
          message_id: { type: 'string' },
        },
        required: ['account_id', 'channel_id', 'message_id'],
        additionalProperties: false,
      },
      output: jsonOutput(),
      async execute(args) {
        return service.messageGet({
          accountId: args.account_id,
          channelId: args.channel_id,
          messageId: args.message_id,
        })
      },
    },
    {
      name: 'discord_message_history',
      description: 'Fetch recent Discord messages (bounded). Requires account_id + channel_id.',
      parameters: {
        type: 'object',
        properties: {
          account_id: { type: 'string' },
          channel_id: { type: 'string' },
          limit: { type: 'number' },
          before: { type: 'string' },
        },
        required: ['account_id', 'channel_id'],
        additionalProperties: false,
      },
      output: jsonOutput(),
      async execute(args) {
        return service.messageHistory({
          accountId: args.account_id,
          channelId: args.channel_id,
          limit: args.limit,
          before: args.before,
        })
      },
    },
    {
      name: 'discord_message_send',
      description:
        'Send a Discord message via DeliveryOutbox (content and/or Components V2 and/or attachments). Requires account_id + target. Attachments: workspace-relative paths only (no absolute / ..). Optional operation_id for idempotency (maps to Discord nonce, not HTTP Idempotency-Key).',
      parameters: {
        type: 'object',
        properties: {
          account_id: { type: 'string' },
          target: TARGET_PARAM,
          content: { type: 'string' },
          components: { type: 'array', items: { type: 'object', additionalProperties: true } },
          attachments: {
            type: 'array',
            description:
              'Optional files: [{ path: "relative/to/attach-root.txt" }] or [{ text, filename }]. No absolute paths.',
            items: { type: 'object', additionalProperties: true },
          },
          operation_id: { type: 'string' },
          correlation_id: { type: 'string' },
        },
        required: ['account_id', 'target'],
        additionalProperties: false,
      },
      output: { schema: RECEIPT_SCHEMA, render: jsonOutput().render },
      async execute(args) {
        return service.messageSend({
          accountId: args.account_id,
          target: args.target,
          content: args.content,
          components: args.components,
          attachments: args.attachments,
          operationId: args.operation_id,
          correlationId: args.correlation_id,
          wait: true,
        })
      },
    },
    {
      name: 'discord_message_reply',
      description: 'Reply to a Discord message via DeliveryOutbox.',
      parameters: {
        type: 'object',
        properties: {
          account_id: { type: 'string' },
          channel_id: { type: 'string' },
          message_id: { type: 'string' },
          content: { type: 'string' },
          components: { type: 'array', items: { type: 'object', additionalProperties: true } },
          operation_id: { type: 'string' },
          correlation_id: { type: 'string' },
        },
        required: ['account_id', 'channel_id', 'message_id'],
        additionalProperties: false,
      },
      output: { schema: RECEIPT_SCHEMA, render: jsonOutput().render },
      async execute(args) {
        return service.messageReply({
          accountId: args.account_id,
          channelId: args.channel_id,
          messageId: args.message_id,
          content: args.content,
          components: args.components,
          operationId: args.operation_id,
          correlationId: args.correlation_id,
          wait: true,
        })
      },
    },
    {
      name: 'discord_message_edit',
      description: 'Edit a bot Discord message via DeliveryOutbox.',
      parameters: {
        type: 'object',
        properties: {
          account_id: { type: 'string' },
          channel_id: { type: 'string' },
          message_id: { type: 'string' },
          content: { type: 'string' },
          components: { type: 'array', items: { type: 'object', additionalProperties: true } },
          operation_id: { type: 'string' },
          correlation_id: { type: 'string' },
        },
        required: ['account_id', 'channel_id', 'message_id'],
        additionalProperties: false,
      },
      output: { schema: RECEIPT_SCHEMA, render: jsonOutput().render },
      async execute(args) {
        return service.messageEdit({
          accountId: args.account_id,
          channelId: args.channel_id,
          messageId: args.message_id,
          content: args.content,
          components: args.components,
          operationId: args.operation_id,
          correlationId: args.correlation_id,
          wait: true,
        })
      },
    },
    {
      name: 'discord_message_delete',
      description:
        'Delete a bot-owned Discord message via DeliveryOutbox. Refuses foreign (non-bot) messages. Requires account_id + channel_id + message_id.',
      parameters: {
        type: 'object',
        properties: {
          account_id: { type: 'string' },
          channel_id: { type: 'string' },
          message_id: { type: 'string' },
          operation_id: { type: 'string' },
          correlation_id: { type: 'string' },
        },
        required: ['account_id', 'channel_id', 'message_id'],
        additionalProperties: false,
      },
      output: { schema: RECEIPT_SCHEMA, render: jsonOutput().render },
      async execute(args) {
        return service.messageDelete({
          accountId: args.account_id,
          channelId: args.channel_id,
          messageId: args.message_id,
          requireBotOwned: true,
          operationId: args.operation_id,
          correlationId: args.correlation_id,
          wait: true,
        })
      },
    },
    {
      name: 'discord_thread_create',
      description:
        'Create a Discord thread from a parent message (reuses durable outbox createThread identity).',
      parameters: {
        type: 'object',
        properties: {
          account_id: { type: 'string' },
          parent_channel_id: { type: 'string' },
          message_id: { type: 'string' },
          name: { type: 'string' },
          operation_id: { type: 'string' },
          correlation_id: { type: 'string' },
        },
        required: ['account_id', 'parent_channel_id', 'message_id'],
        additionalProperties: false,
      },
      output: { schema: RECEIPT_SCHEMA, render: jsonOutput().render },
      async execute(args) {
        return service.threadCreate({
          accountId: args.account_id,
          parentChannelId: args.parent_channel_id,
          messageId: args.message_id,
          name: args.name,
          operationId: args.operation_id,
          correlationId: args.correlation_id,
          wait: true,
        })
      },
    },
  ]
}

/**
 * Register tools on ctx.tools (one-arg definitions). Returns disposers.
 * @param {{ tools: { register: (def: object) => () => void }, effect?: Function, logger?: any }} ctx
 * @param {SemanticService} service
 * @param {{ names?: string[] }} [opts] optional allowlist of tool names to register
 */
export function registerDiscordTools(ctx, service, opts = {}) {
  const defs = buildDiscordToolDefinitions(service)
  const allow = opts.names ? new Set(opts.names) : null
  const registered = []
  for (const def of defs) {
    if (allow && !allow.has(def.name)) continue
    const register = () => ctx.tools.register(def)
    if (typeof ctx.effect === 'function') {
      // Same Cordis scope as tools (secrets cookbook) — do not fall back to a parent effect.
      ctx.effect(register, `dsh-piblox-discord: ${def.name}`)
    } else {
      register()
    }
    registered.push(def.name)
  }
  ctx.logger?.info?.(`dsh-piblox-discord: model tools registered ${registered.join(',')}`)
  // Always surface on stdout for LAB smoke diagnostics (logger may be quiet).
  // eslint-disable-next-line no-console
  console.info(`dsh-piblox-discord: model tools registered count=${registered.length} names=${registered.join(',')}`)
  return registered
}

/** Policy tool_risk rows for discord_* (OBSERVED L0–L2 mapping). */
export const DISCORD_TOOL_RISK = Object.freeze({
  discord_guild_list: 'L0',
  discord_channel_get: 'L0',
  discord_channel_list: 'L0',
  discord_message_get: 'L0',
  discord_message_history: 'L1',
  discord_message_send: 'L2',
  discord_message_reply: 'L2',
  discord_message_edit: 'L2',
  discord_message_delete: 'L2',
  discord_thread_create: 'L2',
})

/** Optional dotted → underscore map for catalogs that use discord.* display names. */
export const DISCORD_TOOL_NAME_MAP = Object.freeze({
  'discord.guild.list': 'discord_guild_list',
  'discord.channel.get': 'discord_channel_get',
  'discord.channel.list': 'discord_channel_list',
  'discord.message.get': 'discord_message_get',
  'discord.message.history': 'discord_message_history',
  'discord.message.send': 'discord_message_send',
  'discord.message.reply': 'discord_message_reply',
  'discord.message.edit': 'discord_message_edit',
  'discord.message.delete': 'discord_message_delete',
  'discord.thread.create': 'discord_thread_create',
})
