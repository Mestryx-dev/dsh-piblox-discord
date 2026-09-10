/**
 * Outbox operation / group / receipt types.
 */

/**
 * @typedef {'accepted'|'queued'|'sending'|'delivered'|'retry_wait'|'failed_terminal'} OutboxState
 */

/**
 * @typedef {'sendMessage'|'replyMessage'|'editMessage'|'createThread'|'deferInteraction'|'followUpInteraction'|'editInteractionReply'|'updateInteraction'} OperationType
 */

/**
 * @typedef {{
 *   channelId?: string,
 *   messageId?: string,
 *   guildId?: string,
 *   threadId?: string,
 *   parentChannelId?: string,
 *   interactionId?: string,
 * }} OutboxTarget
 */

/**
 * Bounded payload — content allowed for FakeTransport tests; live should prefer refs.
 * Tokens must never appear here.
 * @typedef {{
 *   content?: string,
 *   contentPreview?: string,
 *   replyTo?: string,
 *   components?: unknown[],
 *   componentsV2?: boolean,
 *   flags?: number,
 *   ephemeral?: boolean,
 *   threadName?: string,
 *   allowedMentions?: { parse?: string[], users?: string[], roles?: string[], repliedUser?: boolean },
 *   raw?: Record<string, unknown>,
 * }} OutboxPayload
 */

/**
 * @typedef {{
 *   operation_id: string,
 *   account_id: string,
 *   operation_type: OperationType,
 *   target: OutboxTarget,
 *   payload: OutboxPayload,
 *   state: OutboxState,
 *   attempt_count: number,
 *   next_attempt_at: number,
 *   created_at: number,
 *   updated_at: number,
 *   last_error: null | {
 *     class: string,
 *     code: string,
 *     message: string,
 *     retryAfterMs?: number,
 *   },
 *   discord_resource_id: string | null,
 *   nonce: string | null,
 *   enforce_nonce: boolean,
 *   correlation_id: string | null,
 *   group_id: string | null,
 *   group_step: number | null,
 *   max_attempts: number,
 * }} OutboxOperation
 */

/**
 * @typedef {{
 *   group_id: string,
 *   account_id: string,
 *   state: 'accepted'|'in_progress'|'delivered'|'failed_terminal',
 *   step_operation_ids: string[],
 *   created_at: number,
 *   updated_at: number,
 *   correlation_id: string | null,
 * }} OutboxGroup
 */

/**
 * Transport-neutral delivery receipt.
 * @typedef {{
 *   operation_id: string,
 *   state: OutboxState,
 *   account_id: string,
 *   discord_resource_id: string | null,
 *   attempts: number,
 *   error_class: string | null,
 *   correlation_id: string | null,
 *   group_id: string | null,
 * }} DeliveryReceipt
 */

/**
 * @param {OutboxOperation} op
 * @returns {DeliveryReceipt}
 */
export function toReceipt(op) {
  return {
    operation_id: op.operation_id,
    state: op.state,
    account_id: op.account_id,
    discord_resource_id: op.discord_resource_id,
    attempts: op.attempt_count,
    error_class: op.last_error?.class || null,
    correlation_id: op.correlation_id,
    group_id: op.group_id,
  }
}

export {}
