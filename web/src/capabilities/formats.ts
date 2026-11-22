import { unzipSync, unzlibSync } from 'fflate'
import { decodeSmartText, detectDeclaredCharset } from './encoding.js'

const MAX_TABLE_ROWS = 250
const MAX_TABLE_COLS = 40

const XML_ENTITY_MAP: Record<string, string> = {
  lt: '<',
  gt: '>',
  amp: '&',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

export const decodeXmlEntities = (input: string): string =>
  input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (full, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      const code = Number.parseInt(entity.slice(2), 16)
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : full
    }
    if (entity.startsWith('#')) {
      const code = Number.parseInt(entity.slice(1), 10)
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : full
    }
    return XML_ENTITY_MAP[entity] ?? full
  })

const escapeMarkdownCell = (cell: string): string =>
  cell
    .replace(/\r?\n+/g, ' ')
    .replace(/\|/g, '\\|')
    .trim()

export const formatMarkdownTable = (rows: string[][]): string => {
  if (rows.length === 0) {
    return ''
  }
  const colCount = Math.min(
    MAX_TABLE_COLS,
    rows.reduce((max, row) => Math.max(max, row.length), 0)
  )
  if (colCount === 0) {
    return ''
  }
  const normalizeRow = (row: string[]) => {
    const padded: string[] = []
    for (let i = 0; i < colCount; i += 1) {
      padded.push(escapeMarkdownCell(row[i] ?? ''))
    }
    return `| ${padded.join(' | ')} |`
  }
  const header = normalizeRow(rows[0] ?? [])
  const separator = `| ${Array.from({ length: colCount }, () => '---').join(' | ')} |`
  const body = rows.slice(1, MAX_TABLE_ROWS).map(normalizeRow)
  const lines = [header, separator, ...body]
  if (rows.length > MAX_TABLE_ROWS) {
    lines.push(`\n> [表格共 ${rows.length} 行，已保留前 ${MAX_TABLE_ROWS} 行]`)
  }
  return lines.join('\n')
}

export const parseCsvText = (text: string, delimiter: ',' | '\t'): string => {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 1
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
      continue
    }
    if (ch === '"') {
      inQuotes = true
      continue
    }
    if (ch === delimiter) {
      row.push(field)
      field = ''
      continue
    }
    if (ch === '\n') {
      row.push(field)
      if (row.some((c) => c.trim().length > 0)) {
        rows.push(row)
      }
      row = []
      field = ''
      continue
    }
    if (ch !== '\r') {
      field += ch
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    if (row.some((c) => c.trim().length > 0)) {
      rows.push(row)
    }
  }
  if (rows.length === 0) {
    return '(空表格)'
  }
  return formatMarkdownTable(rows)
}

const stripXmlTagsText = (xml: string): string =>
  decodeXmlEntities(xml.replace(/<[^>]+>/g, ''))
    .replace(/[ \t]+\n/g, '\n')
    .trim()

const extractParagraphText = (pXml: string): string => {
  const withControls = pXml
    .replace(/<w:tab\b[^>]*\/>/g, '\t')
    .replace(/<w:(?:br|cr)\b[^>]*\/>/g, '\n')
  const texts: string[] = []
  const re = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g
  for (let match = re.exec(withControls); match !== null; match = re.exec(withControls)) {
    texts.push(decodeXmlEntities(match[1]))
  }
  const combined = texts.join('').trim()
  if (!combined) {
    return ''
  }
  const headingMatch = /<w:pStyle\b[^>]*w:val="([^"]+)"/i.exec(pXml)
  const styleVal = headingMatch?.[1] ?? ''
  const levelMatch = /(?:heading|标题)\s*([1-6])/i.exec(styleVal)
  if (levelMatch?.[1]) {
    return `${'#'.repeat(Number(levelMatch[1]))} ${combined}`
  }
  if (/^title$/i.test(styleVal)) {
    return `# ${combined}`
  }
  if (/<w:numPr\b/.test(pXml)) {
    return `- ${combined}`
  }
  return combined
}

const extractDocxBodyXml = (bodyXml: string): string => {
  const blocks: string[] = []
  const tokenRe = /<w:tbl\b[\s\S]*?<\/w:tbl>|<w:p\b[\s\S]*?<\/w:p>/g
  for (let match = tokenRe.exec(bodyXml); match !== null; match = tokenRe.exec(bodyXml)) {
    const chunk = match[0]
    if (chunk.startsWith('<w:tbl')) {
      const tableRows: string[][] = []
      const trRe = /<w:tr\b[\s\S]*?<\/w:tr>/g
      for (let tr = trRe.exec(chunk); tr !== null; tr = trRe.exec(chunk)) {
        const cells: string[] = []
        const tcRe = /<w:tc\b[\s\S]*?<\/w:tc>/g
        for (let tc = tcRe.exec(tr[0]); tc !== null; tc = tcRe.exec(tr[0])) {
          const pTexts: string[] = []
          const pRe = /<w:p\b[\s\S]*?<\/w:p>/g
          for (let p = pRe.exec(tc[0]); p !== null; p = pRe.exec(tc[0])) {
            const line = extractParagraphText(p[0]).replace(/^#{1,6}\s+/, '')
            if (line) {
              pTexts.push(line)
            }
          }
          cells.push(pTexts.join(' '))
        }
        if (cells.length > 0) {
          tableRows.push(cells)
        }
      }
      const mdTable = formatMarkdownTable(tableRows)
      if (mdTable) {
        blocks.push(mdTable)
      }
    } else {
      const line = extractParagraphText(chunk)
      if (line) {
        blocks.push(line)
      }
    }
  }
  return blocks.join('\n\n')
}

export const parseDocxBytes = (bytes: Uint8Array): string => {
  const archive = unzipSync(bytes)
  const sections: string[] = []
  const docEntry = archive['word/document.xml']
  if (docEntry) {
    const docXml = decodeSmartText(docEntry, 'utf-8').text
    const bodyMatch = /<w:body\b[^>]*>([\s\S]*?)<\/w:body>/.exec(docXml)
    const parsed = extractDocxBodyXml(bodyMatch ? bodyMatch[1] : docXml)
    if (parsed) {
      sections.push(parsed)
    }
  }
  for (const extraPath of ['word/footnotes.xml', 'word/endnotes.xml']) {
    const extra = archive[extraPath]
    if (!extra) {
      continue
    }
    const extraXml = decodeSmartText(extra, 'utf-8').text
    const parsed = extractDocxBodyXml(extraXml)
    if (parsed) {
      sections.push(parsed)
    }
  }
  return sections.join('\n\n') || '(Word 文档中未提取到可显示文本)'
}

const colLettersToIndex = (letters: string): number => {
  let idx = 0
  for (let i = 0; i < letters.length; i += 1) {
    idx = idx * 26 + (letters.charCodeAt(i) - 64)
  }
  return Math.max(0, idx - 1)
}

export const parseXlsxBytes = (bytes: Uint8Array): string => {
  const archive = unzipSync(bytes)
  const sharedStrings: string[] = []
  if (archive['xl/sharedStrings.xml']) {
    const ssXml = decodeSmartText(archive['xl/sharedStrings.xml'], 'utf-8').text
    const siRe = /<si\b[\s\S]*?<\/si>/g
    for (let si = siRe.exec(ssXml); si !== null; si = siRe.exec(ssXml)) {
      const parts: string[] = []
      const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g
      for (let t = tRe.exec(si[0]); t !== null; t = tRe.exec(si[0])) {
        parts.push(decodeXmlEntities(t[1]))
      }
      sharedStrings.push(parts.join(''))
    }
  }

  const relMap = new Map<string, string>()
  if (archive['xl/_rels/workbook.xml.rels']) {
    const relsXml = decodeSmartText(archive['xl/_rels/workbook.xml.rels'], 'utf-8').text
    const relRe = /<Relationship\b([^>]+)\/>/g
    for (let match = relRe.exec(relsXml); match !== null; match = relRe.exec(relsXml)) {
      const attrs = match[1]
      const id = /Id="([^"]+)"/.exec(attrs)?.[1]
      const target = /Target="([^"]+)"/.exec(attrs)?.[1]
      if (id && target) {
        const normalized = target.startsWith('/')
          ? target.slice(1)
          : `xl/${target.replace(/^\.\//, '')}`
        relMap.set(id, normalized)
      }
    }
  }

  const orderedSheets: Array<{ name: string; path: string }> = []
  if (archive['xl/workbook.xml']) {
    const wbXml = decodeSmartText(archive['xl/workbook.xml'], 'utf-8').text
    const sheetRe = /<sheet\b([^>]+?)\/?>/g
    for (let match = sheetRe.exec(wbXml); match !== null; match = sheetRe.exec(wbXml)) {
      const attrs = match[1]
      const name = decodeXmlEntities(/name="([^"]+)"/.exec(attrs)?.[1] ?? '')
      const rId = /r:id="([^"]+)"/.exec(attrs)?.[1]
      const target = rId ? relMap.get(rId) : undefined
      if (name && target && archive[target]) {
        orderedSheets.push({ name, path: target })
      }
    }
  }

  if (orderedSheets.length === 0) {
    const fallbackPaths = Object.keys(archive)
      .filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(k))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    for (const sheetPath of fallbackPaths) {
      orderedSheets.push({
        name: sheetPath.replace(/^xl\/worksheets\//, '').replace(/\.xml$/i, ''),
        path: sheetPath,
      })
    }
  }

  const outputs: string[] = []
  for (const sheet of orderedSheets) {
    const entry = archive[sheet.path]
    if (!entry) {
      continue
    }
    const xml = decodeSmartText(entry, 'utf-8').text
    const rows: string[][] = []
    const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g
    for (let r = rowRe.exec(xml); r !== null && rows.length < MAX_TABLE_ROWS; r = rowRe.exec(xml)) {
      const rowValues: string[] = []
      const cellRe = /<c\b([^>]*)>([\s\S]*?)<\/c>/g
      for (let c = cellRe.exec(r[1]); c !== null; c = cellRe.exec(r[1])) {
        const attrs = c[1]
        const inner = c[2]
        const refMatch = /r="([A-Z]+)\d+"/i.exec(attrs)
        const colIdx = refMatch ? colLettersToIndex(refMatch[1].toUpperCase()) : rowValues.length
        if (colIdx >= MAX_TABLE_COLS) {
          continue
        }
        const type = /t="([^"]+)"/.exec(attrs)?.[1] ?? ''
        let val = ''
        if (type === 's') {
          const sIdx = Number.parseInt(/<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? '', 10)
          val = Number.isFinite(sIdx) ? (sharedStrings[sIdx] ?? '') : ''
        } else if (type === 'inlineStr') {
          const tParts: string[] = []
          const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g
          for (let t = tRe.exec(inner); t !== null; t = tRe.exec(inner)) {
            tParts.push(decodeXmlEntities(t[1]))
          }
          val = tParts.join('')
        } else if (type === 'b') {
          val = /<v>1<\/v>/.test(inner) ? 'TRUE' : 'FALSE'
        } else {
          val = decodeXmlEntities(/<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? '')
        }
        while (rowValues.length < colIdx) {
          rowValues.push('')
        }
        rowValues[colIdx] = val
      }
      if (rowValues.some((cell) => cell.trim().length > 0)) {
        rows.push(rowValues)
      }
    }
    const table = formatMarkdownTable(rows)
    outputs.push(`### Sheet: ${sheet.name}\n\n${table || '(空工作表)'}`)
  }

  return outputs.join('\n\n') || '(Excel 工作簿中未提取到可显示数据)'
}

const extractDrawingText = (xml: string): string => {
  const lines: string[] = []
  const pRe = /<a:p\b[\s\S]*?<\/a:p>/g
  for (let p = pRe.exec(xml); p !== null; p = pRe.exec(xml)) {
    const runs: string[] = []
    const tRe = /<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g
    for (let t = tRe.exec(p[0]); t !== null; t = tRe.exec(p[0])) {
      runs.push(decodeXmlEntities(t[1]))
    }
    const line = runs.join('').trim()
    if (line) {
      lines.push(line)
    }
  }
  return lines.join('\n')
}

export const parsePptxBytes = (bytes: Uint8Array): string => {
  const archive = unzipSync(bytes)
  const slidePaths = Object.keys(archive)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))

  const sections: string[] = []
  for (const slidePath of slidePaths) {
    const numMatch = /slide(\d+)\.xml$/i.exec(slidePath)
    const num = numMatch?.[1] ?? '?'
    const slideText = extractDrawingText(decodeSmartText(archive[slidePath], 'utf-8').text)
    const notesPath = `ppt/notesSlides/notesSlide${num}.xml`
    const notesText = archive[notesPath]
      ? extractDrawingText(decodeSmartText(archive[notesPath], 'utf-8').text)
      : ''
    const parts = [`## Slide ${num}`]
    parts.push(slideText || '(无文字内容)')
    if (notesText) {
      parts.push(`> Notes: ${notesText.replace(/\n+/g, ' ')}`)
    }
    sections.push(parts.join('\n\n'))
  }
  return sections.join('\n\n') || '(PPT 演示文稿中未提取到文字)'
}

export const htmlToReadableText = (html: string): string => {
  const cleaned = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, lvl: string, inner: string) => {
      const txt = stripXmlTagsText(inner)
      return txt ? `\n\n${'#'.repeat(Number(lvl))} ${txt}\n\n` : ''
    })
    .replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_m, inner: string) => {
      const txt = stripXmlTagsText(inner)
      return txt ? `\n- ${txt}` : ''
    })
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|section|article|tr|blockquote|h\d)>/gi, '\n\n')
    .replace(/<\/(?:td|th)>/gi, ' | ')
  return decodeXmlEntities(cleaned.replace(/<[^>]+>/g, ''))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export const parseEpubBytes = (bytes: Uint8Array): string => {
  const archive = unzipSync(bytes)
  let spinePaths: string[] = []

  if (archive['META-INF/container.xml']) {
    const containerXml = decodeSmartText(archive['META-INF/container.xml'], 'utf-8').text
    const opfPath = /full-path="([^"]+)"/i.exec(containerXml)?.[1]
    if (opfPath && archive[opfPath]) {
      const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : ''
      const opfXml = decodeSmartText(archive[opfPath], 'utf-8').text
      const hrefById = new Map<string, string>()
      const itemRe = /<item\b([^>]+)\/?>/gi
      for (let m = itemRe.exec(opfXml); m !== null; m = itemRe.exec(opfXml)) {
        const attrs = m[1]
        const id = /id="([^"]+)"/i.exec(attrs)?.[1]
        const href = /href="([^"]+)"/i.exec(attrs)?.[1]
        const mediaType = /media-type="([^"]+)"/i.exec(attrs)?.[1] ?? ''
        if (id && href && /html|xhtml/i.test(mediaType + href)) {
          hrefById.set(id, `${opfDir}${decodeURIComponent(href)}`)
        }
      }
      const refRe = /<itemref\b[^>]*idref="([^"]+)"/gi
      for (let m = refRe.exec(opfXml); m !== null; m = refRe.exec(opfXml)) {
        const path = hrefById.get(m[1])
        if (path && archive[path]) {
          spinePaths.push(path)
        }
      }
    }
  }

  if (spinePaths.length === 0) {
    spinePaths = Object.keys(archive)
      .filter((k) => /\.(?:xhtml|html|htm)$/i.test(k) && !/toc|nav/i.test(k))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  }

  const chapters: string[] = []
  for (const chPath of spinePaths) {
    const entry = archive[chPath]
    if (!entry) {
      continue
    }
    const charset = detectDeclaredCharset(entry)
    const html = decodeSmartText(entry, charset).text
    const text = htmlToReadableText(html)
    if (text) {
      chapters.push(text)
    }
  }
  return chapters.join('\n\n---\n\n') || '(EPUB 电子书中未提取到正文内容)'
}

export const parseRtfBytes = (bytes: Uint8Array): string => {
  const raw = new TextDecoder('latin1').decode(bytes)
  const hexBuffer: number[] = []
  let skipChars = 0
  let ucCount = 1
  const groupStack: Array<{ uc: number; skipGroup: boolean }> = []
  let skipGroup = false
  let out = ''

  const flushHex = () => {
    if (hexBuffer.length > 0) {
      out += decodeSmartText(Uint8Array.from(hexBuffer), 'gb18030').text
      hexBuffer.length = 0
    }
  }

  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i]
    if (ch === '{') {
      flushHex()
      groupStack.push({ uc: ucCount, skipGroup })
      const lookahead = raw.slice(i + 1, i + 20)
      if (
        /^\\(?:\*\\|fonttbl|colortbl|stylesheet|info|pict|object|header|footer)/.test(lookahead)
      ) {
        skipGroup = true
      }
      continue
    }
    if (ch === '}') {
      flushHex()
      const prev = groupStack.pop()
      if (prev) {
        ucCount = prev.uc
        skipGroup = prev.skipGroup
      }
      continue
    }
    if (skipGroup) {
      continue
    }
    if (ch === '\\') {
      const next = raw[i + 1]
      if (next === "'" && /^[0-9a-fA-F]{2}/.test(raw.slice(i + 2, i + 4))) {
        const byte = Number.parseInt(raw.slice(i + 2, i + 4), 16)
        hexBuffer.push(byte)
        i += 3
        continue
      }
      flushHex()
      if (next === '\\' || next === '{' || next === '}') {
        out += next
        i += 1
        continue
      }
      if (next === '~') {
        out += ' '
        i += 1
        continue
      }
      if (next === '\n' || next === '\r') {
        out += '\n'
        i += 1
        continue
      }
      const ctrlMatch = /^([a-zA-Z]+)(-?\d+)? ?/.exec(raw.slice(i + 1))
      if (ctrlMatch) {
        const word = ctrlMatch[1]
        const param = ctrlMatch[2] ? Number.parseInt(ctrlMatch[2], 10) : undefined
        i += ctrlMatch[0].length
        if (word === 'uc' && param !== undefined) {
          ucCount = param
        } else if (word === 'u' && param !== undefined) {
          const code = param < 0 ? param + 65536 : param
          out += String.fromCharCode(code)
          skipChars = ucCount
        } else if (word === 'par' || word === 'line') {
          out += '\n'
        } else if (word === 'tab') {
          out += '\t'
        }
      }
      continue
    }
    flushHex()
    if (ch === '\r' || ch === '\n') {
      continue
    }
    if (skipChars > 0) {
      skipChars -= 1
      continue
    }
    out += ch
  }
  flushHex()
  return out.replace(/\n{3,}/g, '\n\n').trim() || '(RTF 文档中未提取到可显示文本)'
}

const findBytesIndex = (haystack: Uint8Array, needle: Uint8Array, from = 0): number => {
  const limit = haystack.length - needle.length
  outer: for (let i = from; i <= limit; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) {
        continue outer
      }
    }
    return i
  }
  return -1
}

const decodePdfHexToken = (hex: string, cmap: Map<number, string>): string => {
  const clean = hex.replace(/\s+/g, '')
  if (!clean) {
    return ''
  }
  if (clean.toUpperCase().startsWith('FEFF') && clean.length >= 8 && clean.length % 4 === 0) {
    let text = ''
    for (let i = 4; i + 4 <= clean.length; i += 4) {
      text += String.fromCharCode(Number.parseInt(clean.slice(i, i + 4), 16))
    }
    return text
  }
  if (cmap.size > 0 && clean.length % 4 === 0) {
    let mapped = ''
    let hits = 0
    for (let i = 0; i + 4 <= clean.length; i += 4) {
      const code = Number.parseInt(clean.slice(i, i + 4), 16)
      const glyph = cmap.get(code)
      if (glyph !== undefined) {
        mapped += glyph
        hits += 1
      } else if (code >= 0x20 && code <= 0x7e) {
        mapped += String.fromCharCode(code)
      }
    }
    if (hits > 0) {
      return mapped
    }
  }
  if (cmap.size > 0 && clean.length % 2 === 0) {
    let mapped = ''
    let hits = 0
    for (let i = 0; i + 2 <= clean.length; i += 2) {
      const code = Number.parseInt(clean.slice(i, i + 2), 16)
      const glyph = cmap.get(code)
      if (glyph !== undefined) {
        mapped += glyph
        hits += 1
      } else if (code >= 0x20 && code <= 0x7e) {
        mapped += String.fromCharCode(code)
      }
    }
    if (hits > 0) {
      return mapped
    }
  }
  const bytes = new Uint8Array(Math.floor(clean.length / 2))
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  }
  return decodeSmartText(bytes).text
}

const decodePdfLiteralToken = (rawInner: string, cmap: Map<number, string>): string => {
  const outBytes: number[] = []
  for (let i = 0; i < rawInner.length; i += 1) {
    const ch = rawInner[i]
    if (ch !== '\\') {
      outBytes.push(rawInner.charCodeAt(i) & 0xff)
      continue
    }
    const next = rawInner[i + 1]
    if (!next) {
      break
    }
    if (next === 'n') {
      outBytes.push(10)
      i += 1
    } else if (next === 'r') {
      outBytes.push(13)
      i += 1
    } else if (next === 't') {
      outBytes.push(9)
      i += 1
    } else if (next === 'b') {
      outBytes.push(8)
      i += 1
    } else if (next === 'f') {
      outBytes.push(12)
      i += 1
    } else if (next === '\r' || next === '\n') {
      i += next === '\r' && rawInner[i + 2] === '\n' ? 2 : 1
    } else if (/[0-7]/.test(next)) {
      const oct = /^[0-7]{1,3}/.exec(rawInner.slice(i + 1))
      if (oct) {
        outBytes.push(Number.parseInt(oct[0], 8) & 0xff)
        i += oct[0].length
      }
    } else {
      outBytes.push(next.charCodeAt(0) & 0xff)
      i += 1
    }
  }
  if (outBytes.length >= 2 && outBytes[0] === 0xfe && outBytes[1] === 0xff) {
    let text = ''
    for (let i = 2; i + 1 < outBytes.length; i += 2) {
      text += String.fromCharCode((outBytes[i] << 8) | outBytes[i + 1])
    }
    return text
  }
  if (cmap.size > 0 && outBytes.length % 2 === 0 && outBytes.some((b) => b < 0x20 || b > 0x7e)) {
    let mapped = ''
    let hits = 0
    for (let i = 0; i + 1 < outBytes.length; i += 2) {
      const code = (outBytes[i] << 8) | outBytes[i + 1]
      const glyph = cmap.get(code)
      if (glyph !== undefined) {
        mapped += glyph
        hits += 1
      }
    }
    if (hits > 0 && hits >= outBytes.length / 4) {
      return mapped
    }
  }
  return decodeSmartText(Uint8Array.from(outBytes)).text
}

const parseCmapEntries = (streamText: string, cmap: Map<number, string>) => {
  const hexToUnicode = (hex: string): string => {
    const clean = hex.replace(/\s+/g, '')
    let out = ''
    for (let i = 0; i + 4 <= clean.length; i += 4) {
      out += String.fromCharCode(Number.parseInt(clean.slice(i, i + 4), 16))
    }
    return out
  }
  const bfcharRe = /beginbfchar([\s\S]*?)endbfchar/g
  for (let m = bfcharRe.exec(streamText); m !== null; m = bfcharRe.exec(streamText)) {
    const pairRe = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g
    for (let p = pairRe.exec(m[1]); p !== null; p = pairRe.exec(m[1])) {
      cmap.set(Number.parseInt(p[1], 16), hexToUnicode(p[2]))
    }
  }
  const bfrangeRe = /beginbfrange([\s\S]*?)endbfrange/g
  for (let m = bfrangeRe.exec(streamText); m !== null; m = bfrangeRe.exec(streamText)) {
    const lineRe = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g
    for (let p = lineRe.exec(m[1]); p !== null; p = lineRe.exec(m[1])) {
      const start = Number.parseInt(p[1], 16)
      const end = Number.parseInt(p[2], 16)
      let target = Number.parseInt(p[3], 16)
      const count = Math.min(2048, end - start)
      for (let code = start; code <= start + count; code += 1) {
        cmap.set(code, String.fromCharCode(target))
        target += 1
      }
    }
  }
}

const extractPdfTextOperators = (streamText: string, cmap: Map<number, string>): string => {
  let out = ''
  const btRe = /\bBT\b([\s\S]*?)\bET\b/g
  for (let block = btRe.exec(streamText); block !== null; block = btRe.exec(streamText)) {
    const content = block[1]
    let i = 0
    let lineBuf = ''
    while (i < content.length) {
      const ch = content[i]
      if (ch === '(') {
        let depth = 1
        let j = i + 1
        while (j < content.length && depth > 0) {
          if (content[j] === '\\') {
            j += 2
            continue
          }
          if (content[j] === '(') {
            depth += 1
          } else if (content[j] === ')') {
            depth -= 1
          }
          j += 1
        }
        const literal = content.slice(i + 1, Math.max(i + 1, j - 1))
        lineBuf += decodePdfLiteralToken(literal, cmap)
        i = j
        continue
      }
      if (ch === '<' && content[i + 1] !== '<') {
        const end = content.indexOf('>', i + 1)
        if (end !== -1) {
          lineBuf += decodePdfHexToken(content.slice(i + 1, end), cmap)
          i = end + 1
          continue
        }
      }
      if ((ch === 'T' || ch === 't') && /^T[dD*]/.test(content.slice(i, i + 3))) {
        if (lineBuf.trim()) {
          out += `${lineBuf.trim()}\n`
          lineBuf = ''
        }
        i += 2
        continue
      }
      i += 1
    }
    if (lineBuf.trim()) {
      out += `${lineBuf.trim()}\n`
    }
  }
  return out
}

export const parsePdfBytes = (bytes: Uint8Array): string => {
  const asciiProbe = new TextDecoder('latin1').decode(
    bytes.subarray(0, Math.min(bytes.length, 4096))
  )
  if (/\/Encrypt\b/.test(asciiProbe)) {
    return '[PDF 解析提示] 该 PDF 已加密，纯本地无法解密提取文字。'
  }
  const streamToken = new TextEncoder().encode('stream')
  const endStreamToken = new TextEncoder().encode('endstream')
  const streams: string[] = []
  const cmap = new Map<number, string>()

  let cursor = 0
  while (cursor < bytes.length) {
    const startIdx = findBytesIndex(bytes, streamToken, cursor)
    if (startIdx === -1) {
      break
    }
    let dataStart = startIdx + streamToken.length
    if (bytes[dataStart] === 0x0d && bytes[dataStart + 1] === 0x0a) {
      dataStart += 2
    } else if (bytes[dataStart] === 0x0a || bytes[dataStart] === 0x0d) {
      dataStart += 1
    } else {
      cursor = dataStart
      continue
    }
    const endIdx = findBytesIndex(bytes, endStreamToken, dataStart)
    if (endIdx === -1) {
      break
    }
    let slice = bytes.subarray(dataStart, endIdx)
    if (slice.length >= 2 && slice[slice.length - 2] === 0x0d && slice[slice.length - 1] === 0x0a) {
      slice = slice.subarray(0, slice.length - 2)
    } else if (
      slice.length > 0 &&
      (slice[slice.length - 1] === 0x0a || slice[slice.length - 1] === 0x0d)
    ) {
      slice = slice.subarray(0, slice.length - 1)
    }
    let decodedBytes = slice
    try {
      decodedBytes = unzlibSync(slice)
    } catch {
      // 未压缩流直接使用原字节
    }
    const streamText = new TextDecoder('latin1').decode(decodedBytes)
    if (streamText.includes('beginbfchar') || streamText.includes('beginbfrange')) {
      parseCmapEntries(streamText, cmap)
    } else if (streamText.includes('BT') && streamText.includes('ET')) {
      streams.push(streamText)
    }
    cursor = endIdx + endStreamToken.length
  }

  const extracted = streams
    .map((s) => extractPdfTextOperators(s, cmap))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  const readableChars = extracted.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '').length
  if (readableChars < 12) {
    return `[PDF 解析提示] 未提取到可用内嵌文本（该 PDF 可能是纯扫描图片或特殊字体编码，文件大小 ${Math.round(
      bytes.length / 1024
    )} KB）。`
  }
  return extracted
}
