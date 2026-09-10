/**
 * Deterministic Discord thread name from first user message (no LLM).
 * Discord thread names are capped at 100 characters.
 */

export const DISCORD_THREAD_NAME_MAX = 100
export const DEFAULT_THREAD_NAME = 'Conversation'

/**
 * @param {unknown} content
 * @param {{ fallback?: string, maxLen?: number }} [opts]
 * @returns {string}
 */
export function threadNameFromContent(content, opts = {}) {
  const maxLen = opts.maxLen != null ? Number(opts.maxLen) : DISCORD_THREAD_NAME_MAX
  const fallback = opts.fallback != null ? String(opts.fallback) : DEFAULT_THREAD_NAME
  const text = typeof content === 'string' ? content : ''
  const line =
    text
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find((s) => s.length > 0) || ''
  const cleaned = line.replace(/\s+/g, ' ').trim()
  const base = cleaned || fallback
  if (base.length <= maxLen) return base
  // Prefer word boundary when truncating
  const sliced = base.slice(0, maxLen)
  const lastSpace = sliced.lastIndexOf(' ')
  if (lastSpace >= Math.floor(maxLen * 0.6)) {
    return sliced.slice(0, lastSpace).trimEnd() || sliced
  }
  return sliced
}
