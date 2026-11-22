import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LOCAL_VOICE_ID,
  LOCAL_VOICE_PACKS,
  TTS_ENGINES,
  buildVoicePackDownloadCandidates,
  findLocalVoicePack,
  resolveLocalVoiceSpeakerId,
} from '../engines.js'
import { splitSpeechSentences, stripSpeechMarkdown } from '../localTts.js'

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

    const chunks = splitSpeechSentences(raw, 28)
    expect(chunks.length).toBeGreaterThanOrEqual(2)
    expect(chunks.every((item) => item.length > 0)).toBe(true)
  })
})
