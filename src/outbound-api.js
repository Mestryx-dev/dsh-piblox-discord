/**
 * Consumer/tool outbound API — always via DeliveryOutbox.
 * Future discord.message.send / reply / edit tools call this surface.
 */

/**
 * @param {{ outbox: ReturnType<import('./outbox/index.js').createDeliveryOutbox> }} deps
 */
export function createOutboundApi(deps) {
  const { outbox } = deps
  if (!outbox) throw new Error('createOutboundApi: outbox required')

  return {
    /**
     * @param {{
     *   operationId: string,
     *   accountId: string,
     *   channelId: string,
     *   content?: string,
     *   components?: unknown[],
     *   correlationId?: string,
     * }} input
     */
    async sendMessage(input) {
      return outbox.enqueue({
        operationId: input.operationId,
        accountId: input.accountId,
        operationType: 'sendMessage',
        target: { channelId: input.channelId },
        payload: { content: input.content, components: input.components },
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
     *   correlationId?: string,
     * }} input
     */
    async replyMessage(input) {
      return outbox.enqueue({
        operationId: input.operationId,
        accountId: input.accountId,
        operationType: 'replyMessage',
        target: { channelId: input.channelId, messageId: input.messageId },
        payload: { content: input.content, replyTo: input.messageId },
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
     *   correlationId?: string,
     * }} input
     */
    async editMessage(input) {
      return outbox.enqueue({
        operationId: input.operationId,
        accountId: input.accountId,
        operationType: 'editMessage',
        target: { channelId: input.channelId, messageId: input.messageId },
        payload: { content: input.content },
        correlationId: input.correlationId,
        useNonce: false,
      })
    },
  }
}
