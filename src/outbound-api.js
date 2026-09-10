/**
 * Consumer/tool outbound API — always via DeliveryOutbox.
 * Future discord.message.send / reply / edit tools call this surface.
 * Interaction responses share the same outbox (delivery-agnostic).
 */

import { defaultAllowedMentions } from './components/encode.js'

/**
 * @param {{ outbox: ReturnType<import('./outbox/index.js').createDeliveryOutbox> }} deps
 */
export function createOutboundApi(deps) {
  const { outbox } = deps
  if (!outbox) throw new Error('createOutboundApi: outbox required')

  /**
   * @param {Record<string, any>} input
   */
  function messagePayload(input) {
    return {
      content: input.content,
      components: input.components,
      componentsV2: input.componentsV2,
      flags: input.flags,
      embeds: input.embeds,
      ephemeral: input.ephemeral,
      allowedMentions: input.allowedMentions || defaultAllowedMentions(),
      replyTo: input.replyTo,
      raw: input.raw,
    }
  }

  return {
    /**
     * @param {{
     *   operationId: string,
     *   accountId: string,
     *   channelId: string,
     *   content?: string,
     *   components?: unknown[],
     *   componentsV2?: boolean,
     *   embeds?: unknown[],
     *   flags?: number,
     *   allowedMentions?: object,
     *   correlationId?: string,
     * }} input
     */
    async sendMessage(input) {
      return outbox.enqueue({
        operationId: input.operationId,
        accountId: input.accountId,
        operationType: 'sendMessage',
        target: { channelId: input.channelId },
        payload: messagePayload(input),
        correlationId: input.correlationId,
        useNonce: true,
      })
    },

    /**
     * @param {{
     *   operationId: string,
     *   accountId: string,
     *   channelId: string,
     *   messageId: string,
     *   content?: string,
     *   components?: unknown[],
     *   componentsV2?: boolean,
     *   embeds?: unknown[],
     *   allowedMentions?: object,
     *   correlationId?: string,
     * }} input
     */
    async replyMessage(input) {
      return outbox.enqueue({
        operationId: input.operationId,
        accountId: input.accountId,
        operationType: 'replyMessage',
        target: { channelId: input.channelId, messageId: input.messageId },
        payload: { ...messagePayload(input), replyTo: input.messageId },
        correlationId: input.correlationId,
        useNonce: false,
      })
    },

    /**
     * @param {{
     *   operationId: string,
     *   accountId: string,
     *   channelId: string,
     *   messageId: string,
     *   content?: string,
     *   components?: unknown[],
     *   componentsV2?: boolean,
     *   embeds?: unknown[],
     *   allowedMentions?: object,
     *   correlationId?: string,
     * }} input
     */
    async editMessage(input) {
      return outbox.enqueue({
        operationId: input.operationId,
        accountId: input.accountId,
        operationType: 'editMessage',
        target: { channelId: input.channelId, messageId: input.messageId },
        payload: messagePayload(input),
        correlationId: input.correlationId,
        useNonce: false,
      })
    },

    /**
     * @param {{
     *   operationId: string,
     *   accountId: string,
     *   interactionId: string,
     *   ephemeral?: boolean,
     *   update?: boolean,
     *   correlationId?: string,
     * }} input
     */
    async deferInteraction(input) {
      return outbox.enqueue({
        operationId: input.operationId,
        accountId: input.accountId,
        operationType: 'deferInteraction',
        target: { interactionId: input.interactionId },
        payload: {
          ephemeral: Boolean(input.ephemeral),
          raw: { update: Boolean(input.update) },
        },
        correlationId: input.correlationId,
        useNonce: false,
      })
    },

    /**
     * @param {{
     *   operationId: string,
     *   accountId: string,
     *   interactionId: string,
     *   content?: string,
     *   components?: unknown[],
     *   componentsV2?: boolean,
     *   ephemeral?: boolean,
     *   allowedMentions?: object,
     *   correlationId?: string,
     * }} input
     */
    async followUpInteraction(input) {
      return outbox.enqueue({
        operationId: input.operationId,
        accountId: input.accountId,
        operationType: 'followUpInteraction',
        target: { interactionId: input.interactionId },
        payload: messagePayload(input),
        correlationId: input.correlationId,
        useNonce: false,
      })
    },

    /**
     * @param {{
     *   operationId: string,
     *   accountId: string,
     *   interactionId: string,
     *   content?: string,
     *   components?: unknown[],
     *   componentsV2?: boolean,
     *   allowedMentions?: object,
     *   correlationId?: string,
     * }} input
     */
    async editInteractionReply(input) {
      return outbox.enqueue({
        operationId: input.operationId,
        accountId: input.accountId,
        operationType: 'editInteractionReply',
        target: { interactionId: input.interactionId },
        payload: messagePayload(input),
        correlationId: input.correlationId,
        useNonce: false,
      })
    },

    /**
     * @param {{
     *   operationId: string,
     *   accountId: string,
     *   interactionId: string,
     *   content?: string,
     *   components?: unknown[],
     *   componentsV2?: boolean,
     *   allowedMentions?: object,
     *   correlationId?: string,
     * }} input
     */
    async updateInteraction(input) {
      return outbox.enqueue({
        operationId: input.operationId,
        accountId: input.accountId,
        operationType: 'updateInteraction',
        target: { interactionId: input.interactionId },
        payload: messagePayload(input),
        correlationId: input.correlationId,
        useNonce: false,
      })
    },
  }
}
