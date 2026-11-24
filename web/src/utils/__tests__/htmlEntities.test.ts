import { describe, expect, it } from 'vitest'
import { decodeHtmlEntities } from '../htmlEntities.js'

describe('decodeHtmlEntities', () => {
  it('decodes decimal, hex, double-encoded, and named entities seen in search snippets', () => {
    expect(decodeHtmlEntities('《论语&#183;学而》')).toBe('《论语·学而》')
    expect(decodeHtmlEntities('《诗经&#183;大雅&#183;文王》')).toBe('《诗经·大雅·文王》')
    expect(decodeHtmlEntities('也就是本应当用的&quot;正字&quot;')).toBe('也就是本应当用的"正字"')
    expect(decodeHtmlEntities('2026年11月10日&ensp;&#0183;&ensp;【本】')).toBe(
      '2026年11月10日 · 【本】'
    )
    expect(decodeHtmlEntities('&lt; 本：ㄅㄣˇ &gt;辭典檢視')).toBe('< 本：ㄅㄣˇ >辭典檢視')
    expect(decodeHtmlEntities('&amp;#183; &amp;quot;测试&#xB7;')).toBe('· "测试·')
  })
})
