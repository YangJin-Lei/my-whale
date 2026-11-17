import { create } from 'zustand'
import { streamMessage } from '../api/client.js'
import { useBalance } from '../balance.js'
import type { MemoryScope } from '../persona/types.js'
import { useSettings } from '../settings.js'
import { buildExtractUserPrompt, EXTRACT_SYSTEM_PROMPT } from './extractPrompt.js'
import { hasSensitiveInfo } from './sensitive.js'
import {
  addMemory,
  deleteMemory,
  restoreMemoriesBatch,
  updateMemory,
  useMemoryStore,
} from './store.js'
import type { Memory, MemoryCategory } from './types.js'

export type ExtractTurn = { role: 'user' | 'assistant'; content: string }

export type ExtractSnapshot = {
  sessionId: string
  incognito: boolean
  ephemeral: boolean
  memoryScope: MemoryScope
  localMemories: { id: string; content: string }[]
  turns: ExtractTurn[]
}

type UndoBatch = {
  count: number
  addedIds: string[]
  previous: Memory[]
  showCostNotice: boolean
}

type MemoryToastState = {
  batch: UndoBatch | null
}

export const useMemoryToast = create<MemoryToastState>(() => ({
  batch: null,
}))

let toastTimer: number | null = null
let localMemorySink: ((sessionId: string, contents: string[]) => void) | null = null

export const registerLocalMemorySink = (sink: (sessionId: string, contents: string[]) => void) => {
  localMemorySink = sink
}

export const dismissMemoryToast = () => {
  if (toastTimer !== null) {
    window.clearTimeout(toastTimer)
    toastTimer = null
  }
  useMemoryToast.setState({ batch: null })
}

export const undoMemoryToastBatch = async () => {
  const batch = useMemoryToast.getState().batch
  if (!batch) {
    return
  }
  dismissMemoryToast()
  await restoreMemoriesBatch({ addedIds: batch.addedIds, previous: batch.previous })
}

const showExtractToast = (batch: UndoBatch) => {
  if (toastTimer !== null) {
    window.clearTimeout(toastTimer)
  }
  useMemoryToast.setState({ batch })
  if (!batch.showCostNotice) {
    toastTimer = window.setTimeout(() => {
      useMemoryToast.setState({ batch: null })
      toastTimer = null
    }, 10_000)
  }
}

const DEBOUNCE_MS = 5_000

const extractedTurnCounts = new Map<string, number>()
const pendingTimers = new Map<string, number>()
const pendingSnapshots = new Map<string, ExtractSnapshot>()
const runningSessions = new Set<string>()

const bigrams = (text: string): Set<string> => {
  const clean = text.toLowerCase().replace(/\s+/g, '')
  const set = new Set<string>()
  if (clean.length <= 1) {
    if (clean) {
      set.add(clean)
    }
    return set
  }
  for (let i = 0; i < clean.length - 1; i += 1) {
    set.add(clean.slice(i, i + 2))
  }
  return set
}

const similarity = (a: string, b: string): number => {
  const sa = bigrams(a)
  const sb = bigrams(b)
  if (sa.size === 0 || sb.size === 0) {
    return 0
  }
  let inter = 0
  for (const token of sa) {
    if (sb.has(token)) {
      inter += 1
    }
  }
  const union = sa.size + sb.size - inter
  return union === 0 ? 0 : inter / union
}

type RawOp = {
  op?: unknown
  id?: unknown
  content?: unknown
  category?: unknown
}

const VALID_CATEGORIES = new Set<MemoryCategory>(['profile', 'preference', 'project', 'other'])

const parseExtractOps = (rawText: string): RawOp[] => {
  const trimmed = rawText.trim()
  const jsonText = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim()
  const start = jsonText.indexOf('[')
  const end = jsonText.lastIndexOf(']')
  if (start === -1 || end <= start) {
    return []
  }
  try {
    const parsed: unknown = JSON.parse(jsonText.slice(start, end + 1))
    return Array.isArray(parsed) ? (parsed as RawOp[]).slice(0, 5) : []
  } catch {
    return []
  }
}

export const seedExtractedBaseline = (sessionId: string, turnCount: number) => {
  if (!extractedTurnCounts.has(sessionId)) {
    extractedTurnCounts.set(sessionId, turnCount)
  }
}

const canRunAutoExtract = (snapshot: ExtractSnapshot): boolean => {
  const { apiKey, memoryEnabled, memoryAuto } = useSettings.getState()
  if (!apiKey || !memoryEnabled || !memoryAuto) {
    return false
  }
  if (snapshot.incognito || snapshot.ephemeral) {
    return false
  }
  if (useBalance.getState().status === 'insufficient') {
    return false
  }
  const completedCount = snapshot.turns.length
  const baseline = extractedTurnCounts.get(snapshot.sessionId) ?? 0
  // 只要完成至少 1 轮新的问答（>= 2 条消息），即可触发提炼判断
  return completedCount - baseline >= 2
}

const collectStreamText = async (apiKey: string, userPrompt: string): Promise<string> => {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 30_000)
  let output = ''
  try {
    const events = streamMessage(
      apiKey,
      {
        model: 'deepseek-flash',
        system: EXTRACT_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
        thinking: { type: 'disabled' },
        safety_check: { level: 'high' },
      },
      controller.signal
    )
    for await (const event of events) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        output += event.delta.text
      }
    }
    return output
  } finally {
    window.clearTimeout(timeout)
  }
}

export const runExtractNow = async (snapshot: ExtractSnapshot, manual = false): Promise<number> => {
  const { sessionId } = snapshot
  if (runningSessions.has(sessionId)) {
    return 0
  }
  if (!manual && !canRunAutoExtract(snapshot)) {
    return 0
  }
  const { apiKey, memoryNoticeShown } = useSettings.getState()
  if (!apiKey || snapshot.turns.length < 2) {
    return 0
  }
  runningSessions.add(sessionId)
  const targetTurnCount = snapshot.turns.length
  try {
    const existingGlobal = useMemoryStore.getState().memories
    const promptExisting: Memory[] =
      snapshot.memoryScope === 'local_only'
        ? snapshot.localMemories.map((m) => ({
            id: m.id,
            content: m.content,
            category: 'other',
            source: 'auto',
            pinned: false,
            enabled: true,
            createdAt: 0,
            updatedAt: 0,
          }))
        : existingGlobal

    const text = await collectStreamText(
      apiKey,
      buildExtractUserPrompt(promptExisting, snapshot.turns)
    )
    extractedTurnCounts.set(sessionId, targetTurnCount)

    const ops = parseExtractOps(text)
    if (ops.length === 0) {
      return 0
    }

    if (snapshot.memoryScope === 'local_only') {
      const additions: string[] = []
      for (const item of ops) {
        if ((item.op === 'add' || item.op === 'update') && typeof item.content === 'string') {
          const content = item.content.trim().slice(0, 80)
          if (!content || hasSensitiveInfo(content)) {
            continue
          }
          const dup =
            snapshot.localMemories.some((m) => similarity(m.content, content) >= 0.8) ||
            additions.some((c) => similarity(c, content) >= 0.8)
          if (!dup) {
            additions.push(content)
          }
        }
      }
      if (additions.length > 0) {
        localMemorySink?.(sessionId, additions)
      }
      return additions.length
    }

    const byId = new Map(existingGlobal.map((m) => [m.id, m]))
    const addedIds: string[] = []
    const previousMap = new Map<string, Memory>()
    let changeCount = 0

    for (const item of ops) {
      const op = item.op
      if (op === 'add' && typeof item.content === 'string') {
        const content = item.content.trim().slice(0, 80)
        if (!content || hasSensitiveInfo(content)) {
          continue
        }
        const isDuplicate = useMemoryStore
          .getState()
          .memories.some((m) => similarity(m.content, content) >= 0.8)
        if (isDuplicate) {
          continue
        }
        const category: MemoryCategory =
          typeof item.category === 'string' && VALID_CATEGORIES.has(item.category as MemoryCategory)
            ? (item.category as MemoryCategory)
            : 'other'
        const created = await addMemory({
          content,
          category,
          source: 'auto',
          sourceSessionId: sessionId,
        })
        if (created) {
          addedIds.push(created.id)
          changeCount += 1
        }
      } else if (
        op === 'update' &&
        typeof item.id === 'string' &&
        typeof item.content === 'string'
      ) {
        const prev = byId.get(item.id)
        const content = item.content.trim().slice(0, 80)
        if (!prev || !content || hasSensitiveInfo(content)) {
          continue
        }
        previousMap.set(prev.id, prev)
        await updateMemory(prev.id, { content })
        changeCount += 1
      } else if (op === 'delete' && typeof item.id === 'string') {
        const prev = byId.get(item.id)
        if (!prev) {
          continue
        }
        previousMap.set(prev.id, prev)
        await deleteMemory(prev.id)
        changeCount += 1
      }
    }

    if (changeCount > 0) {
      showExtractToast({
        count: changeCount,
        addedIds,
        previous: [...previousMap.values()],
        showCostNotice: !memoryNoticeShown,
      })
    }
    return changeCount
  } catch (error) {
    if (manual) {
      throw error
    }
    return 0
  } finally {
    runningSessions.delete(sessionId)
  }
}

export const scheduleExtract = (snapshot: ExtractSnapshot) => {
  const { sessionId } = snapshot
  const existingTimer = pendingTimers.get(sessionId)
  if (existingTimer !== undefined) {
    window.clearTimeout(existingTimer)
    pendingTimers.delete(sessionId)
  }
  if (!canRunAutoExtract(snapshot)) {
    pendingSnapshots.delete(sessionId)
    return
  }
  pendingSnapshots.set(sessionId, snapshot)
  const timer = window.setTimeout(() => {
    pendingTimers.delete(sessionId)
    const latest = pendingSnapshots.get(sessionId)
    pendingSnapshots.delete(sessionId)
    if (latest) {
      void runExtractNow(latest, false)
    }
  }, DEBOUNCE_MS)
  pendingTimers.set(sessionId, timer)
}

export const flushPendingExtracts = (onlySessionId?: string) => {
  const targets = onlySessionId
    ? pendingSnapshots.has(onlySessionId)
      ? [onlySessionId]
      : []
    : [...pendingSnapshots.keys()]

  for (const id of targets) {
    const timer = pendingTimers.get(id)
    if (timer !== undefined) {
      window.clearTimeout(timer)
      pendingTimers.delete(id)
    }
    const snapshot = pendingSnapshots.get(id)
    pendingSnapshots.delete(id)
    if (snapshot) {
      void runExtractNow(snapshot, false)
    }
  }
}
