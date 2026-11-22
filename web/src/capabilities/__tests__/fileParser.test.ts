import { strToU8, zipSync, zlibSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { parseDocumentBytes } from '../fileParser.js'

const buildSimpleDocx = (title: string, body: string, cellA: string, cellB: string): Uint8Array => {
  const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
  <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
    <w:body>
      <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${title}</w:t></w:r></w:p>
      <w:p><w:r><w:t>${body}</w:t></w:r></w:p>
      <w:tbl>
        <w:tr><w:tc><w:p><w:r><w:t>列一</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>列二</w:t></w:r></w:p></w:tc></w:tr>
        <w:tr><w:tc><w:p><w:r><w:t>${cellA}</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>${cellB}</w:t></w:r></w:p></w:tc></w:tr>
      </w:tbl>
    </w:body>
  </w:document>`
  return zipSync({ 'word/document.xml': strToU8(docXml) })
}

const buildSimpleXlsx = (): Uint8Array => {
  const shared = `<?xml version="1.0" encoding="UTF-8"?><sst><si><t>姓名</t></si><si><t>分数</t></si><si><t>小明</t></si></sst>`
  const workbook = `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="成绩单" sheetId="1" r:id="rId1"/></sheets></workbook>`
  const rels = `<?xml version="1.0" encoding="UTF-8"?><Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`
  const sheet = `<?xml version="1.0" encoding="UTF-8"?><worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>98</v></c></row></sheetData></worksheet>`
  return zipSync({
    'xl/sharedStrings.xml': strToU8(shared),
    'xl/workbook.xml': strToU8(workbook),
    'xl/_rels/workbook.xml.rels': strToU8(rels),
    'xl/worksheets/sheet1.xml': strToU8(sheet),
  })
}

const buildSimplePptx = (): Uint8Array => {
  const slide = `<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>第一页标题</a:t></a:r></a:p><a:p><a:r><a:t>核心要点内容</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`
  const notes = `<?xml version="1.0" encoding="UTF-8"?><p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>演讲者备注测试</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>`
  return zipSync({
    'ppt/slides/slide1.xml': strToU8(slide),
    'ppt/notesSlides/notesSlide1.xml': strToU8(notes),
  })
}

const buildSimpleEpub = (): Uint8Array => {
  const container = `<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>`
  const opf = `<?xml version="1.0"?><package><manifest><item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>`
  const ch1 = `<html><body><h1>第一章</h1><p>青铜巨门缓缓开启。</p></body></html>`
  return zipSync({
    'META-INF/container.xml': strToU8(container),
    'OEBPS/content.opf': strToU8(opf),
    'OEBPS/ch1.xhtml': strToU8(ch1),
  })
}

describe('capabilities local file parser', () => {
  it('decodes GBK/GB18030 Chinese txt & csv without mojibake', () => {
    // GBK bytes for "中文龙族测试"
    const gbkBytes = Uint8Array.from([
      0xd6, 0xd0, 0xce, 0xc4, 0xc1, 0xfa, 0xd7, 0xe5, 0xb2, 0xe2, 0xca, 0xd4,
    ])
    const txtRes = parseDocumentBytes(gbkBytes, '【不一样的龙族】.txt')
    expect(txtRes.kind).toBe('text')
    if (txtRes.kind === 'text') {
      expect(txtRes.rawBody).toBe('中文龙族测试')
      expect(txtRes.text).toContain('【不一样的龙族】.txt')
    }

    const csvBytes = Uint8Array.from([
      0xd0, 0xd5, 0xc3, 0xfb, 0x2c, 0xb1, 0xb8, 0xd7, 0xa2, 0x0a, 0xc2, 0xb7, 0xc3, 0xf7, 0xb7,
      0xc7, 0x2c, 0x22, 0x53, 0x2c, 0x41, 0x22,
    ])
    const csvRes = parseDocumentBytes(csvBytes, '角色.csv')
    expect(csvRes.kind).toBe('text')
    if (csvRes.kind === 'text') {
      expect(csvRes.rawBody).toContain('| 姓名 | 备注 |')
      expect(csvRes.rawBody).toContain('| 路明非 | S,A |')
    }
  })

  it('extracts ZIP archives including nested docs, triple-backtick code, GBK entry names, and filters junk', () => {
    const docxBytes = buildSimpleDocx('设定大纲', '世界观介绍', '元素', '青铜与火')
    const nestedZip = zipSync({ 'nested.md': strToU8('# 嵌套章节\n内容正常') })
    // Simulate Windows GBK encoded filename stored as Latin1 char codes in ZIP header
    const gbkNameBytes = [0xc1, 0xfa, 0xd7, 0xe5, 0x2e, 0x74, 0x78, 0x74] // "龙族.txt"
    const gbkLatin1Name = String.fromCharCode(...gbkNameBytes)

    const outerZip = zipSync({
      '__MACOSX/._junk': strToU8('junk'),
      '.DS_Store': strToU8('junk'),
      [gbkLatin1Name]: strToU8('你好，屠龙者'),
      'readme.md': strToU8('示例:\n```ts\nconst a = 1\n```'),
      'docs/outline.docx': docxBytes,
      'sub/inner.zip': nestedZip,
      'bin/app.bin': Uint8Array.from([0x00, 0x01, 0x02, 0xff]),
    })

    const res = parseDocumentBytes(outerZip, '【不一样的龙族】.zip')
    expect(res.kind).toBe('text')
    if (res.kind === 'text') {
      expect(res.rawBody).toContain('- 龙族.txt')
      expect(res.rawBody).not.toContain('__MACOSX')
      expect(res.rawBody).toContain('你好，屠龙者')
      expect(res.rawBody).toContain('````markdown')
      expect(res.rawBody).toContain('# 设定大纲')
      expect(res.rawBody).toContain('| 元素 | 青铜与火 |')
      expect(res.rawBody).toContain('# 嵌套章节')
      expect(res.rawBody).toContain('bin/app.bin（二进制文件')
    }
  })

  it('parses xlsx, pptx, epub, rtf, and FlateDecode pdf with ToUnicode CMap cleanly', () => {
    const xlsxRes = parseDocumentBytes(buildSimpleXlsx(), 'score.xlsx')
    expect(xlsxRes.kind).toBe('text')
    if (xlsxRes.kind === 'text') {
      expect(xlsxRes.rawBody).toContain('### Sheet: 成绩单')
      expect(xlsxRes.rawBody).toContain('| 小明 | 98 |')
    }

    const pptxRes = parseDocumentBytes(buildSimplePptx(), 'deck.pptx')
    expect(pptxRes.kind).toBe('text')
    if (pptxRes.kind === 'text') {
      expect(pptxRes.rawBody).toContain('## Slide 1')
      expect(pptxRes.rawBody).toContain('第一页标题')
      expect(pptxRes.rawBody).toContain('> Notes: 演讲者备注测试')
    }

    const epubRes = parseDocumentBytes(buildSimpleEpub(), 'book.epub')
    expect(epubRes.kind).toBe('text')
    if (epubRes.kind === 'text') {
      expect(epubRes.rawBody).toContain('# 第一章')
      expect(epubRes.rawBody).toContain('青铜巨门缓缓开启。')
    }

    const rtfRes = parseDocumentBytes(
      strToU8("{\\rtf1\\ansi {\\fonttbl Test}\\'d6\\'d0\\'ce\\'c4\\par OK}"),
      'note.rtf'
    )
    expect(rtfRes.kind).toBe('text')
    if (rtfRes.kind === 'text') {
      expect(rtfRes.rawBody).toBe('中文\nOK')
    }

    const cmapStream = zlibSync(strToU8('beginbfchar\n<0001> <4E2D>\n<0002> <6587>\nendbfchar'))
    const textStream = zlibSync(strToU8('BT\n<00010002> Tj\n(Hello PDF World) Tj\nET'))
    const pdfChunks = [
      strToU8('%PDF-1.4\n1 0 obj\n<<>>\nstream\n'),
      cmapStream,
      strToU8('\nendstream\n2 0 obj\n<<>>\nstream\n'),
      textStream,
      strToU8('\nendstream\n%%EOF'),
    ]
    const totalLen = pdfChunks.reduce((s, c) => s + c.length, 0)
    const pdfBytes = new Uint8Array(totalLen)
    let offset = 0
    for (const c of pdfChunks) {
      pdfBytes.set(c, offset)
      offset += c.length
    }
    const pdfRes = parseDocumentBytes(pdfBytes, 'doc.pdf')
    expect(pdfRes.kind).toBe('text')
    if (pdfRes.kind === 'text') {
      expect(pdfRes.rawBody).toContain('中文Hello PDF World')
    }
  })

  it('converts raster images to base64 and keeps svg as xml text', () => {
    const pngBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47])
    const img = parseDocumentBytes(pngBytes, 'pic.png', 'image/png')
    expect(img.kind).toBe('image')
    if (img.kind === 'image') {
      expect(img.mimeType).toBe('image/png')
      expect(img.base64).toBeTruthy()
    }

    const svg = parseDocumentBytes(
      strToU8('<svg viewBox="0 0 10 10"/>'),
      'icon.svg',
      'image/svg+xml'
    )
    expect(svg.kind).toBe('text')
    if (svg.kind === 'text') {
      expect(svg.rawBody).toContain('<svg')
    }
  })

  it('handles 1MB GBK txt files with stray null bytes and caps context length cleanly', () => {
    const unit = [0xd6, 0xd0, 0xce, 0xc4, 0xc1, 0xfa, 0xd7, 0xe5] // "中文龙族" in GBK (8 bytes)
    const size = 1024 * 1024
    const buf = new Uint8Array(size)
    for (let i = 0; i + unit.length <= size; i += unit.length) {
      buf.set(unit, i)
    }
    buf[100] = 0x00 // stray null byte inside exported novel
    const res = parseDocumentBytes(buf, '【不一样的龙族】1MB.txt', 'text/plain')
    expect(res.kind).toBe('text')
    if (res.kind === 'text') {
      expect(res.truncated).toBe(true)
      expect(res.text).toContain('已截取前 48000 字符')
      expect(res.text).toContain('中文龙族')
      expect(res.text).not.toContain('\u0000')
    }
  })
})
