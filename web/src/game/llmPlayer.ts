import type { Locale } from '../services/settings.js'
import { streamMessage } from '../services/api/client.js'
import type { MessageParam } from '../services/api/types.js'
import type { AiTurnDecision, GameOpponent, GamePlugin } from './types.js'

const MAX_ATTEMPTS = 3
const REQUEST_TIMEOUT_MS = 45_000

type RawDecisionJson = {
  move?: unknown
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
    return locale === 'zh-CN' ? '正在思考这一步…' : 'Thinking through the position…'
  }
  const tail = normalized.length > 64 ? `…${normalized.slice(-64)}` : normalized
  return tail
}

const callDeepSeekTurn = async ({
  apiKey,
  systemPrompt,
  messages,
  thinking,
  signal,
  locale,
  onThinkingUpdate,
}: {
  apiKey: string
  systemPrompt: string
  messages: MessageParam[]
  thinking: boolean
  signal: AbortSignal
  locale: Locale
  onThinkingUpdate?: (snippet: string) => void
}): Promise<{ rawText: string; rawThinking: string }> => {
  const controller = new AbortController()
  const onAbort = () => controller.abort()
  signal.addEventListener('abort', onAbort, { once: true })
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

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
      controller.signal
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
 * 由 DeepSeek 大模型决定每一步 AI 着法：
 * - 代码仅作为裁判校验规则；
 * - 若模型给出非法着法或格式错误，携带裁判拒绝原因最多要求模型重走 2 次；
 * - 连续 3 次失败后才安全回退到合法着法，保证棋局永不死锁。
 */
export const requestAiMoveFromLlm = async <TState, TMove>({
  plugin,
  state,
  opponent,
  apiKey,
  thinking,
  locale,
  signal,
  onThinkingUpdate,
}: {
  plugin: GamePlugin<TState, TMove>
  state: TState
  opponent: GameOpponent
  apiKey: string
  thinking: boolean
  locale: Locale
  signal: AbortSignal
  onThinkingUpdate?: (snippet: string) => void
}): Promise<AiTurnDecision<TMove>> => {
  const promptPayload = plugin.buildAiPrompt(state, opponent, locale)
  const history: MessageParam[] = [{ role: 'user', content: promptPayload.userPrompt }]

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (signal.aborted) {
      throw new DOMException('Aborted', 'AbortError')
    }

    const { rawText } = await callDeepSeekTurn({
      apiKey,
      systemPrompt: promptPayload.systemPrompt,
      messages: history,
      thinking,
      signal,
      locale,
      onThinkingUpdate,
    })

    const parsed = extractJsonObject(rawText)
    if (!parsed) {
      const retryMsg =
        locale === 'zh-CN'
          ? '你的输出不是合法 JSON 对象。请仅返回 JSON，格式为 {"move":..., "thoughtSummary":"...", "speech":"..."}，不要包含其他文字。'
          : 'Your output is not a valid JSON object. Return ONLY JSON: {"move":..., "thoughtSummary":"...", "speech":"..."}.'
      history.push({ role: 'assistant', content: [{ type: 'text', text: rawText || '{}' }] })
      history.push({ role: 'user', content: retryMsg })
      continue
    }

    const validation = plugin.parseAndValidateAiMove(state, parsed.move, locale)
    if (validation.valid) {
      const defaultThought =
        locale === 'zh-CN' ? '落子已定，看你这一手如何应对。' : 'Move made. Your turn.'
      const thoughtSummary = cleanBubbleText(parsed.thoughtSummary, defaultThought)
      const speech = cleanBubbleText(parsed.speech, thoughtSummary)
      return {
        move: validation.move,
        thoughtSummary,
        speech,
      }
    }

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

  const fallback = plugin.pickFallbackMove(state)
  if (fallback === null) {
    throw new Error(locale === 'zh-CN' ? '当前棋局已无合法着法' : 'No legal moves available')
  }
  const fallbackNote =
    locale === 'zh-CN'
      ? '刚刚推演走神了，先随手走一着稳住局面。'
      : 'Lost my train of thought there—making a safe legal move.'
  return {
    move: fallback,
    thoughtSummary: fallbackNote,
    speech: fallbackNote,
    usedFallback: true,
  }
}
