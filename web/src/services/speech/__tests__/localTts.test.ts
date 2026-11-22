import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LOCAL_VOICE_ID,
  LOCAL_VOICE_PACKS,
  TTS_ENGINES,
  buildVoicePackDownloadCandidates,
  findLocalVoicePack,
  resolveLocalVoiceSpeakerId,
} from '../engines.js'
import {
  normalizeEnglishForSpeech,
  splitSpeechSentences,
  stripSpeechMarkdown,
} from '../localTts.js'

describe('speech engines & local voice packs', () => {
  it('defaults to local-sherpa & keeps nekospeak reserved as unavailable', () => {
    const localEngine = TTS_ENGINES.find((item) => item.id === 'local-sherpa')
    const nekoEngine = TTS_ENGINES.find((item) => item.id === 'nekospeak')
    expect(localEngine?.available).toBe(true)
    expect(nekoEngine?.available).toBe(false)
    expect(nekoEngine?.labelZh).toContain('暂未开放')

    const builtIn = findLocalVoicePack(DEFAULT_LOCAL_VOICE_ID)
    expect(builtIn.builtIn).toBe(true)
    expect(builtIn.id).toBe('default-zh')
    expect(builtIn.format).toBe('kokoro')
    expect(builtIn.defaultSid).toBe(3)
    expect(resolveLocalVoiceSpeakerId(builtIn, 58)).toBe(58)
    expect(resolveLocalVoiceSpeakerId(builtIn, 9999)).toBe(3)

    const v10 = findLocalVoicePack('kokoro-v1_0')
    expect(v10.id).toBe('kokoro-v1_0')
    expect(v10.sizeMb).toBe(126.2)
    expect(v10.defaultSid).toBe(47)
    expect(v10.speakers?.some((s) => s.sid === 37)).toBe(true)
  })

  it('builds deduplicated multi-mirror + direct GitHub download candidates', () => {
    const huayan = LOCAL_VOICE_PACKS.find((item) => item.id === 'huayan-medium')
    expect(huayan).toBeDefined()
    if (!huayan) {
      return
    }
    const candidates = buildVoicePackDownloadCandidates(huayan, 'https://ghfast.top/')
    expect(candidates[0]).toBe(`https://ghfast.top/${huayan.archiveUrl}`)
    expect(candidates.at(-1)).toBe(huayan.archiveUrl)
    expect(new Set(candidates).size).toBe(candidates.length)
  })

  it('strips markdown formatting and splits long replies into short speech chunks', () => {
    const raw = [
      '# 标题一',
      '',
      '这是第一句很完整的中文解释。[链接](https://example.com)',
      '```ts',
      'const a = 1',
      '```',
      '然后是第二句！最后一句要不要试试？',
    ].join('\n')

    const cleaned = stripSpeechMarkdown(raw)
    expect(cleaned).not.toContain('#')
    expect(cleaned).not.toContain('https://example.com')
    expect(cleaned).toContain('代码块已略过')

    const chunks = splitSpeechSentences(raw, 40, 22)
    expect(chunks.length).toBeGreaterThanOrEqual(2)
    expect(chunks[0].length).toBeLessThanOrEqual(22)
    expect(chunks.every((item) => item.length > 0)).toBe(true)
  })

  it('normalizes glued punctuation, camelCase, tech compounds, versions, and acronyms for English TTS', () => {
    const sample =
      '更新 my-whale 到 v0.1.26：通过 (API) 调用 DeepSeek，修复 useEffect 与 JSON/TTS 问题。'
    const normalized = normalizeEnglishForSpeech(sample)
    expect(normalized).toContain('my whale')
    expect(normalized).toContain('v 0 点 1 点 26')
    expect(normalized).toContain('A P I')
    expect(normalized).toContain('Deep Seek')
    expect(normalized).toContain('use Effect')
    expect(normalized).toContain('J S O N')
    expect(normalized).toContain('T T S')
    expect(normalized).not.toContain('(API)')
    // Pronounceable ALL-CAPS words like OK / AI / RAM stay intact
    expect(normalizeEnglishForSpeech('OK，AI 和 RAM 都正常')).toContain('OK，AI 和 RAM')
  })
})
