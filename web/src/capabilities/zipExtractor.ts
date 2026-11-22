import { gunzipSync, unzipSync } from 'fflate'
import { decodeSmartText } from './encoding.js'

const MAX_ARCHIVE_FILES = 80
const MAX_TOTAL_RAW_BYTES = 24 * 1024 * 1024
const MAX_PER_FILE_CHARS = 24_000
const MAX_ARCHIVE_CHARS = 100_000

const IGNORED_PATH_SEGMENTS = new Set(['__MACOSX', '.git', 'node_modules', '.svn'])
const IGNORED_BASENAMES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini'])

export type ArchiveParsedEntry = {
  path: string
  content: string
  fenceLang?: string
  truncated?: boolean
}

export type ArchiveEntryReader = (
  bytes: Uint8Array,
  entryPath: string,
  depth: number
) => { ok: true; content: string; fenceLang?: string } | { ok: false; reason: string }

/** 修复中文 Windows 压缩包内 GBK/CP936 路径被按 Latin1 读出导致的乱码 */
export const fixArchiveEntryName = (rawName: string): string => {
  let hasNonAsciiLatin1 = false
  const rawBytes = new Uint8Array(rawName.length)
  for (let i = 0; i < rawName.length; i += 1) {
    const code = rawName.charCodeAt(i)
    if (code > 0xff) {
      return rawName
    }
    if (code >= 0x80) {
      hasNonAsciiLatin1 = true
    }
    rawBytes[i] = code
  }
  if (!hasNonAsciiLatin1) {
    return rawName
  }
  return decodeSmartText(rawBytes).text
}

const isIgnoredArchivePath = (entryPath: string): boolean => {
  const normalized = entryPath.replace(/\\/g, '/').trim()
  if (!normalized || normalized.endsWith('/')) {
    return true
  }
  const parts = normalized.split('/').filter(Boolean)
  const base = parts.at(-1) ?? ''
  if (IGNORED_BASENAMES.has(base)) {
    return true
  }
  return parts.some((seg) => IGNORED_PATH_SEGMENTS.has(seg))
}

/** 根据文本中出现的最大连续反引号数量生成安全围栏，避免代码内含 ``` 时截断 Markdown */
export const wrapSafeCodeFence = (content: string, lang = ''): string => {
  let maxRun = 2
  const re = /`+/g
  for (let m = re.exec(content); m !== null; m = re.exec(content)) {
    if (m[0].length > maxRun) {
      maxRun = m[0].length
    }
  }
  const fence = '`'.repeat(maxRun + 1)
  return `${fence}${lang}\n${content}\n${fence}`
}

const parseTarEntries = (tarBytes: Uint8Array): Record<string, Uint8Array> => {
  const result: Record<string, Uint8Array> = {}
  let offset = 0
  while (offset + 512 <= tarBytes.length) {
    const header = tarBytes.subarray(offset, offset + 512)
    const isZeroBlock = header.every((b) => b === 0)
    if (isZeroBlock) {
      break
    }
    const readStr = (start: number, len: number) => {
      const slice = header.subarray(start, start + len)
      const zeroIdx = slice.indexOf(0)
      const end = zeroIdx === -1 ? slice.length : zeroIdx
      return decodeSmartText(slice.subarray(0, end)).text.trim()
    }
    const name = readStr(0, 100)
    const sizeOctal = readStr(124, 12).replace(/[^0-7]/g, '')
    const typeFlag = String.fromCharCode(header[156] || 48)
    const prefix = readStr(345, 155)
    const fullPath = prefix ? `${prefix}/${name}` : name
    const fileSize = sizeOctal ? Number.parseInt(sizeOctal, 8) : 0
    offset += 512
    const dataEnd = Math.min(tarBytes.length, offset + fileSize)
    if (fullPath && (typeFlag === '0' || typeFlag === '\0') && fileSize >= 0) {
      result[fullPath] = tarBytes.subarray(offset, dataEnd)
    }
    offset += Math.ceil(fileSize / 512) * 512
  }
  return result
}

const extractRawArchiveMap = (
  bytes: Uint8Array,
  ext: string,
  fileName: string
): Record<string, Uint8Array> => {
  if (ext === 'zip') {
    return unzipSync(bytes)
  }
  if (ext === 'tar') {
    return parseTarEntries(bytes)
  }
  if (ext === 'tgz' || (ext === 'gz' && /\.tar\.gz$/i.test(fileName))) {
    return parseTarEntries(gunzipSync(bytes))
  }
  if (ext === 'gz') {
    const inner = gunzipSync(bytes)
    const innerName = fileName.replace(/\.gz$/i, '') || 'decompressed.txt'
    return { [innerName]: inner }
  }
  throw new Error(`Unsupported archive extension: ${ext}`)
}

export const extractArchiveToMarkdown = (
  bytes: Uint8Array,
  ext: string,
  archiveName: string,
  readEntry: ArchiveEntryReader,
  depth = 0
): string => {
  if (depth > 2) {
    return `[压缩包嵌套超过 2 层，已跳过展开：${archiveName}]`
  }

  let rawMap: Record<string, Uint8Array>
  try {
    rawMap = extractRawArchiveMap(bytes, ext, archiveName)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(
      `无法解压 ${archiveName}（可能文件损坏或使用了暂不支持的加密/压缩格式）：${reason}`
    )
  }

  const normalizedEntries: Array<{ path: string; bytes: Uint8Array }> = []
  let totalRawBytes = 0

  for (const [rawKey, data] of Object.entries(rawMap)) {
    const cleanPath = fixArchiveEntryName(rawKey).replace(/^\/+/, '')
    if (isIgnoredArchivePath(cleanPath)) {
      continue
    }
    totalRawBytes += data.length
    if (totalRawBytes > MAX_TOTAL_RAW_BYTES) {
      break
    }
    normalizedEntries.push({ path: cleanPath, bytes: data })
  }

  normalizedEntries.sort((a, b) => a.path.localeCompare(b.path))
  if (normalizedEntries.length === 0) {
    return `[压缩包 ${archiveName} 为空或仅包含系统隐藏文件]`
  }

  const treeLines = normalizedEntries.slice(0, MAX_ARCHIVE_FILES).map((item) => `- ${item.path}`)
  if (normalizedEntries.length > MAX_ARCHIVE_FILES) {
    treeLines.push(`- ...（另有 ${normalizedEntries.length - MAX_ARCHIVE_FILES} 个文件未展开）`)
  }

  const extractedBlocks: string[] = []
  const skippedList: string[] = []
  let totalChars = 0

  for (const item of normalizedEntries.slice(0, MAX_ARCHIVE_FILES)) {
    if (totalChars >= MAX_ARCHIVE_CHARS) {
      skippedList.push(`${item.path}（已达到归档文本总量上限）`)
      continue
    }
    const parsed = readEntry(item.bytes, item.path, depth + 1)
    if (!parsed.ok) {
      skippedList.push(`${item.path}（${parsed.reason}）`)
      continue
    }
    let body = parsed.content
    let truncatedNote = ''
    const remainingBudget = Math.min(MAX_PER_FILE_CHARS, MAX_ARCHIVE_CHARS - totalChars)
    if (body.length > remainingBudget) {
      body = body.slice(0, Math.max(0, remainingBudget))
      truncatedNote = `\n> [该文件已按安全长度截取前 ${body.length} 字符]`
    }
    const formatted =
      parsed.fenceLang !== undefined ? wrapSafeCodeFence(body, parsed.fenceLang) : body
    extractedBlocks.push(`### 文件：${item.path}\n\n${formatted}${truncatedNote}`)
    totalChars += formatted.length
  }

  const parts = [
    `## 压缩包目录（共 ${normalizedEntries.length} 个文件，已解析 ${extractedBlocks.length} 个）`,
    treeLines.join('\n'),
  ]
  if (skippedList.length > 0) {
    parts.push(`## 跳过的文件\n${skippedList.map((s) => `- ${s}`).join('\n')}`)
  }
  if (extractedBlocks.length > 0) {
    parts.push(`## 文件内容\n\n${extractedBlocks.join('\n\n')}`)
  }
  return parts.join('\n\n')
}
