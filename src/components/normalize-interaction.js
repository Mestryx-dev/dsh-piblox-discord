/**
 * Normalize discord.js Interaction → plugin PlatformInteraction (no Interaction object leak).
 */

/**
 * @typedef {import('../types.js').PlatformInteraction} PlatformInteraction
 */

/**
 * @param {string} accountId
 * @param {any} interaction
 * @param {{ deliveryMode?: 'gateway'|'http_endpoint' }} [opts]
 * @returns {PlatformInteraction}
 */
export function normalizeInteractionCreate(accountId, interaction, opts = {}) {
  const channel = interaction?.channel
  const isThread =
    typeof channel?.isThread === 'function'
      ? Boolean(channel.isThread())
      : Boolean(channel?.isThread)
  const channelId =
    interaction?.channelId != null
      ? String(interaction.channelId)
      : channel?.id != null
        ? String(channel.id)
        : ''
  const threadId = isThread ? channelId : undefined
  const parentChannelId =
    isThread && channel?.parentId != null
      ? String(channel.parentId)
      : isThread && interaction?.channel?.parentId != null
        ? String(interaction.channel.parentId)
        : undefined

  const isDm = Boolean(
    channel?.isDMBased?.() === true ||
      interaction?.channel?.isDMBased?.() === true ||
      (!interaction?.guildId && interaction?.channel?.type === 1),
  )

  const componentType = mapComponentType(interaction)
  const customId =
    interaction?.customId != null
      ? String(interaction.customId)
      : interaction?.component?.customId != null
        ? String(interaction.component.customId)
        : undefined

  const values = normalizeSelectedValues(interaction)
  const subtype = resolveInteractionSubtype(interaction, componentType)

  const userId = String(
    interaction?.user?.id || interaction?.member?.user?.id || interaction?.member?.id || '',
  )

  /** @type {PlatformInteraction} */
  const event = {
    type: subtype,
    accountId: String(accountId),
    eventId: String(interaction?.id || ''),
    interactionId: String(interaction?.id || ''),
    applicationId: interaction?.applicationId != null ? String(interaction.applicationId) : undefined,
    guildId: interaction?.guildId != null ? String(interaction.guildId) : undefined,
    channelId,
    threadId,
    parentChannelId,
    userId,
    messageId: interaction?.message?.id != null ? String(interaction.message.id) : undefined,
    customId,
    componentType,
    values,
    isDm,
    isBot: Boolean(interaction?.user?.bot),
    deliveryMode: opts.deliveryMode || 'gateway',
    installationContext: mapInstallContext(interaction),
    interactionContext: mapInteractionContext(interaction, isDm),
    timestamp: new Date().toISOString(),
    raw: {
      interaction_type: interaction?.type ?? null,
      component_type: componentType ?? null,
      custom_id: customId || null,
      // bounded — never token / auth
      message_id: interaction?.message?.id != null ? String(interaction.message.id) : null,
      parent_id: parentChannelId || null,
    },
  }
  return event
}

/**
 * @param {any} interaction
 * @param {string | undefined} componentType
 */
function resolveInteractionSubtype(interaction, componentType) {
  // discord.js: ComponentType enum / isButton / isAnySelectMenu
  if (typeof interaction?.isButton === 'function' && interaction.isButton()) {
    return 'discord.button.clicked'
  }
  if (
    (typeof interaction?.isAnySelectMenu === 'function' && interaction.isAnySelectMenu()) ||
    (typeof interaction?.isStringSelectMenu === 'function' && interaction.isStringSelectMenu()) ||
    (typeof interaction?.isUserSelectMenu === 'function' && interaction.isUserSelectMenu()) ||
    (typeof interaction?.isRoleSelectMenu === 'function' && interaction.isRoleSelectMenu()) ||
    (typeof interaction?.isChannelSelectMenu === 'function' && interaction.isChannelSelectMenu()) ||
    (typeof interaction?.isMentionableSelectMenu === 'function' &&
      interaction.isMentionableSelectMenu())
  ) {
    return 'discord.select.changed'
  }
  if (componentType === 'button') return 'discord.button.clicked'
  if (componentType && /select/i.test(componentType)) return 'discord.select.changed'
  return 'discord.interaction.created'
}

/** @param {any} interaction */
function mapComponentType(interaction) {
  const t = interaction?.componentType ?? interaction?.component?.type
  if (t == null) return undefined
  const map = {
    2: 'button',
    3: 'string_select',
    5: 'user_select',
    6: 'role_select',
    7: 'mentionable_select',
    8: 'channel_select',
  }
  if (map[t]) return map[t]
  if (typeof t === 'string') return t.toLowerCase()
  return String(t)
}

/** @param {any} interaction */
function normalizeSelectedValues(interaction) {
  if (Array.isArray(interaction?.values)) {
    return interaction.values.map((v) => String(v))
  }
  // User/Role/Channel select may expose users/roles/channels collections
  if (interaction?.users?.size) {
    return [...interaction.users.keys()].map(String)
  }
  if (interaction?.roles?.size) {
    return [...interaction.roles.keys()].map(String)
  }
  if (interaction?.channels?.size) {
    return [...interaction.channels.keys()].map(String)
  }
  return undefined
}

/** @param {any} interaction */
function mapInstallContext(interaction) {
  const ctx = interaction?.context ?? interaction?.authorizingIntegrationOwners
  // discord.js InteractionContextType: Guild=0, BotDm=1, PrivateChannel=2
  if (interaction?.context === 0) return 'GUILD_INSTALL'
  if (interaction?.context === 1 || interaction?.context === 2) return 'USER_INSTALL'
  if (ctx && typeof ctx === 'object') {
    // Presence of guild owner key → guild install path when available
    return 'GUILD_INSTALL'
  }
  return null
}

/**
 * @param {any} interaction
 * @param {boolean} isDm
 */
function mapInteractionContext(interaction, isDm) {
  if (isDm) return 'bot_dm'
  if (interaction?.guildId) return 'guild'
  if (interaction?.context === 2) return 'private_channel'
  return interaction?.guildId ? 'guild' : null
}
