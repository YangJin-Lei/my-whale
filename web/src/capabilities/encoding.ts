const CJK_RE = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g
const REPLACEMENT_RE = /\uFFFD/g

export const stripBomAndNormalize = (text: string): string => {
  const withoutBom = text.startsWith('\uFEFF') ? text.slice(1) : text
  const normalized = withoutBom.replace(/\r\n?/g, '\n')
  let out = ''
  let lastClean = 0
  for (let i = 0; i < normalized.length; i += 1) {
    const code = normalized.charCodeAt(i)
    const isUnsafeControl = code === 0x7f || (code < 0x20 && code !== 0x09 && code !== 0x0a)
    if (isUnsafeControl) {
      if (i > lastClean) {
        out += normalized.slice(lastClean, i)
      }
      lastClean = i + 1
    }
  }
  return lastClean === 0 ? normalized : `${out}${normalized.slice(lastClean)}`
}

export const looksBinaryBytes = (bytes: Uint8Array): boolean => {
  if (bytes.length === 0) {
    return false
  }
  // UTF-16 BOM 合法包含 0x00 字节，不能误判为二进制文件
  if (
    bytes.length >= 2 &&
    ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff))
  ) {
    return false
  }
  const sampleLen = Math.min(bytes.length, 8192)
  let controlCount = 0
  for (let i = 0; i < sampleLen; i += 1) {
    const b = bytes[i]
    if (b === 0) {
      return true
    }
    if ((b < 0x09 || (b > 0x0d && b < 0x20)) && b !== 0x1b) {
      controlCount += 1
    }
  }
  return controlCount / sampleLen > 0.08
}

const normalizeCharsetName = (raw?: string): string | undefined => {
  if (!raw) {
    return undefined
  }
  const cleaned = raw.trim().toLowerCase().replace(/['"]/g, '')
  if (cleaned === 'gbk' || cleaned === 'gb2312' || cleaned === 'cp936') {
    return 'gb18030'
  }
  if (cleaned === 'utf8') {
    return 'utf-8'
  }
  return cleaned || undefined
}

export const detectDeclaredCharset = (bytes: Uint8Array): string | undefined => {
  const head = new TextDecoder('ascii').decode(bytes.subarray(0, Math.min(bytes.length, 1024)))
  const xmlMatch = /<\?xml[^>]+encoding=["']([^"']+)["']/i.exec(head)
  if (xmlMatch?.[1]) {
    return normalizeCharsetName(xmlMatch[1])
  }
  const metaMatch = /charset=["']?([a-zA-Z0-9_-]+)/i.exec(head)
  if (metaMatch?.[1]) {
    return normalizeCharsetName(metaMatch[1])
  }
  return undefined
}

const tryDecode = (
  bytes: Uint8Array,
  label: string,
  fatal: boolean
): { text: string; score: number } | null => {
  try {
    const text = new TextDecoder(label, { fatal }).decode(bytes)
    const sample = text.length > 16_384 ? text.slice(0, 16_384) : text
    const replacements = sample.match(REPLACEMENT_RE)?.length ?? 0
    const cjk = sample.match(CJK_RE)?.length ?? 0
    const score = cjk * 3 - replacements * 50
    return { text, score }
  } catch {
    return null
  }
}

export const decodeSmartText = (
  bytes: Uint8Array,
  preferredCharset?: string
): { text: string; encoding: string } => {
  if (bytes.length === 0) {
    return { text: '', encoding: 'utf-8' }
  }

  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    const decoded = new TextDecoder('utf-8').decode(bytes.subarray(3))
    return { text: stripBomAndNormalize(decoded), encoding: 'utf-8' }
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    const decoded = new TextDecoder('utf-16le').decode(bytes.subarray(2))
    return { text: stripBomAndNormalize(decoded), encoding: 'utf-16le' }
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    const decoded = new TextDecoder('utf-16be').decode(bytes.subarray(2))
    return { text: stripBomAndNormalize(decoded), encoding: 'utf-16be' }
  }

  const normalizedPref = normalizeCharsetName(preferredCharset)
  if (normalizedPref && normalizedPref !== 'utf-8') {
    const prefDecoded = tryDecode(bytes, normalizedPref, true)
    if (prefDecoded) {
      return { text: stripBomAndNormalize(prefDecoded.text), encoding: normalizedPref }
    }
  }

  const utf8Strict = tryDecode(bytes, 'utf-8', true)
  if (utf8Strict) {
    return { text: stripBomAndNormalize(utf8Strict.text), encoding: 'utf-8' }
  }

  const candidates = ['gb18030', 'big5', 'shift_jis', 'windows-1252']
  let best: { text: string; encoding: string; score: number } | null = null
  for (const label of candidates) {
    const strict = tryDecode(bytes, label, true)
    const attempt = strict ?? tryDecode(bytes, label, false)
    if (!attempt) {
      continue
    }
    const bonus = strict ? 100 : 0
    const score = attempt.score + bonus
    if (!best || score > best.score) {
      best = { text: attempt.text, encoding: label, score }
    }
  }

  if (best) {
    return { text: stripBomAndNormalize(best.text), encoding: best.encoding }
  }

  const fallback = new TextDecoder('utf-8').decode(bytes)
  return { text: stripBomAndNormalize(fallback), encoding: 'utf-8' }
}

export const arrayBufferToBase64 = (input: ArrayBuffer | Uint8Array): string => {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  const chunkSize = 8192
  const parts: string[] = []
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize)
    parts.push(String.fromCharCode(...slice))
  }
  return btoa(parts.join(''))
}
