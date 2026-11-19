import zlib from 'node:zlib'

export const MAX_DOWNLOAD_BYTES = 5 * 1024 * 1024
export const MAX_CONTENT_CHARS = 6000

const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  middot: '·',
  copy: '©',
  reg: '®',
  trade: '™',
}

export function decodeHtmlEntities(input) {
  return String(input || '').replace(
    /&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/g,
    (match, token) => {
      if (token.startsWith('#x') || token.startsWith('#X')) {
        const cp = Number.parseInt(token.slice(2), 16)
        return Number.isFinite(cp) && cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : match
      }
      if (token.startsWith('#')) {
        const cp = Number.parseInt(token.slice(1), 10)
        return Number.isFinite(cp) && cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : match
      }
      return NAMED_ENTITIES[token.toLowerCase()] ?? match
    }
  )
}

export function stripTags(html) {
  return decodeHtmlEntities(String(html || '').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

function firstMatch(input, pattern) {
  const match = pattern.exec(input)
  return match ? match[1] : ''
}

function htmlToText(html) {
  const withBreaks = html
    .replace(/<(br|hr)\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|li|tr|h[1-6]|blockquote|pre)>/gi, '\n')
    .replace(/<(p|div|section|article|li|tr|h[1-6]|blockquote|pre)\b[^>]*>/gi, '\n')

  return decodeHtmlEntities(withBreaks.replace(/<[^>]+>/g, ' '))
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function extractReadable(html) {
  const baseCleaned = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|svg|iframe|template|form)\b[\s\S]*?<\/\1>/gi, '')

  const title =
    stripTags(firstMatch(baseCleaned, /<title[^>]*>([\s\S]*?)<\/title>/i)) ||
    stripTags(firstMatch(baseCleaned, /<h1[^>]*>([\s\S]*?)<\/h1>/i))

  const bylineMatch =
    /<meta[^>]+name=["']author["'][^>]+content=["']([^"']+)["']/i.exec(baseCleaned) ??
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']author["']/i.exec(baseCleaned)
  const byline = bylineMatch ? decodeHtmlEntities(bylineMatch[1]).trim() : ''

  const noChrome = baseCleaned.replace(/<(nav|header|footer|aside)\b[\s\S]*?<\/\1>/gi, '')
  const container =
    firstMatch(noChrome, /<article\b[^>]*>([\s\S]*?)<\/article>/i) ||
    firstMatch(noChrome, /<main\b[^>]*>([\s\S]*?)<\/main>/i) ||
    firstMatch(noChrome, /<body\b[^>]*>([\s\S]*?)<\/body>/i) ||
    noChrome

  let content = htmlToText(container)
  if (content.length < 80) {
    const fallback = htmlToText(noChrome)
    if (fallback.length > content.length) {
      content = fallback
    }
  }
  if (!content) {
    content = htmlToText(baseCleaned)
  }
  return { title, byline, content, extractor: 'readability-lite-v2' }
}

function detectCharset(contentType, buf) {
  const ctMatch = /charset\s*=\s*["']?([a-zA-Z0-9_-]+)/i.exec(contentType || '')
  let charset = ctMatch?.[1]?.toLowerCase() ?? ''
  if (!charset) {
    const headLatin1 = buf.subarray(0, Math.min(buf.length, 1500)).toString('latin1')
    const metaMatch =
      /<meta[^>]+charset=["']?([a-zA-Z0-9_-]+)/i.exec(headLatin1) ??
      /<meta[^>]+content=["'][^"']*charset=([a-zA-Z0-9_-]+)/i.exec(headLatin1)
    charset = metaMatch?.[1]?.toLowerCase() ?? ''
  }
  if (charset === 'gb2312' || charset === 'gbk' || charset === 'x-gbk') {
    return 'gb18030'
  }
  return charset || 'utf-8'
}

export function decodeTextBuffer(buf, contentType) {
  const charset = detectCharset(contentType, buf)
  try {
    return new TextDecoder(charset).decode(buf)
  } catch {
    return new TextDecoder('utf-8').decode(buf)
  }
}

export function sniffContentKind(buf, contentType = '', url = '') {
  const ct = contentType.toLowerCase()
  const cleanUrl = url.split('?')[0].split('#')[0].toLowerCase()

  const b0 = buf[0] ?? 0
  const b1 = buf[1] ?? 0
  const b2 = buf[2] ?? 0
  const b3 = buf[3] ?? 0
  const head5 = buf.subarray(0, 5).toString('ascii')

  if (head5 === '%PDF-' || ct.includes('application/pdf') || cleanUrl.endsWith('.pdf')) {
    return 'pdf'
  }
  if (
    (b0 === 0x89 && b1 === 0x50 && b2 === 0x4e && b3 === 0x47) ||
    (b0 === 0xff && b1 === 0xd8 && b2 === 0xff) ||
    head5.startsWith('GIF8') ||
    (head5 === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') ||
    ct.startsWith('image/')
  ) {
    return 'image'
  }
  if (
    (b0 === 0x50 && b1 === 0x4b && (b2 === 0x03 || b2 === 0x05)) ||
    ct.includes('application/zip') ||
    ct.includes('application/x-zip') ||
    cleanUrl.endsWith('.zip')
  ) {
    return 'zip'
  }
  if (ct.includes('html') || ct.includes('xml')) {
    return 'html'
  }
  if (
    ct.includes('application/octet-stream') ||
    /\.(exe|bin|rar|7z|tar|gz|mp4|mp3|mov|apk|dmg)$/i.test(cleanUrl)
  ) {
    return 'binary'
  }
  const sample = buf.subarray(0, Math.min(buf.length, 512))
  if (sample.includes(0)) {
    return 'binary'
  }
  return 'text'
}

export function extractZipSummary(buf) {
  let eocdOffset = -1
  const minOffset = Math.max(0, buf.length - 65_557)
  for (let i = buf.length - 22; i >= minOffset; i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i
      break
    }
  }
  if (eocdOffset < 0) {
    return {
      title: 'ZIP 压缩包',
      content: `[ZIP 压缩包，体积 ${Math.round(buf.length / 1024)} KB；未定位到标准中央目录]`,
      extractor: 'zip-directory',
    }
  }

  const totalEntries = buf.readUInt16LE(eocdOffset + 10)
  const cdOffset = buf.readUInt32LE(eocdOffset + 16)
  const entries = []
  const textExcerpts = []
  let ptr = cdOffset
  let decodedBytes = 0

  while (ptr + 46 <= eocdOffset && entries.length < 100) {
    if (buf.readUInt32LE(ptr) !== 0x02014b50) {
      break
    }
    const method = buf.readUInt16LE(ptr + 10)
    const compressedSize = buf.readUInt32LE(ptr + 20)
    const uncompressedSize = buf.readUInt32LE(ptr + 24)
    const nameLen = buf.readUInt16LE(ptr + 28)
    const extraLen = buf.readUInt16LE(ptr + 30)
    const commentLen = buf.readUInt16LE(ptr + 32)
    const localOffset = buf.readUInt32LE(ptr + 42)
    const name = buf.subarray(ptr + 46, ptr + 46 + nameLen).toString('utf8')
    ptr += 46 + nameLen + extraLen + commentLen

    entries.push(`- ${name} (${uncompressedSize} B)`)

    const isTextEntry = /\.(txt|md|json|csv|xml|yml|yaml|ts|js|py)$/i.test(name)
    if (
      isTextEntry &&
      !name.endsWith('/') &&
      uncompressedSize > 0 &&
      uncompressedSize <= 64 * 1024 &&
      decodedBytes < 128 * 1024 &&
      localOffset + 30 <= buf.length &&
      buf.readUInt32LE(localOffset) === 0x04034b50
    ) {
      const lhNameLen = buf.readUInt16LE(localOffset + 26)
      const lhExtraLen = buf.readUInt16LE(localOffset + 28)
      const dataStart = localOffset + 30 + lhNameLen + lhExtraLen
      const dataEnd = Math.min(buf.length, dataStart + compressedSize)
      if (dataEnd > dataStart) {
        try {
          const rawSlice = buf.subarray(dataStart, dataEnd)
          const dataBuf =
            method === 0
              ? rawSlice
              : method === 8
                ? zlib.inflateRawSync(rawSlice, { maxOutputLength: 64 * 1024 })
                : null
          if (dataBuf) {
            decodedBytes += dataBuf.length
            const text = dataBuf.toString('utf8').slice(0, 800).trim()
            if (text) {
              textExcerpts.push(`[${name}]\n${text}`)
            }
          }
        } catch {
          // Skip malformed ZIP entries cleanly
        }
      }
    }
  }

  const lines = [`ZIP 压缩包目录（共 ${totalEntries} 项，体积 ${Math.round(buf.length / 1024)} KB）：`, ...entries]
  if (textExcerpts.length > 0) {
    lines.push('', '部分文本文件预览：', ...textExcerpts)
  }
  return {
    title: 'ZIP 压缩包清单',
    content: lines.join('\n'),
    extractor: 'zip-directory',
  }
}

function unescapePdfString(raw) {
  return raw
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\\/g, '\\')
}

function extractReadableStringsFromPdfStream(streamText) {
  const out = []
  const tjMatches = streamText.matchAll(/\(([^()\\]*(?:\\.[^()\\]*)*)\)\s*Tj/g)
  for (const m of tjMatches) {
    const clean = unescapePdfString(m[1]).trim()
    if (clean) {
      out.push(clean)
    }
  }
  const arrayMatches = streamText.matchAll(/\[([\s\S]*?)\]\s*TJ/g)
  for (const m of arrayMatches) {
    const inner = Array.from(m[1].matchAll(/\(([^()\\]*(?:\\.[^()\\]*)*)\)/g))
      .map((item) => unescapePdfString(item[1]))
      .join('')
      .trim()
    if (inner) {
      out.push(inner)
    }
  }
  return out.join(' ').replace(/\s+/g, ' ').trim()
}

export function extractPdfText(buf) {
  const latin1 = buf.toString('latin1')
  const chunks = []
  let pos = 0

  while (pos < latin1.length && chunks.join('\n').length < MAX_CONTENT_CHARS * 2) {
    const streamIdx = latin1.indexOf('stream', pos)
    if (streamIdx === -1) {
      break
    }
    const endIdx = latin1.indexOf('endstream', streamIdx + 6)
    if (endIdx === -1) {
      break
    }
    let dataStart = streamIdx + 6
    if (buf[dataStart] === 0x0d && buf[dataStart + 1] === 0x0a) {
      dataStart += 2
    } else if (buf[dataStart] === 0x0a || buf[dataStart] === 0x0d) {
      dataStart += 1
    }
    const rawStream = buf.subarray(dataStart, endIdx)
    const headerSlice = latin1.slice(Math.max(0, streamIdx - 240), streamIdx)
    let textStream = ''
    if (/FlateDecode/i.test(headerSlice)) {
      try {
        const inflated = zlib.inflateSync(rawStream, { maxOutputLength: 512 * 1024 })
        textStream = inflated.toString('latin1')
      } catch {
        textStream = ''
      }
    } else if (!/DCTDecode|JPXDecode|JBIG2Decode/i.test(headerSlice)) {
      textStream = rawStream.toString('latin1')
    }
    if (textStream.includes('Tj') || textStream.includes('TJ')) {
      const extracted = extractReadableStringsFromPdfStream(textStream)
      if (extracted) {
        chunks.push(extracted)
      }
    }
    pos = endIdx + 9
  }

  const combined = chunks.join('\n').trim()
  if (combined.length >= 20) {
    return {
      title: 'PDF 文档内容',
      content: combined,
      extractor: 'pdf-stream-text',
    }
  }
  return {
    title: 'PDF 二进制文档',
    content: `[PDF 文档，体积 ${Math.round(buf.length / 1024)} KB；该 PDF 可能为扫描件或字体编码压缩，建议直接通过聊天附件上传 PDF 进行版面识别]`,
    extractor: 'pdf-metadata-guard',
  }
}

export function extractWebContent(buf, contentType, url) {
  const kind = sniffContentKind(buf, contentType, url)

  if (kind === 'image') {
    return {
      kind,
      title: '图片资源',
      byline: '',
      extractor: 'image-metadata-guard',
      content: `[图片资源 (${contentType || 'image'}, ${Math.round(buf.length / 1024)} KB): ${url}。提示：如需 AI 识图，请将图片作为附件上传。]`,
    }
  }

  if (kind === 'zip') {
    const zipInfo = extractZipSummary(buf)
    return {
      kind,
      title: zipInfo.title,
      byline: '',
      extractor: zipInfo.extractor,
      content: zipInfo.content,
    }
  }

  if (kind === 'pdf') {
    const pdfInfo = extractPdfText(buf)
    return {
      kind,
      title: pdfInfo.title,
      byline: '',
      extractor: pdfInfo.extractor,
      content: pdfInfo.content,
    }
  }

  if (kind === 'binary') {
    return {
      kind,
      title: '二进制文件',
      byline: '',
      extractor: 'binary-guard',
      content: `[二进制文件 (${contentType || 'application/octet-stream'}, ${Math.round(buf.length / 1024)} KB): ${url}，跳过原始字节避免乱码]`,
    }
  }

  const text = decodeTextBuffer(buf, contentType)
  if (kind === 'html') {
    const readable = extractReadable(text)
    return {
      kind,
      title: readable.title,
      byline: readable.byline,
      extractor: readable.extractor,
      content: readable.content || text,
    }
  }

  return {
    kind: 'text',
    title: '',
    byline: '',
    extractor: 'raw',
    content: text,
  }
}
