/**
 * Semantic Discord surface exports.
 */

export {
  TARGET_KINDS,
  normalizeTargetInput,
  normalizeProactiveTargets,
  resolveSemanticTarget,
  authorizeOutboundDelivery,
} from './targets.js'

export { createSemanticDiscordService, toSemanticReceipt } from './service.js'

export {
  buildDiscordToolDefinitions,
  registerDiscordTools,
  DISCORD_TOOL_RISK,
  DISCORD_TOOL_NAME_MAP,
} from './tools.js'
