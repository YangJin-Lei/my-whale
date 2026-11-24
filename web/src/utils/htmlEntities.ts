const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ensp: ' ',
  emsp: ' ',
  thinsp: ' ',
  zwnj: '',
  zwj: '',
  shy: '',
  middot: '·',
  bull: '•',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  laquo: '«',
  raquo: '»',
  copy: '©',
  reg: '®',
  trade: '™',
  times: '×',
  divide: '÷',
  plusmn: '±',
  deg: '°',
  yen: '¥',
  euro: '€',
  pound: '£',
  cent: '¢',
}

const decodeOnce = (input: string): string =>
  input.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, token: string) => {
    if (token.startsWith('#x') || token.startsWith('#X')) {
      const cp = Number.parseInt(token.slice(2), 16)
      return Number.isFinite(cp) && cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : match
    }
    if (token.startsWith('#')) {
      const cp = Number.parseInt(token.slice(1), 10)
      return Number.isFinite(cp) && cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : match
    }
    return NAMED_ENTITIES[token.toLowerCase()] ?? match
  })

/**
 * 解码搜索摘要、标题及抓取文本中的 HTML 字符实体（兼容双重转义如 &amp;#183;）。
 */
export const decodeHtmlEntities = (input: string): string => {
  if (!input || !input.includes('&')) {
    return input
  }
  const pass1 = decodeOnce(input)
  const pass2 = pass1.includes('&') ? decodeOnce(pass1) : pass1
  return pass2.replace(/[ \t]{2,}/g, ' ')
}
