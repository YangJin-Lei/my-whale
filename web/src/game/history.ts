import { create } from 'zustand'
import type { Locale } from '../services/settings.js'
import type { GameId, GameStatus } from './types.js'

const HISTORY_KEY = 'mywhale_game_history_v1'
const DECISION_CACHE_KEY = 'mywhale_game_decision_cache_v1'
const DRAW_PUZZLE_CACHE_KEY = 'mywhale_drawguess_cache_v1'

const MAX_HISTORY_RECORDS = 20
const MAX_DECISION_ENTRIES = 80
const MAX_DRAW_PUZZLES = 60

/** 决策缓存协议版本：结构调整后递增，旧条目读取时自动淘汰 */
const DECISION_CACHE_VERSION = 2
/** 决策缓存有效期，过期的旧局面不再回放 */
const DECISION_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000
/** 题库缓存有效期，避免长期堆积过期 HTML */
const DRAW_PUZZLE_TTL_MS = 30 * 24 * 60 * 60 * 1000

export type GameHistoryRecord = {
  id: string
  gameId: GameId
  opponentId: string
  opponentName: string
  status: GameStatus
  scoreLabel: string
  state: unknown
  bubbleText: string
  thoughtText: string
  createdAt: number
  updatedAt: number
}

export type CachedDrawGuessPuzzle = {
  answer: string
  hint: string
  html: string
  savedAt: number
}

type CachedDecisionEntry = {
  key: string
  move: unknown
  thoughtSummary: string
  speech: string
  savedAt: number
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null

const readStorageJson = <T>(key: string, fallback: T): T => {
  if (typeof window === 'undefined') {
    return fallback
  }
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

const writeStorageJson = (key: string, value: unknown): void => {
  if (typeof window === 'undefined') {
    return
  }
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // 存储空间不足时忽略缓存写入失败
  }
}

const sanitizeHistoryList = (raw: unknown): GameHistoryRecord[] => {
  if (!Array.isArray(raw)) {
    return []
  }
  const out: GameHistoryRecord[] = []
  for (const item of raw) {
    const obj = asRecord(item)
    if (
      !obj ||
      typeof obj.id !== 'string' ||
      typeof obj.gameId !== 'string' ||
      typeof obj.status !== 'string' ||
      obj.state === undefined
    ) {
      continue
    }
    out.push({
      id: obj.id,
      gameId: obj.gameId as GameId,
      opponentId: typeof obj.opponentId === 'string' ? obj.opponentId : 'default',
      opponentName: typeof obj.opponentName === 'string' ? obj.opponentName : '',
      status: obj.status as GameStatus,
      scoreLabel: typeof obj.scoreLabel === 'string' ? obj.scoreLabel : '',
      state: obj.state,
      bubbleText: typeof obj.bubbleText === 'string' ? obj.bubbleText : '',
      thoughtText: typeof obj.thoughtText === 'string' ? obj.thoughtText : '',
      createdAt: typeof obj.createdAt === 'number' ? obj.createdAt : Date.now(),
      updatedAt: typeof obj.updatedAt === 'number' ? obj.updatedAt : Date.now(),
    })
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_HISTORY_RECORDS)
}

export const useGameHistory = create<{ records: GameHistoryRecord[] }>(() => ({
  records: sanitizeHistoryList(readStorageJson<unknown>(HISTORY_KEY, [])),
}))

const statusTag = (status: GameStatus, locale: Locale): string => {
  if (status === 'player_win') {
    return locale === 'zh-CN' ? '你赢了' : 'Won'
  }
  if (status === 'ai_win') {
    return locale === 'zh-CN' ? 'AI 胜' : 'AI Won'
  }
  if (status === 'draw') {
    return locale === 'zh-CN' ? '和棋' : 'Draw'
  }
  return locale === 'zh-CN' ? '进行中' : 'In Progress'
}

export const formatGameScoreLabel = (
  gameId: GameId,
  state: unknown,
  status: GameStatus,
  locale: Locale
): string => {
  const obj = asRecord(state)
  const tag = statusTag(status, locale)
  if (!obj) {
    return tag
  }

  if (gameId === 'draw_guess') {
    const h = typeof obj.playerScore === 'number' ? obj.playerScore : 0
    const a = typeof obj.aiScore === 'number' ? obj.aiScore : 0
    const round = typeof obj.round === 'number' ? obj.round : 1
    return locale === 'zh-CN'
      ? `${tag} · 你 ${h} : AI ${a} (第${round}轮)`
      : `${tag} · You ${h} : AI ${a} (R${round})`
  }

  if (gameId === 'gomoku' || gameId === 'xiangqi') {
    const moves = Array.isArray(obj.moves)
      ? obj.moves.length
      : Array.isArray(obj.history)
        ? obj.history.length
        : 0
    return locale === 'zh-CN' ? `${tag} · ${moves} 手` : `${tag} · ${moves} moves`
  }

  if (gameId === 'doudizhu') {
    const hands = asRecord(obj.hands)
    const humanCount = hands && Array.isArray(hands.human) ? hands.human.length : null
    const aiCount = hands && Array.isArray(hands.ai) ? hands.ai.length : null
    if (humanCount !== null && aiCount !== null) {
      return locale === 'zh-CN'
        ? `${tag} · 剩牌 ${humanCount}:${aiCount}`
        : `${tag} · Cards ${humanCount}:${aiCount}`
    }
    return tag
  }

  if (gameId === 'werewolf') {
    const day = typeof obj.day === 'number' ? obj.day : 1
    const seats = Array.isArray(obj.seats) ? obj.seats : []
    const alive = seats.filter((s) => asRecord(s)?.alive === true).length
    return locale === 'zh-CN'
      ? `${tag} · 第${day}天 (${alive}/${seats.length}活)`
      : `${tag} · D${day} (${alive}/${seats.length})`
  }

  return tag
}

export const upsertGameHistoryRecord = (record: GameHistoryRecord): void => {
  useGameHistory.setState((prev) => {
    const filtered = prev.records.filter((r) => r.id !== record.id)
    const next = [record, ...filtered].slice(0, MAX_HISTORY_RECORDS)
    writeStorageJson(HISTORY_KEY, next)
    return { records: next }
  })
}

export const deleteGameHistoryRecord = (id: string): void => {
  useGameHistory.setState((prev) => {
    const next = prev.records.filter((r) => r.id !== id)
    writeStorageJson(HISTORY_KEY, next)
    return { records: next }
  })
}

export const clearAllGameHistory = (): void => {
  writeStorageJson(HISTORY_KEY, [])
  useGameHistory.setState({ records: [] })
}

export const getGameHistorySnapshot = (): GameHistoryRecord[] => useGameHistory.getState().records

export const restoreGameHistorySnapshot = (raw: unknown): void => {
  const incoming = sanitizeHistoryList(raw)
  if (incoming.length === 0) {
    return
  }
  useGameHistory.setState((prev) => {
    const map = new Map(prev.records.map((r) => [r.id, r]))
    for (const item of incoming) {
      const existing = map.get(item.id)
      if (!existing || item.updatedAt > existing.updatedAt) {
        map.set(item.id, item)
      }
    }
    const merged = [...map.values()]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_HISTORY_RECORDS)
    writeStorageJson(HISTORY_KEY, merged)
    return { records: merged }
  })
}

const fnv1a = (input: string): string => {
  let hash = 2166136261
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

export type DecisionCacheKeyInput = {
  gameId: GameId
  opponentId: string
  locale: Locale
  thinking: boolean
  state: unknown
  /** 实际下发给模型的系统提示词指纹，覆盖语言、人设与规则版本 */
  systemPrompt: string
}

export const buildDecisionCacheKey = ({
  gameId,
  opponentId,
  locale,
  thinking,
  state,
  systemPrompt,
}: DecisionCacheKeyInput): string =>
  [
    `v${DECISION_CACHE_VERSION}`,
    gameId,
    opponentId,
    locale,
    thinking ? '1' : '0',
    fnv1a(systemPrompt),
    fnv1a(JSON.stringify(state) ?? ''),
  ].join(':')

const isFreshDecisionEntry = (value: unknown, now: number): value is CachedDecisionEntry => {
  const obj = asRecord(value)
  return (
    obj !== null &&
    typeof obj.key === 'string' &&
    obj.key.startsWith(`v${DECISION_CACHE_VERSION}:`) &&
    obj.move !== undefined &&
    typeof obj.thoughtSummary === 'string' &&
    typeof obj.speech === 'string' &&
    typeof obj.savedAt === 'number' &&
    now - obj.savedAt <= DECISION_CACHE_TTL_MS
  )
}

const readDecisionEntries = (now: number): CachedDecisionEntry[] => {
  const raw = readStorageJson<unknown>(DECISION_CACHE_KEY, [])
  if (!Array.isArray(raw)) {
    return []
  }
  return raw
    .filter((item) => isFreshDecisionEntry(item, now))
    .map((item) => item as CachedDecisionEntry)
}

export const getCachedGameDecision = (cacheKey: string): CachedDecisionEntry | null => {
  const now = Date.now()
  const entries = readDecisionEntries(now)
  const hit = entries.find((item) => item.key === cacheKey)
  if (!hit) {
    return null
  }
  return {
    key: hit.key,
    move: hit.move,
    thoughtSummary: hit.thoughtSummary,
    speech: hit.speech,
    savedAt: hit.savedAt,
  }
}

export const saveCachedGameDecision = (entry: Omit<CachedDecisionEntry, 'savedAt'>): void => {
  const now = Date.now()
  const current = readDecisionEntries(now)
  const filtered = current.filter((item) => item.key !== entry.key)
  const next = [{ ...entry, savedAt: now }, ...filtered].slice(0, MAX_DECISION_ENTRIES)
  writeStorageJson(DECISION_CACHE_KEY, next)
}

/** 清空 AI 决策回放缓存（不影响对局历史） */
export const clearGameDecisionCache = (): void => {
  writeStorageJson(DECISION_CACHE_KEY, [])
}

const readPuzzlePool = (): CachedDrawGuessPuzzle[] => {
  const raw = readStorageJson<unknown>(DRAW_PUZZLE_CACHE_KEY, [])
  if (!Array.isArray(raw)) {
    return []
  }
  const now = Date.now()
  return raw
    .map((item) => asRecord(item))
    .filter(
      (obj): obj is Record<string, unknown> =>
        obj !== null &&
        typeof obj.answer === 'string' &&
        obj.answer.trim().length > 0 &&
        typeof obj.html === 'string' &&
        obj.html.trim().length > 0 &&
        typeof obj.savedAt === 'number' &&
        now - obj.savedAt <= DRAW_PUZZLE_TTL_MS
    )
    .map((obj) => ({
      answer: String(obj.answer).trim(),
      hint: typeof obj.hint === 'string' ? obj.hint.trim() : '',
      html: String(obj.html),
      savedAt: typeof obj.savedAt === 'number' ? obj.savedAt : Date.now(),
    }))
}

export const getCachedDrawGuessCount = (): number => readPuzzlePool().length

export const saveCachedDrawGuessPuzzle = (puzzle: {
  answer: string
  hint: string
  html: string
}): void => {
  const answer = puzzle.answer.trim()
  if (!answer || !puzzle.html.trim()) {
    return
  }
  const pool = readPuzzlePool().filter((item) => item.answer !== answer)
  const next = [
    { answer, hint: puzzle.hint.trim(), html: puzzle.html, savedAt: Date.now() },
    ...pool,
  ].slice(0, MAX_DRAW_PUZZLES)
  writeStorageJson(DRAW_PUZZLE_CACHE_KEY, next)
}

export const pickCachedDrawGuessPuzzle = (usedIdioms: string[]): CachedDrawGuessPuzzle | null => {
  const used = new Set(usedIdioms.map((s) => s.trim()))
  const available = readPuzzlePool().filter((item) => !used.has(item.answer))
  if (available.length === 0) {
    return null
  }
  const index = Math.floor(Math.random() * available.length)
  return available[index] ?? null
}

/** 清空你画我猜题库缓存（不影响正在进行的对局） */
export const clearDrawGuessCache = (): void => {
  writeStorageJson(DRAW_PUZZLE_CACHE_KEY, [])
}
