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
import { buildIflytekAuthUrl, splitIflytekTextChunks } from '../iflytekTts.js'

describe('speech engines & local voice packs', () => {
  it('defaults to local-sherpa & keeps nekospeak reserved as unavailable', () => {
    const localEngine = TTS_ENGINES.find((item) => item.id === 'local-sherpa')
    const iflyEngine = TTS_ENGINES.find((item) => item.id === 'iflytek')
    const nekoEngine = TTS_ENGINES.find((item) => item.id === 'nekospeak')
    expect(localEngine?.available).toBe(true)
    expect(iflyEngine?.available).toBe(true)
    expect(nekoEngine?.available).toBe(false)
    expect(nekoEngine?.labelZh).toContain('暂未开放')

    expect(LOCAL_VOICE_PACKS.every((pack) => pack.builtIn === false)).toBe(true)
    const melo = findLocalVoicePack(DEFAULT_LOCAL_VOICE_ID)
    expect(melo.builtIn).toBe(false)
    expect(melo.id).toBe('melo-zh-en')
    expect(melo.format).toBe('vits-melo')
    expect(melo.defaultSid).toBe(0)
    expect(findLocalVoicePack('default-zh').id).toBe('melo-zh-en')

    const kokoro11 = findLocalVoicePack('kokoro-v1_1')
    expect(kokoro11.format).toBe('kokoro')
    expect(kokoro11.defaultSid).toBe(3)
    expect(resolveLocalVoiceSpeakerId(kokoro11, 58)).toBe(58)
    expect(resolveLocalVoiceSpeakerId(kokoro11, 9999)).toBe(3)

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

  it('builds signed iFlytek v2 WebSocket URL and splits long text while keeping typical messages in 1 call', async () => {
    const authUrl = await buildIflytekAuthUrl({
      apiKey: 'test-api-key',
      apiSecret: 'test-api-secret',
    })
    const parsed = new URL(authUrl)
    expect(parsed.protocol).toBe('wss:')
    expect(parsed.hostname).toBe('tts-api.xfyun.cn')
    expect(parsed.pathname).toBe('/v2/tts')
    expect(parsed.searchParams.get('host')).toBe('tts-api.xfyun.cn')
    expect(parsed.searchParams.get('date')).toMatch(/GMT$/)

    const decodedAuth = atob(parsed.searchParams.get('authorization') ?? '')
    expect(decodedAuth).toContain('api_key="test-api-key"')
    expect(decodedAuth).toContain('algorithm="hmac-sha256"')
    expect(decodedAuth).toContain('headers="host date request-line"')
    expect(decodedAuth).toContain('signature="')

    const normalChunks = splitIflytekTextChunks('你好，这是一段正常的测试回复。')
    expect(normalChunks).toHaveLength(1)

    const longText = '这是一句较长的中文测试句子用于验证超长文本分段。'.repeat(120)
    const splitChunks = splitIflytekTextChunks(longText)
    expect(splitChunks.length).toBeGreaterThan(1)
    const encoder = new TextEncoder()
    expect(splitChunks.every((chunk) => encoder.encode(chunk).length <= 2400)).toBe(true)
  })
})
