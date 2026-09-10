/**
 * Test double for ctx.agentPresets (webhook-parity surface).
 * @param {string[] | { roster?: string[], broken?: Record<string, string>, defaultId?: string }} [opts]
 */
export function createMockAgentPresets(opts = {}) {
  const roster = Array.isArray(opts) ? opts : opts.roster || ['standard', 'vega', 'minimal']
  const broken = (!Array.isArray(opts) && opts.broken) || {}
  const defaultId = (!Array.isArray(opts) && opts.defaultId) || roster[0]
  /** @type {Array<{ id: string, agentId?: string }>} */
  const mounts = []

  return {
    mounts,
    async resolve(id) {
      const key = String(id)
      if (!roster.includes(key)) {
        throw Object.assign(new Error(`unknown agent preset: ${key}`), { code: 'not_found' })
      }
      if (broken[key]) {
        return { id: key, broken: broken[key] }
      }
      return { id: key }
    },
    async mount(agentCtx, id) {
      mounts.push({ id: String(id), agentId: agentCtx?.agent?.id })
    },
    async standingKeyFor(id) {
      return `standing:${id}`
    },
    async remoteExportList() {
      return {
        authorable: false,
        presets: roster.map((id) => ({
          id,
          trust: 'user',
          isDefault: id === defaultId,
          ...(broken[id] ? { broken: broken[id] } : {}),
        })),
      }
    },
    async list() {
      return roster.map((id) => ({ id }))
    },
  }
}
