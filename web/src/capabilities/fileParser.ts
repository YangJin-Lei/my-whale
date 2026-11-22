import {
  arrayBufferToBase64,
  decodeSmartText,
  detectDeclaredCharset,
  looksBinaryBytes,
} from './encoding.js'
import {
  parseCsvText,
  parseDocxBytes,
  parseEpubBytes,
  parsePdfBytes,
  parsePptxBytes,
  parseRtfBytes,
  parseXlsxBytes,
} from './formats.js'
import { extractArchiveToMarkdown, wrapSafeCodeFence } from './zipExtractor.js'

const MAX_INLINE_IMAGE_BYTES = 10 * 1024 * 1024
const MAX_SINGLE_DOC_CHARS = 48_000

const VISION_RASTER_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif'])
const ARCHIVE_EXTS = new Set(['zip', 'tar', 'gz', 'tgz'])
const STRUCTURED_EXTS = new Set([
  'docx',
  'xlsx',
  'pptx',
  'epub',
  'pdf',
  'rtf',
  'csv',
  'tsv',
  ...ARCHIVE_EXTS,
])

const CODE_FENCE_LANG_BY_EXT: Record<string, string> = {
  ts: 'ts',
  tsx: 'tsx',
  js: 'js',
  mjs: 'js',
  cjs: 'js',
  jsx: 'jsx',
  py: 'python',
  py3: 'python',
  rs: 'rust',
  go: 'go',
  java: 'java',
  kt: 'kotlin',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  cs: 'csharp',
  php: 'php',
  rb: 'ruby',
  swift: 'swift',
  sh: 'bash',
  ps1: 'powershell',
  sql: 'sql',
  html: 'html',
  htm: 'html',
  xhtml: 'html',
  xml: 'xml',
  svg: 'xml',
  css: 'css',
  scss: 'scss',
  less: 'less',
  json: 'json',
  jsonl: 'jsonl',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  ini: 'ini',
  md: 'markdown',
  markdown: 'markdown',
  txt: 'text',
  log: 'text',
}

export type ParsedAttachment =
  | { kind: 'image'; mimeType: string; base64: string; name: string }
  | { kind: 'text'; text: string; rawBody: string; truncated: boolean; name: string }

const parsedCache = new Map<string, ParsedAttachment>()

export const getCachedParsedAttachment = (key: string): ParsedAttachment | undefined =>
  parsedCache.get(key)

export const setCachedParsedAttachment = (key: string, value: ParsedAttachment) => {
  parsedCache.set(key, value)
}

export const clearParsedAttachmentCache = () => {
  parsedCache.clear()
}

export const getFileExtension = (name: string): string => {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

const hasMagicPrefix = (bytes: Uint8Array, sig: number[]): boolean => {
  if (bytes.length < sig.length) {
    return false
  }
  for (let i = 0; i < sig.length; i += 1) {
    if (bytes[i] !== sig[i]) {
      return false
    }
  }
  return true
}

const parseBytesCore = (
  bytes: Uint8Array,
  name: string,
  depth = 0
):
  | { ok: true; content: string; fenceLang?: string; formatLabel: string }
  | { ok: false; reason: string } => {
  const ext = getFileExtension(name)

  // Magic bytes detection protects against misnamed files (e.g. .doc saved as OOXML/RTF/HTML)
  const isZipMagic = hasMagicPrefix(bytes, [0x50, 0x4b, 0x03, 0x04])
  const isPdfMagic = hasMagicPrefix(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])
  const isOle2Magic = hasMagicPrefix(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
  const asciiHead = new TextDecoder('latin1')
    .decode(bytes.subarray(0, Math.min(bytes.length, 64)))
    .trimStart()

  if (ARCHIVE_EXTS.has(ext) || (ext === '' && isZipMagic)) {
    const archiveExt = ARCHIVE_EXTS.has(ext) ? ext : 'zip'
    const md = extractArchiveToMarkdown(
      bytes,
      archiveExt,
      name,
      (innerBytes, innerPath, nextDepth) => parseBytesCore(innerBytes, innerPath, nextDepth),
      depth
    )
    return { ok: true, content: md, formatLabel: `${archiveExt.toUpperCase()} 压缩包` }
  }

  if (ext === 'docx' || (ext === 'doc' && isZipMagic)) {
    return { ok: true, content: parseDocxBytes(bytes), formatLabel: 'Word 文档' }
  }
  if (ext === 'xlsx' || (ext === 'xls' && isZipMagic)) {
    return { ok: true, content: parseXlsxBytes(bytes), formatLabel: 'Excel 表格' }
  }
  if (ext === 'pptx' || (ext === 'ppt' && isZipMagic)) {
    return { ok: true, content: parsePptxBytes(bytes), formatLabel: 'PPT 演示文稿' }
  }
  if (ext === 'epub') {
    return { ok: true, content: parseEpubBytes(bytes), formatLabel: 'EPUB 电子书' }
  }
  if (ext === 'pdf' || isPdfMagic) {
    return { ok: true, content: parsePdfBytes(bytes), formatLabel: 'PDF 文档' }
  }
  if (ext === 'rtf' || asciiHead.startsWith('{\\rtf')) {
    return { ok: true, content: parseRtfBytes(bytes), formatLabel: 'RTF 文档' }
  }

  if ((ext === 'doc' || ext === 'xls' || ext === 'ppt') && isOle2Magic) {
    return {
      ok: false,
      reason: `旧版二进制 .${ext} 格式暂不支持纯本地解析，请另存为 .${ext}x / .pdf 后再导入，或切换官方 DeepSeek`,
    }
  }

  if (VISION_RASTER_EXTS.has(ext) || ext === 'bmp' || ext === 'ico' || ext === 'avif') {
    return { ok: false, reason: `图片资源 (${Math.round(bytes.length / 1024)} KB)` }
  }

  const isDeclaredTextExt = Object.hasOwn(CODE_FENCE_LANG_BY_EXT, ext)
  if (!isDeclaredTextExt && looksBinaryBytes(bytes)) {
    return { ok: false, reason: `二进制文件（${Math.round(bytes.length / 1024)} KB）` }
  }

  const declaredCharset = detectDeclaredCharset(bytes)
  const decoded = decodeSmartText(bytes, declaredCharset)

  if (ext === 'csv') {
    return { ok: true, content: parseCsvText(decoded.text, ','), formatLabel: 'CSV 表格' }
  }
  if (ext === 'tsv') {
    return { ok: true, content: parseCsvText(decoded.text, '\t'), formatLabel: 'TSV 表格' }
  }
  if (ext === 'json') {
    try {
      const pretty = JSON.stringify(JSON.parse(decoded.text), null, 2)
      return { ok: true, content: pretty, fenceLang: 'json', formatLabel: 'JSON 数据' }
    } catch {
      return { ok: true, content: decoded.text, fenceLang: 'json', formatLabel: 'JSON 文本' }
    }
  }

  const fenceLang = CODE_FENCE_LANG_BY_EXT[ext] ?? ''
  const label = ext ? `${ext.toUpperCase()} 文件` : '文本文件'
  return { ok: true, content: decoded.text, fenceLang, formatLabel: label }
}

const formatHumanSize = (bytes: number): string => {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

export const formatParsedDocumentForModel = (params: {
  name: string
  formatLabel: string
  byteLength: number
  rawBody: string
  fenceLang?: string
}): { text: string; truncated: boolean } => {
  let body = params.rawBody
  let truncated = false
  if (body.length > MAX_SINGLE_DOC_CHARS) {
    body = body.slice(0, MAX_SINGLE_DOC_CHARS)
    truncated = true
  }
  const wrapped = params.fenceLang !== undefined ? wrapSafeCodeFence(body, params.fenceLang) : body
  const metaParts = [
    `附件：${params.name}`,
    `类型：${params.formatLabel}`,
    `体积：${formatHumanSize(params.byteLength)}`,
  ]
  if (truncated) {
    metaParts.push(`已截取前 ${MAX_SINGLE_DOC_CHARS} 字符`)
  }
  const header = `--- ${metaParts.join(' | ')} ---`
  const footer = `--- 附件结束：${params.name} ---`
  return {
    text: `${header}\n\n${wrapped}\n\n${footer}`,
    truncated,
  }
}

export const parseDocumentBytes = (
  bytes: Uint8Array,
  name: string,
  mimeType = ''
): ParsedAttachment => {
  const ext = getFileExtension(name)
  const isVisionImage =
    (VISION_RASTER_EXTS.has(ext) || /^image\/(?:png|jpeg|jpg|webp|gif)$/i.test(mimeType)) &&
    ext !== 'svg' &&
    bytes.length <= MAX_INLINE_IMAGE_BYTES

  if (isVisionImage) {
    const resolvedMime =
      mimeType && mimeType.startsWith('image/')
        ? mimeType === 'image/jpg'
          ? 'image/jpeg'
          : mimeType
        : `image/${ext === 'jpg' ? 'jpeg' : ext || 'png'}`
    return {
      kind: 'image',
      mimeType: resolvedMime,
      base64: arrayBufferToBase64(bytes),
      name,
    }
  }

  const result = parseBytesCore(bytes, name, 0)
  if (!result.ok) {
    if (STRUCTURED_EXTS.has(ext) || ext === 'doc' || ext === 'xls' || ext === 'ppt') {
      throw new Error(result.reason)
    }
    throw new Error(`暂不支持解析二进制文件「${name}」（${result.reason}）`)
  }

  const formatted = formatParsedDocumentForModel({
    name,
    formatLabel: result.formatLabel,
    byteLength: bytes.length,
    rawBody: result.content,
    fenceLang: result.fenceLang,
  })
  return {
    kind: 'text',
    text: formatted.text,
    rawBody: result.content,
    truncated: formatted.truncated,
    name,
  }
}

const readBlobBytes = async (blob: Blob): Promise<Uint8Array> => {
  if (typeof blob.arrayBuffer === 'function') {
    return new Uint8Array(await blob.arrayBuffer())
  }
  return new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(new Uint8Array(reader.result))
      } else {
        reject(new Error('无法读取附件二进制内容'))
      }
    }
    reader.onerror = () => reject(reader.error ?? new Error('读取附件失败'))
    reader.readAsArrayBuffer(blob)
  })
}

export const parseAttachmentLocally = async (
  blob: Blob,
  name: string,
  mimeType = '',
  cacheKey?: string
): Promise<ParsedAttachment> => {
  if (cacheKey) {
    const hit = parsedCache.get(cacheKey)
    if (hit) {
      return hit
    }
  }
  const bytes = await readBlobBytes(blob)
  const parsed = parseDocumentBytes(bytes, name, mimeType || blob.type)
  if (cacheKey) {
    parsedCache.set(cacheKey, parsed)
  }
  return parsed
}

export const shouldPreparseForOfficialUpload = (name: string, isImage: boolean): boolean => {
  if (isImage) {
    return false
  }
  const ext = getFileExtension(name)
  return (
    ext === 'zip' ||
    ext === 'tar' ||
    ext === 'gz' ||
    ext === 'tgz' ||
    ext === 'epub' ||
    ext === 'rtf'
  )
}
