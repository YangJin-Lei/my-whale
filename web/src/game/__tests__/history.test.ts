import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildDecisionCacheKey,
  clearGameDecisionCache,
  getCachedGameDecision,
  saveCachedGameDecision,
} from '../history.js'

const storage = new Map<string, string>()

const installWindow = () => {
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value)
      },
      removeItem: (key: string) => {
        storage.delete(key)
      },
      clear: () => storage.clear(),
    },
  })
}

const buildKey = (locale: 'zh-CN' | 'en-US', systemPrompt: string, state: unknown = { turn: 1 }) =>
  buildDecisionCacheKey({
    gameId: 'gomoku',
    opponentId: 'default',
    locale,
    thinking: true,
    state,
    systemPrompt,
  })

beforeEach(() => {
  storage.clear()
  installWindow()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('buildDecisionCacheKey', () => {
  it('inflates locale and system prompt into the key', () => {
    const zh = buildKey('zh-CN', '人设 A')
    const en = buildKey('en-US', '人设 A')
    const changedPersona = buildKey('zh-CN', '人设 B')

    expect(zh).not.toBe(en)
    expect(zh).not.toBe(changedPersona)
    expect(zh.startsWith('v2:gomoku:default:zh-CN:1:')).toBe(true)
  })

  it('changes with the board state', () => {
    const before = buildKey('zh-CN', '人设 A', { turn: 1 })
    const after = buildKey('zh-CN', '人设 A', { turn: 2 })
    expect(before).not.toBe(after)
  })
})

describe('decision cache lifecycle', () => {
  it('returns a saved decision and expires it after the ttl', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const key = buildKey('zh-CN', '人设 A')
    saveCachedGameDecision({
      key,
      move: 'H8',
      thoughtSummary: '稳住中路',
      speech: '该你了',
    })

    expect(getCachedGameDecision(key)?.move).toBe('H8')

    vi.setSystemTime(new Date('2026-01-09T00:00:00Z'))
    expect(getCachedGameDecision(key)).toBeNull()
  })

  it('drops legacy v1 entries instead of replaying them', () => {
    storage.set(
      'mywhale_game_decision_cache_v1',
      JSON.stringify([
        {
          key: 'gomoku:default:1:legacy',
          move: 'A1',
          thoughtSummary: '旧缓存',
          speech: '旧台词',
          savedAt: Date.now(),
        },
      ])
    )

    const key = buildKey('zh-CN', '人设 A')
    saveCachedGameDecision({
      key,
      move: 'H8',
      thoughtSummary: '新缓存',
      speech: '新台词',
    })

    const raw = JSON.parse(storage.get('mywhale_game_decision_cache_v1') ?? '[]') as Array<{
      key: string
    }>
    expect(raw.map((item) => item.key)).toEqual([key])
  })

  it('can be cleared without touching other game caches', () => {
    const key = buildKey('zh-CN', '人设 A')
    saveCachedGameDecision({ key, move: 'H8', thoughtSummary: '', speech: '' })
    clearGameDecisionCache()
    expect(getCachedGameDecision(key)).toBeNull()
  })
})
