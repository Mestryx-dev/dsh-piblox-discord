/**
 * MessageSource mapping for Discord inbound → createUserMessage.
 *
 * OBSERVED (@deepseek-ai/dsh-llm MessageSourceMap):
 *   user | plugin | model | tool  (merge-extensible; webhook adds its own kind)
 *
 * V1 LOCKED choice: kind 'user' — Core does not ship a first-class `discord` kind.
 * Discord identity rides on ConversationBinding + platform event metadata, not
 * MessageSource.kind. Do not invent unsupported enum values.
 */

/**
 * @param {string} text
 * @param {{ accountId?: string, channelId?: string, messageId?: string }} [meta]
 */
export function createDiscordUserMessage(text, meta = {}) {
  void meta
  return {
    content: [{ type: 'text', text: String(text ?? '') }],
    source: { kind: 'user' },
  }
}

/**
 * Prefer host-provided createUserMessage when available (real DSH llm package).
 * Falls back to local shape-compatible builder for FakeTransport spike tests.
 * @param {((input: { content: unknown, source: unknown }) => unknown) | undefined} hostCreate
 * @param {string} text
 * @param {object} [meta]
 */
export function buildFollowupMessage(hostCreate, text, meta) {
  const local = createDiscordUserMessage(text, meta)
  if (typeof hostCreate === 'function') {
    return hostCreate(local)
  }
  return local
}
