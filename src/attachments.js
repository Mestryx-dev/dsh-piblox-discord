/**
 * Safe Discord outbound attachment pipeline.
 *
 * Model tools may only pass workspace-relative paths (no absolute, no `..`).
 * Trusted service callers may also pass inline text/bytes.
 *
 * Durable semantics: after validation, attachments are staged under
 * `stagingRoot/<operation_id>/` so outbox retries re-read the same files.
 */

import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  unlinkSync,
  rmSync,
} from 'node:fs'
import { basename, join, resolve, relative, isAbsolute, sep } from 'node:path'

/** Discord bot default upload cap without boost (bytes). */
export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024
/** Max attachments per message (Discord limit). */
export const MAX_ATTACHMENTS = 10
/** Max inline text attachment for model/tool convenience. */
export const MAX_INLINE_TEXT_BYTES = 64 * 1024

/**
 * Sanitize a Discord attachment filename (basename only, bounded).
 * @param {string} name
 */
export function sanitizeFilename(name) {
  const base = basename(String(name || 'file').replace(/[\0\r\n]/g, ''))
  const cleaned = base.replace(/[^\w.\-()+ ]+/g, '_').replace(/^\.+/, '') || 'file'
  return cleaned.slice(0, 200)
}

/**
 * Reject absolute paths and path traversal. Returns normalized relative path.
 * @param {string} inputPath
 */
export function assertRelativeSafePath(inputPath) {
  const raw = String(inputPath || '').trim()
  if (!raw) {
    throw Object.assign(new Error('attachment path required'), { code: 'invalid_payload' })
  }
  if (isAbsolute(raw) || raw.includes('\0') || /^[a-zA-Z]:[\\/]/.test(raw)) {
    throw Object.assign(new Error('absolute attachment paths are forbidden'), {
      code: 'path_denied',
    })
  }
  const normalized = raw.replace(/\\/g, '/')
  const parts = normalized.split('/').filter(Boolean)
  if (parts.some((p) => p === '..')) {
    throw Object.assign(new Error('path traversal forbidden'), { code: 'path_denied' })
  }
  return parts.join('/')
}

/**
 * Resolve a relative path under attachmentRoot.
 * @param {string} attachmentRoot
 * @param {string} relativePath
 */
export function resolveUnderRoot(attachmentRoot, relativePath) {
  const root = resolve(String(attachmentRoot || ''))
  const rel = assertRelativeSafePath(relativePath)
  const full = resolve(root, rel)
  const relCheck = relative(root, full)
  if (!relCheck || relCheck.startsWith('..') || isAbsolute(relCheck)) {
    throw Object.assign(new Error('path escapes attachment root'), { code: 'path_denied' })
  }
  return full
}

/**
 * Guess a coarse MIME from filename extension.
 * @param {string} filename
 */
export function guessContentType(filename) {
  const lower = String(filename || '').toLowerCase()
  if (lower.endsWith('.txt')) return 'text/plain'
  if (lower.endsWith('.md')) return 'text/markdown'
  if (lower.endsWith('.json')) return 'application/json'
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.pdf')) return 'application/pdf'
  return 'application/octet-stream'
}

/**
 * Normalize one attachment input into a staged outbox descriptor.
 *
 * @param {unknown} input
 * @param {{
 *   attachmentRoot: string,
 *   stagingRoot: string,
 *   operationId: string,
 *   index: number,
 *   maxBytes?: number,
 * }} opts
 * @returns {{
 *   filename: string,
 *   contentType: string,
 *   bytes: number,
 *   stagingRelPath: string,
 * }}
 */
export function materializeAttachment(input, opts) {
  const maxBytes = opts.maxBytes ?? MAX_ATTACHMENT_BYTES
  if (!input || typeof input !== 'object') {
    throw Object.assign(new Error('invalid attachment'), { code: 'invalid_payload' })
  }
  const src = /** @type {Record<string, unknown>} */ (input)
  const filename = sanitizeFilename(
    String(src.filename || src.name || (typeof src.path === 'string' ? basename(src.path) : 'file')),
  )
  const contentType =
    typeof src.contentType === 'string' && src.contentType
      ? String(src.contentType).slice(0, 120)
      : guessContentType(filename)

  /** @type {Buffer} */
  let buf
  if (typeof src.text === 'string') {
    buf = Buffer.from(src.text, 'utf8')
    if (buf.length > MAX_INLINE_TEXT_BYTES) {
      throw Object.assign(new Error('inline text attachment too large'), {
        code: 'attachment_too_large',
      })
    }
  } else if (typeof src.contentBase64 === 'string') {
    buf = Buffer.from(src.contentBase64, 'base64')
  } else if (Buffer.isBuffer(src.buffer)) {
    buf = src.buffer
  } else if (typeof src.path === 'string') {
    const full = resolveUnderRoot(opts.attachmentRoot, src.path)
    if (!existsSync(full)) {
      throw Object.assign(new Error(`attachment file not found: ${src.path}`), {
        code: 'unknown_target',
      })
    }
    buf = readFileSync(full)
  } else {
    throw Object.assign(
      new Error('attachment requires path, text, contentBase64, or buffer'),
      { code: 'invalid_payload' },
    )
  }

  if (buf.length <= 0) {
    throw Object.assign(new Error('empty attachment'), { code: 'invalid_payload' })
  }
  if (buf.length > maxBytes) {
    throw Object.assign(new Error(`attachment exceeds ${maxBytes} bytes`), {
      code: 'attachment_too_large',
    })
  }

  const stagingDir = join(opts.stagingRoot, sanitizeFilename(opts.operationId).replace(/[^\w.\-]+/g, '_'))
  mkdirSync(stagingDir, { recursive: true })
  const stagingName = `${opts.index}_${filename}`
  const stagingAbs = join(stagingDir, stagingName)
  writeFileSync(stagingAbs, buf)
  const stagingRelPath = relative(opts.stagingRoot, stagingAbs).split(sep).join('/')

  return {
    filename,
    contentType,
    bytes: buf.length,
    stagingRelPath,
  }
}

/**
 * @param {unknown[]} attachments
 * @param {{
 *   attachmentRoot: string,
 *   stagingRoot: string,
 *   operationId: string,
 *   maxBytes?: number,
 * }} opts
 */
export function materializeAttachments(attachments, opts) {
  if (!Array.isArray(attachments) || attachments.length === 0) return []
  if (attachments.length > MAX_ATTACHMENTS) {
    throw Object.assign(new Error(`max ${MAX_ATTACHMENTS} attachments`), {
      code: 'invalid_payload',
    })
  }
  return attachments.map((a, index) => materializeAttachment(a, { ...opts, index }))
}

/**
 * Load staged attachment bytes for transport send.
 * @param {string} stagingRoot
 * @param {{ stagingRelPath: string, filename: string, contentType?: string, bytes?: number }} desc
 */
export function loadStagedAttachment(stagingRoot, desc) {
  const rel = assertRelativeSafePath(desc.stagingRelPath)
  const full = resolveUnderRoot(stagingRoot, rel)
  if (!existsSync(full)) {
    throw Object.assign(new Error(`staged attachment missing: ${rel}`), {
      code: 'unknown_target',
    })
  }
  const data = readFileSync(full)
  return {
    name: sanitizeFilename(desc.filename || basename(rel)),
    contentType: desc.contentType || guessContentType(desc.filename || ''),
    data,
  }
}

/**
 * Best-effort cleanup of staged files for one operation.
 * @param {string} stagingRoot
 * @param {string} operationId
 */
export function cleanupStagedOperation(stagingRoot, operationId) {
  const dir = join(
    stagingRoot,
    sanitizeFilename(operationId).replace(/[^\w.\-]+/g, '_'),
  )
  try {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
}

/**
 * Remove a single staged file path (relative).
 * @param {string} stagingRoot
 * @param {string} stagingRelPath
 */
export function cleanupStagedFile(stagingRoot, stagingRelPath) {
  try {
    const full = resolveUnderRoot(stagingRoot, stagingRelPath)
    if (existsSync(full)) unlinkSync(full)
  } catch {
    /* ignore */
  }
}
