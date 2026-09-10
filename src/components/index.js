/**
 * Components V2 + interaction helpers (public surface).
 */

export {
  COMPONENT_KINDS,
  DISCORD_COMPONENT_TYPE,
  DISCORD_CUSTOM_ID_MAX,
  CUSTOM_ID_SCHEME,
  MESSAGE_FLAG_IS_COMPONENTS_V2,
  BUTTON_STYLE,
  isComponentNode,
  mintCustomId,
  parseCustomId,
  defaultAllowedMentions,
  encodeOutboundComponents,
  buildLabInteractionSmokeMessage,
  contentFingerprint,
} from './encode.js'

export { normalizeInteractionCreate } from './normalize-interaction.js'
