import { useSettings, type Locale } from '../services/settings.js'
import { streamMessage } from '../services/api/client.js'
import type { MessageParam } from '../services/api/types.js'
import { buildDecisionCacheKey, getCachedGameDecision, saveCachedGameDecision } from './history.js'
import type { AiTurnDecision, GameOpponent, GamePlugin } from './types.js'

const MAX_MOVE_ATTEMPTS = 3
const MAX_CONTROL_USES = 2
const DEFAULT_TIMEOUT_MS = 65_000

type RawDecisionJson = {
  move?: unknown
  cards?: unknown
  thoughtSummary?: unknown
  speech?: unknown
}

const stripMarkdownFences = (raw: string): string =>
  raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim()

const extractJsonObject = (raw: string): RawDecisionJson | null => {
  const cleaned = stripMarkdownFences(raw)
  const firstBrace = cleaned.indexOf('{')
  const lastBrace = cleaned.lastIndexOf('}')
  if (firstBrace === -1 || lastBrace <= firstBrace) {
    return null
  }
  const slice = cleaned.slice(firstBrace, lastBrace + 1)
  try {
    const parsed = JSON.parse(slice) as unknown
    if (typeof parsed === 'object' && parsed !== null) {
      return parsed as RawDecisionJson
    }
  } catch {
    // 尝试解析失败时交由重试流程修正格式
  }
  return null
}

const cleanBubbleText = (value: unknown, fallback: string): string => {
  if (typeof value !== 'string') {
    return fallback
  }
  const trimmed = value.replace(/\s+/g, ' ').trim()
  return trimmed ? trimmed.slice(0, 120) : fallback
}

const summarizeThinkingSnippet = (thinkingRaw: string, locale: Locale): string => {
  const normalized = thinkingRaw.replace(/\s+/g, ' ').trim()
  if (!normalized) {
    return locale === 'zh-CN' ? '正在推演这一步…' : 'Thinking through the position…'
  }
  return normalized
}

const callDeepSeekTurn = async ({
  apiKey,
  systemPrompt,
  messages,
  thinking,
  signal,
  timeoutMs,
  locale,
  sessionId,
  onThinkingUpdate,
}: {
  apiKey: string
  systemPrompt: string
  messages: MessageParam[]
  thinking: boolean
  signal: AbortSignal
  timeoutMs: number
  locale: Locale
  sessionId: string
  onThinkingUpdate?: (snippet: string) => void
}): Promise<{ rawText: string; rawThinking: string }> => {
  const controller = new AbortController()
  const onAbort = () => controller.abort()
  signal.addEventListener('abort', onAbort, { once: true })
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs)

  let rawText = ''
  let rawThinking = ''
  let lastEmitAt = 0

  try {
    const events = streamMessage(
      apiKey,
      {
        model: 'deepseek-flash',
        system: systemPrompt,
        messages,
        thinking: { type: thinking ? 'enabled' : 'disabled' },
        safety_check: { level: 'high' },
      },
      controller.signal,
      sessionId
    )

    for await (const event of events) {
      if (event.type !== 'content_block_delta') {
        continue
      }
      if (event.delta.type === 'text_delta') {
        rawText += event.delta.text
      } else if (event.delta.type === 'thinking_delta') {
        rawThinking += event.delta.thinking
        const now = Date.now()
        if (onThinkingUpdate && now - lastEmitAt >= 450) {
          lastEmitAt = now
          onThinkingUpdate(summarizeThinkingSnippet(rawThinking, locale))
        }
      }
    }

    return { rawText, rawThinking }
  } finally {
    window.clearTimeout(timeout)
    signal.removeEventListener('abort', onAbort)
  }
}

/**
 * 由 DeepSeek 大模型决定每一步 AI 决策：
 * - 代码仅作为规则裁判，支持中间控制指令（如斗地主 5 次限额算牌）；
 * - 非法着法携带裁判拒绝原因重试，耗尽后安全兜底。
 */
export const requestAiMoveFromLlm = async <TState, TMove>({
  plugin,
  state,
  opponent,
  apiKey,
  thinking,
  locale,
  signal,
  requestTimeoutMs = DEFAULT_TIMEOUT_MS,
  onThinkingUpdate,
  onStateUpdate,
}: {
  plugin: GamePlugin<TState, TMove>
  state: TState
  opponent: GameOpponent
  apiKey: string
  thinking: boolean
  locale: Locale
  signal: AbortSignal
  requestTimeoutMs?: number
  onThinkingUpdate?: (snippet: string) => void
  onStateUpdate?: (nextState: TState) => void
}): Promise<AiTurnDecision<TMove>> => {
  const gameCacheEnabled = useSettings.getState().gameCacheEnabled
  const cacheKey = gameCacheEnabled
    ? buildDecisionCacheKey(plugin.id, opponent.id, thinking, state)
    : null
  if (cacheKey) {
    const cached = getCachedGameDecision(cacheKey)
    if (cached) {
      const check = plugin.parseAndValidateAiMove(state, cached.move, locale)
      if (check.valid) {
        return {
          move: check.move,
          thoughtSummary: cached.thoughtSummary,
          speech: cached.speech,
        }
      }
    }
  }

  let currentState = state
  const promptPayload = plugin.buildAiPrompt(currentState, opponent, locale)
  const history: MessageParam[] = [{ role: 'user', content: promptPayload.userPrompt }]
  const gameSessionId = `mywhale-game-${plugin.id}-${opponent.id}`

  let latestThinkingTrace = ''
  const deadline = Date.now() + requestTimeoutMs
  let moveAttempt = 0
  let controlCount = 0

  while (moveAttempt < MAX_MOVE_ATTEMPTS) {
    if (signal.aborted) {
      throw new DOMException('Aborted', 'AbortError')
    }
    const remainingMs = Math.max(4_000, deadline - Date.now())

    const { rawText, rawThinking } = await callDeepSeekTurn({
      apiKey,
      systemPrompt: promptPayload.systemPrompt,
      messages: history,
      thinking,
      signal,
      timeoutMs: remainingMs,
      locale,
      sessionId: gameSessionId,
      onThinkingUpdate,
    })
    if (rawThinking.trim()) {
      latestThinkingTrace = rawThinking.trim()
    }

    const parsed = extractJsonObject(rawText)
    if (!parsed) {
      moveAttempt += 1
      const retryMsg =
        locale === 'zh-CN'
          ? '你的输出不是合法 JSON 对象。请仅返回 JSON，格式为 {"move":..., "thoughtSummary":"...", "speech":"..."}，不要包含其他文字。'
          : 'Your output is not a valid JSON object. Return ONLY JSON: {"move":..., "thoughtSummary":"...", "speech":"..."}.'
      history.push({ role: 'assistant', content: [{ type: 'text', text: rawText || '{}' }] })
      history.push({ role: 'user', content: retryMsg })
      continue
    }

    if (plugin.processAiControlAction && controlCount < MAX_CONTROL_USES) {
      const ctrl = plugin.processAiControlAction(
        currentState,
        parsed as Record<string, unknown>,
        locale
      )
      if (ctrl.handled) {
        controlCount += 1
        currentState = ctrl.nextState
        onStateUpdate?.(currentState)
        history.push({ role: 'assistant', content: [{ type: 'text', text: rawText }] })
        history.push({ role: 'user', content: ctrl.refereeMessage })
        continue
      }
    }

    const rawCandidate = parsed.move !== undefined ? parsed.move : parsed.cards
    const validation = plugin.parseAndValidateAiMove(currentState, rawCandidate, locale)
    if (validation.valid) {
      const defaultThought =
        locale === 'zh-CN'
          ? '综合攻防后选择这一手。'
          : 'Selected after weighing attack and defense.'
      const defaultSpeech = locale === 'zh-CN' ? '轮到你了，请。' : 'Your move.'
      const thoughtSummary = cleanBubbleText(parsed.thoughtSummary, defaultThought)
      const baseSpeech = cleanBubbleText(parsed.speech, defaultSpeech)
      const speech = plugin.formatMoveSpeech
        ? plugin.formatMoveSpeech(currentState, validation.move, baseSpeech, locale)
        : baseSpeech
      if (cacheKey && controlCount === 0) {
        saveCachedGameDecision({
          key: cacheKey,
          move: validation.move,
          thoughtSummary,
          speech,
        })
      }
      return {
        move: validation.move,
        thoughtSummary,
        thinkingTrace: latestThinkingTrace || undefined,
        speech,
      }
    }

    moveAttempt += 1
    const sampleHint = promptPayload.legalExamples?.length
      ? locale === 'zh-CN'
        ? ` 当前可选合法着法示例：${promptPayload.legalExamples.slice(0, 8).join(', ')}。`
        : ` Example legal moves: ${promptPayload.legalExamples.slice(0, 8).join(', ')}.`
      : ''

    const rejectionPrompt =
      locale === 'zh-CN'
        ? `裁判驳回该着法：${validation.reason}。请严格重新选择一个合法空位或着法，并仍按 JSON 格式返回 {"move":..., "thoughtSummary":"...", "speech":"..."}。${sampleHint}`
        : `Referee rejected your move: ${validation.reason}. Choose another strictly legal move and reply in JSON.${sampleHint}`

    history.push({ role: 'assistant', content: [{ type: 'text', text: rawText }] })
    history.push({ role: 'user', content: rejectionPrompt })
  }

  const fallback = plugin.pickFallbackMove(currentState)
  if (fallback === null) {
    throw new Error(locale === 'zh-CN' ? '当前棋局已无合法着法' : 'No legal moves available')
  }
  const fallbackNote =
    locale === 'zh-CN'
      ? '刚刚思绪走神了，先随手打一手稳住局面。'
      : 'Lost focus there—making a safe legal move.'
  const speech = plugin.formatMoveSpeech
    ? plugin.formatMoveSpeech(currentState, fallback, fallbackNote, locale)
    : fallbackNote
  return {
    move: fallback,
    thoughtSummary: fallbackNote,
    speech,
    usedFallback: true,
  }
}
