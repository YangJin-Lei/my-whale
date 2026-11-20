import { create } from 'zustand'
import { createMessage } from '../api/client.js'
import { useSettings } from '../settings.js'
import { getContextRounds, getReplyText } from './reply.js'
import type {
  AssistantMessage,
  CompactionLevel,
  CompactionRecord,
  CompactionRecordCategory,
  CompactionSegment,
  Message,
  Session,
  SessionCompaction,
  UserMessage,
} from './types.js'

export type CompactionPreset = {
  level: CompactionLevel
  inputBudget: number
  tailBudget: number
  minTailRounds: number
  maxTailRounds: number
  batchTokens: number
  summaryMaxChars: number
  minGrowthRounds: number
  evidenceBudget: number
  maxSegments: number
  maxRecords: number
}

// 参照官方做法（接近上下文窗口时才压缩、一次大批量摘要）：
// 触发阈值大幅提高，单批 token 加大以减少回复前的串行 API 调用次数。
export const COMPACTION_PRESETS: Record<CompactionLevel, CompactionPreset> = {
  light: {
    level: 'light',
    inputBudget: 96_000,
    tailBudget: 48_000,
    minTailRounds: 8,
    maxTailRounds: 80,
    batchTokens: 32_000,
    summaryMaxChars: 900,
    minGrowthRounds: 10,
    evidenceBudget: 1_500,
    maxSegments: 8,
    maxRecords: 48,
  },
  medium: {
    level: 'medium',
    inputBudget: 64_000,
    tailBudget: 28_000,
    minTailRounds: 6,
    maxTailRounds: 48,
    batchTokens: 32_000,
    summaryMaxChars: 800,
    minGrowthRounds: 8,
    evidenceBudget: 1_800,
    maxSegments: 6,
    maxRecords: 36,
  },
  heavy: {
    level: 'heavy',
    inputBudget: 32_000,
    tailBudget: 12_000,
    minTailRounds: 3,
    maxTailRounds: 20,
    batchTokens: 24_000,
    summaryMaxChars: 600,
    minGrowthRounds: 5,
    evidenceBudget: 1_000,
    maxSegments: 4,
    maxRecords: 24,
  },
}

const VALID_CATEGORIES = new Set<CompactionRecordCategory>([
  'setting',
  'preference',
  'boundary',
  'event',
  'promise',
  'correction',
])

const CATEGORY_CAPS: Record<CompactionRecordCategory, number> = {
  setting: 12,
  preference: 10,
  boundary: 10,
  event: 12,
  promise: 8,
  correction: 10,
}

type CompactionUIState = {
  modalSessionId: string | null
  runningSessionId: string | null
  lastError: string | null
}

export const useCompactionStore = create<CompactionUIState>(() => ({
  modalSessionId: null,
  runningSessionId: null,
  lastError: null,
}))

export const openCompactionModal = (sessionId: string) => {
  useCompactionStore.setState({ modalSessionId: sessionId, lastError: null })
}

export const closeCompactionModal = () => {
  useCompactionStore.setState({ modalSessionId: null })
}

const activeCompactionControllers = new Map<string, AbortController>()

export const abortCompaction = (sessionId: string) => {
  activeCompactionControllers.get(sessionId)?.abort()
}

export const estimateTextTokens = (text: string): number => {
  if (!text) {
    return 0
  }
  let total = 0
  for (let i = 0; i < text.length; i += 1) {
    total += text.charCodeAt(i) < 128 ? 1 / 3 : 1.5
  }
  return Math.ceil(total)
}

export const estimateMessageTokens = (message: Message): number => {
  if (message.role === 'user') {
    const fileTokens = message.files.reduce(
      (sum, f) => sum + (f.mimeType.startsWith('image/') ? 1024 : 2048),
      0
    )
    return estimateTextTokens(message.content) + fileTokens + 12
  }
  return estimateTextTokens(getReplyText(message)) + 12
}

export const estimateHistoryTokens = (history: Message[]): number =>
  history.reduce((sum, message) => sum + estimateMessageTokens(message), 0)

export const fitRequestHistory = (history: Message[], budgetTokens: number): Message[] => {
  const rounds = getContextRounds(history)
  if (rounds.length === 0) {
    return history
  }
  const kept: [UserMessage, AssistantMessage][] = []
  let used = 0
  for (let i = rounds.length - 1; i >= 0; i -= 1) {
    const round = rounds[i]
    const roundTokens = estimateMessageTokens(round[0]) + estimateMessageTokens(round[1])
    if (kept.length >= 1 && used + roundTokens > budgetTokens) {
      break
    }
    kept.unshift(round)
    used += roundTokens
  }
  return kept.flat()
}

const getMessagePlainText = (message: Message): string => {
  if (message.role === 'user') {
    const attachNote =
      message.files.length > 0 ? ` [附件: ${message.files.map((f) => f.name).join(', ')}]` : ''
    return `${message.content.trim()}${attachNote}`.trim()
  }
  return getReplyText(message).trim()
}

const splitTailRounds = (
  rounds: [UserMessage, AssistantMessage][],
  preset: CompactionPreset,
  forceManual: boolean
): {
  olderRounds: [UserMessage, AssistantMessage][]
  tailRounds: [UserMessage, AssistantMessage][]
} => {
  const minKeep = forceManual
    ? Math.min(preset.minTailRounds, Math.max(1, rounds.length - 1))
    : preset.minTailRounds
  const tail: [UserMessage, AssistantMessage][] = []
  let tailTokens = 0

  for (let i = rounds.length - 1; i >= 0; i -= 1) {
    const round = rounds[i]
    const cost = estimateMessageTokens(round[0]) + estimateMessageTokens(round[1])
    const underMin = tail.length < minKeep
    const underMax = tail.length < preset.maxTailRounds
    if (underMin || (underMax && tailTokens + cost <= preset.tailBudget)) {
      tail.unshift(round)
      tailTokens += cost
    } else {
      break
    }
  }

  const cutIdx = rounds.length - tail.length
  return {
    olderRounds: rounds.slice(0, Math.max(0, cutIdx)),
    tailRounds: tail,
  }
}

const groupBatches = (
  rounds: [UserMessage, AssistantMessage][],
  batchTokenBudget: number
): [UserMessage, AssistantMessage][][] => {
  const batches: [UserMessage, AssistantMessage][][] = []
  let current: [UserMessage, AssistantMessage][] = []
  let tokens = 0

  for (const round of rounds) {
    const cost = estimateMessageTokens(round[0]) + estimateMessageTokens(round[1])
    if (current.length > 0 && tokens + cost > batchTokenBudget) {
      batches.push(current)
      current = []
      tokens = 0
    }
    current.push(round)
    tokens += cost
  }
  if (current.length > 0) {
    batches.push(current)
  }
  return batches
}

const extractJsonObject = (raw: string): Record<string, unknown> | null => {
  const trimmed = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim()
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start === -1 || end <= start) {
    return null
  }
  try {
    const parsed: unknown = JSON.parse(trimmed.slice(start, end + 1))
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    return null
  }
  return null
}

const normalizeForMatch = (s: string) => s.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')

const buildFallbackSegment = (
  rounds: [UserMessage, AssistantMessage][],
  maxChars: number
): CompactionSegment => {
  const head = rounds[0]
  const tail = rounds[rounds.length - 1]
  const lines = rounds.slice(0, 6).map(([u, a]) => {
    const uText = getMessagePlainText(u).slice(0, 60)
    const aText = getMessagePlainText(a).slice(0, 60)
    return `问: ${uText} -> 答: ${aText}`
  })
  const rawSummary = lines.join('；')
  const summary =
    rawSummary.length > maxChars ? `${rawSummary.slice(0, maxChars - 1)}…` : rawSummary
  return {
    id: `seg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    fromMessageId: head[0].id,
    toMessageId: tail[1].id,
    roundCount: rounds.length,
    summary,
    updatedAt: Date.now(),
  }
}

const COMPACTION_SYSTEM_PROMPT = `你是对话上下文压缩引擎（基于层级记忆提取架构）。
请从给定的历史对话片段中，提炼高价值、可长期复用的结构化信息与阶段摘要，严格遵守：
1. 只提取对话中真实明确表达过的信息，严禁脑补或编造。
2. category 只能是以下之一：
   - setting: 任务目标、世界观/背景设定、角色约束、项目技术栈与架构
   - preference: 用户偏好、输出格式要求、语言风格偏好
   - boundary: 明确禁止或不能做/不能改变的限制条件
   - event: 已发生的关键节点、决策结果、解决的问题
   - promise: 约定好的后续计划或待办事项
   - correction: 用户对前文内容作出的纠正或推翻
3. 每条记录必须给出 sourceMessageId（对话里标注的消息 id）和 quote（原文里的简短原话摘录）。
4. 如果是 correction 或更新旧事实，填写 supersedes（写明被取代的旧内容关键词）。
5. 只输出一个合法 JSON 对象，格式如下：
{
  "segmentSummary": "用简练客观的中文概括本段对话核心进展与结论（不超过字数限制）",
  "records": [
    {
      "category": "setting|preference|boundary|event|promise|correction",
      "content": "提炼后的精简记忆句（<=80字）",
      "quote": "原文证据短句",
      "sourceMessageId": "消息id",
      "importance": 1到5整数,
      "supersedes": "可选，被替代的旧设定"
    }
  ]
}`

const extractBatchFromApi = async (
  apiKey: string,
  batch: [UserMessage, AssistantMessage][],
  existingRecords: CompactionRecord[],
  preset: CompactionPreset,
  signal: AbortSignal
): Promise<{ segment: CompactionSegment; records: CompactionRecord[] }> => {
  const validIds = new Set<string>()
  const corpusParts: string[] = []
  const transcriptLines: string[] = []

  for (const [user, assistant] of batch) {
    validIds.add(user.id)
    validIds.add(assistant.id)
    const uText = getMessagePlainText(user).slice(0, 1200)
    const aText = getMessagePlainText(assistant).slice(0, 1400)
    corpusParts.push(uText, aText)
    transcriptLines.push(`[user id=${user.id}] ${uText}`)
    transcriptLines.push(`[assistant id=${assistant.id}] ${aText}`)
  }

  const normalizedCorpus = normalizeForMatch(corpusParts.join(' '))
  const knownSummary = existingRecords
    .slice(-16)
    .map((r) => `- (${r.category}) ${r.content}`)
    .join('\n')

  const userPrompt = [
    `摘要字数上限: ${preset.summaryMaxChars} 字；压缩档位: ${preset.level}`,
    knownSummary ? `已有关键记忆（避免重复，仅在补充或纠正时输出）:\n${knownSummary}` : '',
    `待压缩对话片段:\n${transcriptLines.join('\n')}`,
  ]
    .filter(Boolean)
    .join('\n\n')

  const rawText = await createMessage(
    apiKey,
    {
      model: 'deepseek-flash',
      system: COMPACTION_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
      thinking: { type: 'disabled' },
      safety_check: { level: 'high' },
      tools: [],
    },
    signal
  )

  const parsed = extractJsonObject(rawText)
  const fallback = buildFallbackSegment(batch, preset.summaryMaxChars)
  if (!parsed) {
    return { segment: fallback, records: [] }
  }

  const rawSummary =
    typeof parsed.segmentSummary === 'string' && parsed.segmentSummary.trim()
      ? parsed.segmentSummary.trim()
      : fallback.summary
  const summary =
    rawSummary.length > preset.summaryMaxChars
      ? `${rawSummary.slice(0, preset.summaryMaxChars - 1)}…`
      : rawSummary

  const outRecords: CompactionRecord[] = []
  const rawRecords = Array.isArray(parsed.records) ? parsed.records : []
  const now = Date.now()

  for (const item of rawRecords) {
    if (!item || typeof item !== 'object') {
      continue
    }
    const obj = item as Record<string, unknown>
    const category = obj.category as CompactionRecordCategory
    const content = typeof obj.content === 'string' ? obj.content.trim().slice(0, 120) : ''
    const quote = typeof obj.quote === 'string' ? obj.quote.trim().slice(0, 120) : ''
    const sourceMessageId =
      typeof obj.sourceMessageId === 'string' ? obj.sourceMessageId.trim() : batch[0][0].id
    const importanceRaw = Number(obj.importance ?? 3)
    const importance = Number.isFinite(importanceRaw)
      ? Math.max(1, Math.min(5, Math.round(importanceRaw)))
      : 3
    const supersedes =
      typeof obj.supersedes === 'string' && obj.supersedes.trim()
        ? obj.supersedes.trim().slice(0, 80)
        : undefined

    if (!VALID_CATEGORIES.has(category) || !content) {
      continue
    }
    const idOk = validIds.has(sourceMessageId)
    const normQuote = normalizeForMatch(quote)
    const quoteOk = normQuote.length >= 4 && normalizedCorpus.includes(normQuote.slice(0, 16))
    if (!idOk && !quoteOk) {
      continue
    }

    outRecords.push({
      id: `rec_${now}_${Math.random().toString(36).slice(2, 7)}`,
      category,
      content,
      quote: quote || content,
      sourceMessageId: idOk ? sourceMessageId : batch[0][0].id,
      importance,
      ...(supersedes ? { supersedes } : {}),
      updatedAt: now,
    })
  }

  return {
    segment: {
      ...fallback,
      summary,
      updatedAt: now,
    },
    records: outRecords,
  }
}

const mergeRecords = (
  existing: CompactionRecord[],
  incoming: CompactionRecord[],
  maxRecords: number
): CompactionRecord[] => {
  let pool = [...existing]
  for (const rec of incoming) {
    if (rec.supersedes) {
      const targetNorm = normalizeForMatch(rec.supersedes)
      if (targetNorm.length >= 2) {
        pool = pool.filter((old) => !normalizeForMatch(old.content).includes(targetNorm))
      }
    }
    const recNorm = normalizeForMatch(rec.content)
    const dupIdx = pool.findIndex(
      (old) => normalizeForMatch(old.content) === recNorm && old.category === rec.category
    )
    if (dupIdx >= 0) {
      pool[dupIdx] = rec
    } else {
      pool.push(rec)
    }
  }

  const byCat: CompactionRecord[] = []
  const counts: Record<CompactionRecordCategory, number> = {
    setting: 0,
    preference: 0,
    boundary: 0,
    event: 0,
    promise: 0,
    correction: 0,
  }

  const sorted = [...pool].sort((a, b) => b.importance - a.importance || b.updatedAt - a.updatedAt)
  for (const rec of sorted) {
    if (counts[rec.category] >= CATEGORY_CAPS[rec.category]) {
      continue
    }
    counts[rec.category] += 1
    byCat.push(rec)
    if (byCat.length >= maxRecords) {
      break
    }
  }

  return byCat.sort((a, b) => a.updatedAt - b.updatedAt)
}

const mergeSegments = (
  existing: CompactionSegment[],
  incoming: CompactionSegment[],
  maxSegments: number
): CompactionSegment[] => {
  const combined = [...existing, ...incoming]
  if (combined.length <= maxSegments) {
    return combined
  }
  const overflow = combined.length - maxSegments + 1
  const foldedSlice = combined.slice(0, overflow)
  const foldedSummary = foldedSlice
    .map((s) => s.summary)
    .join('；')
    .slice(0, 420)
  const mergedHead: CompactionSegment = {
    id: foldedSlice[0].id,
    fromMessageId: foldedSlice[0].fromMessageId,
    toMessageId: foldedSlice[foldedSlice.length - 1].toMessageId,
    roundCount: foldedSlice.reduce((sum, s) => sum + s.roundCount, 0),
    summary: foldedSummary,
    updatedAt: foldedSlice[foldedSlice.length - 1].updatedAt,
  }
  return [mergedHead, ...combined.slice(overflow)]
}

const isCompactionValidForRounds = (
  compaction: SessionCompaction | undefined,
  rounds: [UserMessage, AssistantMessage][]
): compaction is SessionCompaction => {
  if (!compaction || !compaction.retainedFromId) {
    return false
  }
  const idx = rounds.findIndex(([u]) => u.id === compaction.retainedFromId)
  return idx > 0
}

/**
 * 压缩摘要按不可变分段回放到 messages 开头（见 reply.ts），关键事实则属于易变内容，
 * 只拼在本轮提问末尾，绝不写入 system，避免每次压缩都让整段前缀缓存失效。
 */
export const formatCompactionRecordsBlock = (compaction: SessionCompaction | undefined): string => {
  if (!compaction || compaction.records.length === 0) {
    return ''
  }
  const lines = compaction.records.map((r) => `- [${r.category}] ${r.content}`)
  return `[长期对话关键事实 · 档位:${compaction.level}]\n${lines.join('\n')}`
}

const extractQueryTerms = (query: string): string[] => {
  const clean = query.toLowerCase().trim()
  if (!clean) {
    return []
  }
  const terms = new Set<string>()
  const words = clean.split(/[\s,.;:!?，。；：！？()[\]{}"'`]+/).filter((w) => w.length >= 2)
  for (const w of words) {
    terms.add(w)
    if (/[\u4e00-\u9fff]/.test(w) && w.length >= 3) {
      for (let i = 0; i <= w.length - 2; i += 1) {
        terms.add(w.slice(i, i + 2))
      }
    }
  }
  return [...terms].slice(0, 18)
}

export const recallCompactedEvidence = (
  history: Message[],
  retainedFromId: string | null,
  query: string,
  budgetTokens: number
): string => {
  if (!retainedFromId || !query.trim() || budgetTokens <= 0) {
    return ''
  }
  const rounds = getContextRounds(history)
  const cutIdx = rounds.findIndex(([u]) => u.id === retainedFromId)
  if (cutIdx <= 0) {
    return ''
  }
  const compressedRounds = rounds.slice(0, cutIdx)
  const terms = extractQueryTerms(query)
  if (terms.length === 0) {
    return ''
  }

  const scored: Array<{ score: number; idx: number; snippet: string }> = []
  for (let i = 0; i < compressedRounds.length; i += 1) {
    const [u, a] = compressedRounds[i]
    const text = `用户: ${getMessagePlainText(u)}\n助手: ${getMessagePlainText(a)}`
    const lower = text.toLowerCase()
    let hits = 0
    for (const term of terms) {
      if (lower.includes(term)) {
        hits += 1
      }
    }
    if (hits > 0) {
      scored.push({
        score: hits,
        idx: i,
        snippet: text.length > 420 ? `${text.slice(0, 419)}…` : text,
      })
    }
  }

  if (scored.length === 0) {
    return ''
  }

  scored.sort((x, y) => y.score - x.score || y.idx - x.idx)
  const chosen: string[] = []
  let usedTokens = 0
  for (const item of scored.slice(0, 4)) {
    const t = estimateTextTokens(item.snippet)
    if (chosen.length > 0 && usedTokens + t > budgetTokens) {
      break
    }
    chosen.push(`[早期第${item.idx + 1}轮原文片段]\n${item.snippet}`)
    usedTokens += t
  }

  return chosen.length > 0 ? `[按需召回的早期原文依据]\n${chosen.join('\n\n')}` : ''
}

export type RunCompactionOptions = {
  session: Session
  history: Message[]
  level: CompactionLevel
  forceManual: boolean
  signal: AbortSignal
}

export type RunCompactionResult = {
  compaction: SessionCompaction | undefined
  changed: boolean
  tailHistory: Message[]
}

export const runCompactionPass = async ({
  session,
  history,
  level,
  forceManual,
  signal,
}: RunCompactionOptions): Promise<RunCompactionResult> => {
  const preset = COMPACTION_PRESETS[level]
  const rounds = getContextRounds(history)
  const existing = isCompactionValidForRounds(session.compaction, rounds)
    ? session.compaction
    : undefined

  if (rounds.length < (forceManual ? 2 : preset.minTailRounds + 2)) {
    return { compaction: existing, changed: false, tailHistory: history }
  }

  let uncompactedRounds = rounds
  if (existing && existing.retainedFromId) {
    const idx = rounds.findIndex(([u]) => u.id === existing.retainedFromId)
    if (idx > 0) {
      uncompactedRounds = rounds.slice(idx)
    }
  }

  if (!forceManual) {
    const uncompactedHistory = uncompactedRounds.flat()
    const estTokens = estimateHistoryTokens(uncompactedHistory)
    const lastReplyIdx = existing?.lastReplyId
      ? uncompactedRounds.findIndex(([, a]) => a.id === existing.lastReplyId)
      : -1
    const growthRounds =
      lastReplyIdx >= 0 ? uncompactedRounds.length - 1 - lastReplyIdx : uncompactedRounds.length
    const threshold = existing ? Math.round(preset.inputBudget * 0.85) : preset.inputBudget

    if (estTokens <= threshold || (existing && growthRounds < preset.minGrowthRounds)) {
      // 不做滑动窗口裁剪：每轮从头部丢弃旧消息会让请求前缀每次都变，DeepSeek 前缀缓存全部失效。
      // 真正超出模型上下文时由 store 的 context-length 重试兜底。
      return {
        compaction: existing,
        changed: false,
        tailHistory: uncompactedHistory,
      }
    }
  }

  const { olderRounds, tailRounds } = splitTailRounds(uncompactedRounds, preset, forceManual)
  if (olderRounds.length === 0) {
    return {
      compaction: existing,
      changed: false,
      tailHistory: existing ? uncompactedRounds.flat() : history,
    }
  }

  const apiKey = useSettings.getState().apiKey?.trim() ?? ''
  const batches = groupBatches(olderRounds, preset.batchTokens)
  let nextSegments = existing?.segments ?? []
  let nextRecords = existing?.records ?? []

  for (const batch of batches) {
    if (signal.aborted) {
      throw new DOMException('Aborted', 'AbortError')
    }
    if (apiKey) {
      try {
        const extracted = await extractBatchFromApi(apiKey, batch, nextRecords, preset, signal)
        nextSegments = mergeSegments(nextSegments, [extracted.segment], preset.maxSegments)
        nextRecords = mergeRecords(nextRecords, extracted.records, preset.maxRecords)
        continue
      } catch (error) {
        if (signal.aborted) {
          throw error
        }
        if (forceManual) {
          throw error
        }
      }
    }
    const fallbackSeg = buildFallbackSegment(batch, preset.summaryMaxChars)
    nextSegments = mergeSegments(nextSegments, [fallbackSeg], preset.maxSegments)
  }

  const retainedFromId = tailRounds[0]?.[0].id ?? existing?.retainedFromId ?? null
  const lastReplyId = tailRounds[tailRounds.length - 1]?.[1].id ?? null
  const nextCompaction: SessionCompaction = {
    level,
    retainedFromId,
    lastReplyId,
    segments: nextSegments,
    records: nextRecords,
    updatedAt: Date.now(),
  }

  return {
    compaction: nextCompaction,
    changed: true,
    tailHistory: tailRounds.flat(),
  }
}

export const registerCompactionController = (sessionId: string, controller: AbortController) => {
  activeCompactionControllers.set(sessionId, controller)
  useCompactionStore.setState({ runningSessionId: sessionId, lastError: null })
}

export const clearCompactionController = (sessionId: string, lastError: string | null = null) => {
  activeCompactionControllers.delete(sessionId)
  useCompactionStore.setState((state) => ({
    runningSessionId: state.runningSessionId === sessionId ? null : state.runningSessionId,
    lastError,
  }))
}
