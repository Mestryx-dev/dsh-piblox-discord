/**
 * Discord Components V2 — forward-compatible component tree model + encode.
 * Canonical internal representation is ComponentNode[], not legacy ActionRow objects.
 */

import { createHash, randomBytes } from 'node:crypto'

/** Discord custom_id max length (API v10). */
export const DISCORD_CUSTOM_ID_MAX = 100

/** Opaque custom-id scheme prefix (no secrets / no session transcript). */
export const CUSTOM_ID_SCHEME = 'dsh1'

/**
 * Discord MessageFlags.IsComponentsV2 (1 << 15).
 * When set, top-level message `content`/`embeds` are not used — use TextDisplay nodes.
 */
export const MESSAGE_FLAG_IS_COMPONENTS_V2 = 1 << 15

/** Discord ComponentType numeric ids (API v10 / discord.js 14.x). */
export const DISCORD_COMPONENT_TYPE = Object.freeze({
  ActionRow: 1,
  Button: 2,
  StringSelect: 3,
  TextInput: 4,
  UserSelect: 5,
  RoleSelect: 6,
  MentionableSelect: 7,
  ChannelSelect: 8,
  Section: 9,
  TextDisplay: 10,
  Thumbnail: 11,
  MediaGallery: 12,
  File: 13,
  Separator: 14,
  Container: 17,
  Label: 18,
  FileUpload: 19,
  RadioGroup: 21,
  CheckboxGroup: 22,
  Checkbox: 23,
})

/** Button styles */
export const BUTTON_STYLE = Object.freeze({
  Primary: 1,
  Secondary: 2,
  Success: 3,
  Danger: 4,
  Link: 5,
})

/**
 * V1 typed + forward-compatible kinds.
 * Select is a legacy alias for StringSelect.
 */
export const COMPONENT_KINDS = Object.freeze([
  'TextDisplay',
  'Container',
  'Section',
  'Button',
  'StringSelect',
  'UserSelect',
  'RoleSelect',
  'ChannelSelect',
  'MentionableSelect',
  'Select', // alias → StringSelect
  'File',
  'ActionRow',
  'Thumbnail',
  'MediaGallery',
  'Separator',
  'Label',
  'TextInput',
  'FileUpload',
  'RadioGroup',
  'CheckboxGroup',
  'Checkbox',
  'Unknown',
])

/**
 * @typedef {typeof COMPONENT_KINDS[number]} ComponentKind
 */

/**
 * @typedef {{
 *   kind: string,
 *   children?: ComponentNode[],
 *   text?: string,
 *   label?: string,
 *   customId?: string,
 *   style?: string | number,
 *   disabled?: boolean,
 *   url?: string,
 *   emoji?: string | { name?: string, id?: string, animated?: boolean },
 *   placeholder?: string,
 *   minValues?: number,
 *   maxValues?: number,
 *   options?: Array<{ label: string, value: string, description?: string, default?: boolean }>,
 *   accessory?: ComponentNode,
 *   spoiler?: boolean,
 *   file?: { url?: string },
 *   media?: Array<{ url?: string }>,
 *   divider?: boolean,
 *   spacing?: number,
 *   raw?: Record<string, unknown>,
 * }} ComponentNode
 */

/**
 * @param {unknown} node
 * @returns {node is ComponentNode}
 */
export function isComponentNode(node) {
  return Boolean(node && typeof node === 'object' && typeof /** @type {any} */ (node).kind === 'string')
}

/**
 * Mint an opaque custom_id within Discord's 100-char limit.
 * Format: dsh1.<intent>.<nonce>
 * No secrets, tokens, session transcripts, or policy bits.
 *
 * @param {{ intent: string, nonce?: string }} input
 * @returns {string}
 */
export function mintCustomId(input) {
  const intent = String(input.intent || 'intent')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 40) || 'intent'
  const nonce =
    input.nonce != null
      ? String(input.nonce).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24)
      : randomBytes(6).toString('hex')
  const id = `${CUSTOM_ID_SCHEME}.${intent}.${nonce}`
  if (id.length > DISCORD_CUSTOM_ID_MAX) {
    return id.slice(0, DISCORD_CUSTOM_ID_MAX)
  }
  return id
}

/**
 * @param {string | undefined | null} customId
 * @returns {{ ok: true, scheme: string, intent: string, nonce: string } | { ok: false }}
 */
export function parseCustomId(customId) {
  const raw = String(customId || '')
  const parts = raw.split('.')
  if (parts.length < 3 || parts[0] !== CUSTOM_ID_SCHEME) return { ok: false }
  return { ok: true, scheme: parts[0], intent: parts[1], nonce: parts.slice(2).join('.') }
}

/**
 * Default fail-closed allowed_mentions (no parse expansion).
 * @returns {{ parse: [] }}
 */
export function defaultAllowedMentions() {
  return { parse: [] }
}

/**
 * Encode ComponentNode tree → Discord API components array (+ optional V2 flag).
 *
 * @param {ComponentNode[] | unknown} nodes
 * @param {{ componentsV2?: boolean }} [opts]
 * @returns {{ components: object[], flags?: number, encoding: 'components_v2'|'legacy_rows'|'empty' }}
 */
export function encodeOutboundComponents(nodes, opts = {}) {
  const list = Array.isArray(nodes) ? nodes.filter(isComponentNode) : []
  if (list.length === 0) {
    return { components: [], encoding: 'empty' }
  }

  const useV2 =
    opts.componentsV2 !== false &&
    list.some((n) => isV2TopLevelKind(normalizeKind(n.kind)))

  const components = list.map((n) => encodeNode(n, { forceV2: useV2 }))

  if (useV2) {
    return {
      components,
      flags: MESSAGE_FLAG_IS_COMPONENTS_V2,
      encoding: 'components_v2',
    }
  }
  return { components, encoding: 'legacy_rows' }
}

/**
 * LAB smoke payload — TextDisplay + Button + StringSelect under Components V2.
 * @param {{ pingCustomId?: string, selectCustomId?: string }} [opts]
 */
export function buildLabInteractionSmokeMessage(opts = {}) {
  const pingCustomId = opts.pingCustomId || mintCustomId({ intent: 'smoke_ping' })
  const selectCustomId = opts.selectCustomId || mintCustomId({ intent: 'smoke_choice' })
  /** @type {ComponentNode[]} */
  const components = [
    { kind: 'TextDisplay', text: 'Interaction smoke' },
    {
      kind: 'ActionRow',
      children: [
        {
          kind: 'Button',
          customId: pingCustomId,
          label: 'Ping',
          style: 'Primary',
        },
      ],
    },
    {
      kind: 'ActionRow',
      children: [
        {
          kind: 'StringSelect',
          customId: selectCustomId,
          placeholder: 'Choice',
          options: [
            { label: 'Alpha', value: 'alpha' },
            { label: 'Beta', value: 'beta' },
            { label: 'Gamma', value: 'gamma' },
          ],
        },
      ],
    },
  ]
  return {
    components,
    allowedMentions: defaultAllowedMentions(),
    customIds: { ping: pingCustomId, select: selectCustomId },
  }
}

/**
 * Stable content fingerprint for tests (not a secret).
 * @param {string} text
 */
export function contentFingerprint(text) {
  return createHash('sha256').update(String(text || '')).digest('hex').slice(0, 12)
}

/** @param {string} kind */
function normalizeKind(kind) {
  const k = String(kind || '')
  if (k === 'Select') return 'StringSelect'
  return k
}

/** @param {string} kind */
function isV2TopLevelKind(kind) {
  return (
    kind === 'TextDisplay' ||
    kind === 'Container' ||
    kind === 'Section' ||
    kind === 'Separator' ||
    kind === 'File' ||
    kind === 'MediaGallery' ||
    kind === 'Thumbnail'
  )
}

/**
 * @param {ComponentNode} node
 * @param {{ forceV2?: boolean }} ctx
 */
function encodeNode(node, ctx) {
  const kind = normalizeKind(node.kind)

  // Opaque / future families: prefer raw Discord shape when provided
  if (kind === 'Unknown' || node.raw?.type != null) {
    return sanitizeRaw(node.raw || { type: 0, ...omitUndefined({ id: node.customId }) })
  }

  switch (kind) {
    case 'TextDisplay':
      return { type: DISCORD_COMPONENT_TYPE.TextDisplay, content: String(node.text ?? '') }
    case 'Separator':
      return {
        type: DISCORD_COMPONENT_TYPE.Separator,
        divider: node.divider !== false,
        spacing: node.spacing != null ? Number(node.spacing) : 1,
      }
    case 'File':
      return {
        type: DISCORD_COMPONENT_TYPE.File,
        file: node.file || { url: String(node.text || '') },
        spoiler: Boolean(node.spoiler),
      }
    case 'Thumbnail':
      return {
        type: DISCORD_COMPONENT_TYPE.Thumbnail,
        media: node.media?.[0] || { url: String(node.text || '') },
        description: node.label,
        spoiler: Boolean(node.spoiler),
      }
    case 'MediaGallery':
      return {
        type: DISCORD_COMPONENT_TYPE.MediaGallery,
        items: (node.media || []).map((m) => ({ media: m })),
      }
    case 'Container':
      return {
        type: DISCORD_COMPONENT_TYPE.Container,
        components: (node.children || []).map((c) => encodeNode(c, ctx)),
        spoiler: Boolean(node.spoiler),
      }
    case 'Section': {
      const out = {
        type: DISCORD_COMPONENT_TYPE.Section,
        components: (node.children || []).map((c) => encodeNode(c, ctx)),
      }
      if (node.accessory) {
        /** @type {any} */ (out).accessory = encodeNode(node.accessory, ctx)
      }
      return out
    }
    case 'ActionRow':
      return {
        type: DISCORD_COMPONENT_TYPE.ActionRow,
        components: (node.children || []).map((c) => encodeNode(c, ctx)),
      }
    case 'Button':
      return encodeButton(node)
    case 'StringSelect':
      return encodeSelect(node, DISCORD_COMPONENT_TYPE.StringSelect)
    case 'UserSelect':
      return encodeSelect(node, DISCORD_COMPONENT_TYPE.UserSelect)
    case 'RoleSelect':
      return encodeSelect(node, DISCORD_COMPONENT_TYPE.RoleSelect)
    case 'ChannelSelect':
      return encodeSelect(node, DISCORD_COMPONENT_TYPE.ChannelSelect)
    case 'MentionableSelect':
      return encodeSelect(node, DISCORD_COMPONENT_TYPE.MentionableSelect)
    case 'Label':
    case 'TextInput':
    case 'FileUpload':
    case 'RadioGroup':
    case 'CheckboxGroup':
    case 'Checkbox':
      // Representable via raw; V1 has no convenience encoder beyond passthrough
      return sanitizeRaw(
        node.raw || {
          type: DISCORD_COMPONENT_TYPE[kind] || 0,
          custom_id: node.customId,
          label: node.label || node.text,
        },
      )
    default:
      return sanitizeRaw(node.raw || { type: 0, kind })
  }
}

/** @param {ComponentNode} node */
function encodeButton(node) {
  const style =
    typeof node.style === 'number'
      ? node.style
      : BUTTON_STYLE[/** @type {keyof typeof BUTTON_STYLE} */ (node.style)] || BUTTON_STYLE.Primary
  /** @type {Record<string, unknown>} */
  const out = {
    type: DISCORD_COMPONENT_TYPE.Button,
    style,
    label: String(node.label || node.text || 'Button').slice(0, 80),
    disabled: Boolean(node.disabled),
  }
  if (style === BUTTON_STYLE.Link) {
    out.url = String(node.url || '')
  } else {
    out.custom_id = assertCustomId(node.customId)
  }
  if (node.emoji) out.emoji = node.emoji
  return out
}

/**
 * @param {ComponentNode} node
 * @param {number} type
 */
function encodeSelect(node, type) {
  /** @type {Record<string, unknown>} */
  const out = {
    type,
    custom_id: assertCustomId(node.customId),
    disabled: Boolean(node.disabled),
  }
  if (node.placeholder) out.placeholder = String(node.placeholder).slice(0, 150)
  if (node.minValues != null) out.min_values = Number(node.minValues)
  if (node.maxValues != null) out.max_values = Number(node.maxValues)
  if (type === DISCORD_COMPONENT_TYPE.StringSelect) {
    out.options = (node.options || []).slice(0, 25).map((o) => ({
      label: String(o.label).slice(0, 100),
      value: String(o.value).slice(0, 100),
      description: o.description != null ? String(o.description).slice(0, 100) : undefined,
      default: Boolean(o.default),
    }))
  }
  return out
}

/** @param {string | undefined} customId */
function assertCustomId(customId) {
  const id = String(customId || '')
  if (!id) throw new TypeError('component customId required')
  if (id.length > DISCORD_CUSTOM_ID_MAX) {
    throw new TypeError(`customId exceeds ${DISCORD_CUSTOM_ID_MAX} chars`)
  }
  if (/token|secret|bearer/i.test(id)) {
    throw new TypeError('customId must not embed secrets')
  }
  return id
}

/** @param {Record<string, unknown>} raw */
function sanitizeRaw(raw) {
  const out = { ...raw }
  // Never leak obvious secret keys from opaque nodes
  for (const k of Object.keys(out)) {
    if (/token|secret|authorization|password/i.test(k)) delete out[k]
  }
  return out
}

/** @param {Record<string, unknown>} obj */
function omitUndefined(obj) {
  /** @type {Record<string, unknown>} */
  const out = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v
  }
  return out
}
