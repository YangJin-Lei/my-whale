import { fetchWithProxyFallback } from '../cacheBackend.js'
import { useSettings, type CustomApiProtocol } from '../settings.js'
import { readServerSentEvents } from './sse.js'
import type {
  AssistantBlockParam,
  CreateMessageRequest,
  FileBlockParam,
  MessageParam,
  MessageStreamEvent,
  MessageUsage,
  StopReason,
  TextBlockParam,
} from './types.js'

export class CustomApiRequestError extends Error {
  constructor(
    readonly kind: 'http' | 'stream' | 'network' | 'interrupted' | 'protocol',
    message: string,
    readonly status?: number
  ) {
    super(message)
    this.name = 'CustomApiRequestError'
  }
}

type OpenAiContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

type OpenAiChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string | OpenAiContentPart[]
}

const VERSIONED_PATH_RE = /\/v\d+(?:[a-z0-9-]*)?$/i

export const normalizeCustomEndpoint = (baseUrl: string, protocol: CustomApiProtocol): string => {
  const cleaned = baseUrl.trim().replace(/\/+$/, '')
  if (!cleaned) {
    return ''
  }
  const suffix = protocol === 'anthropic' ? '/messages' : '/chat/completions'
  if (cleaned.endsWith(suffix)) {
    return cleaned
  }
  if (VERSIONED_PATH_RE.test(cleaned)) {
    return `${cleaned}${suffix}`
  }
  return `${cleaned}/v1${suffix}`
}

const extractAssistantText = (blocks: AssistantBlockParam[]): string =>
  blocks
    .filter((block): block is TextBlockParam => block.type === 'text')
    .map((block) => block.text)
    .join('')

const convertUserBlocksToOpenAi = (
  blocks: (FileBlockParam | TextBlockParam)[]
): string | OpenAiContentPart[] => {
  const parts: OpenAiContentPart[] = []
  for (const block of blocks) {
    if (block.type === 'text') {
      if (block.text) {
        parts.push({ type: 'text', text: block.text })
      }
      continue
    }
    if (block.type === 'image' && block.source.type === 'base64') {
      const mime = block.source.media_type || 'image/png'
      parts.push({
        type: 'image_url',
        image_url: { url: `data:${mime};base64,${block.source.data}` },
      })
      continue
    }
    parts.push({ type: 'text', text: '[Attachment]' })
  }
  if (parts.length === 0) {
    return ''
  }
  if (parts.every((part) => part.type === 'text')) {
    return parts.map((part) => part.text).join('\n')
  }
  return parts
}

const resolveCustomSystemPrompt = (body: CreateMessageRequest): string => {
  const systemParts: string[] = body.system.trim() ? [body.system.trim()] : []
  let hasChineseReminder = false
  for (const msg of body.messages) {
    if (msg.role !== 'latest_reminder') {
      continue
    }
    const content = msg.content.trim()
    if (!content) {
      continue
    }
    if (content.endsWith(',中文')) {
      hasChineseReminder = true
      systemParts.push(`当前上下文信息：${content}`)
    } else if (content.startsWith('[')) {
      systemParts.push(content)
    } else {
      systemParts.push(`Context: ${content}`)
    }
  }
  const locale = useSettings.getState().locale
  if (
    (hasChineseReminder || (systemParts.length > 0 && locale === 'zh-CN')) &&
    locale === 'zh-CN'
  ) {
    systemParts.push('请始终使用中文进行思考和回复（除非用户明确要求使用其他语言）。')
  }
  return systemParts.join('\n\n')
}

const buildOpenAiMessages = (body: CreateMessageRequest): OpenAiChatMessage[] => {
  const messages: OpenAiChatMessage[] = []
  const systemPrompt = resolveCustomSystemPrompt(body)
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt })
  }
  for (const msg of body.messages) {
    if (msg.role === 'latest_reminder') {
      continue
    }
    if (msg.role === 'user') {
      const content =
        typeof msg.content === 'string' ? msg.content : convertUserBlocksToOpenAi(msg.content)
      messages.push({ role: 'user', content })
      continue
    }
    const text = extractAssistantText(msg.content)
    if (text) {
      messages.push({ role: 'assistant', content: text })
    }
  }
  return messages
}

const sanitizeAnthropicMessages = (messages: MessageParam[]) =>
  messages
    .filter((msg) => msg.role !== 'latest_reminder')
    .map((msg) => {
      if (msg.role === 'user') {
        if (typeof msg.content === 'string') {
          return msg
        }
        const safeBlocks = msg.content.map((block) => {
          if (block.type === 'text') {
            return block
          }
          if (block.type === 'image' && block.source.type === 'base64') {
            return block
          }
          return { type: 'text' as const, text: '[Attachment]' }
        })
        return { role: 'user' as const, content: safeBlocks }
      }
      const text = extractAssistantText(msg.content)
      return {
        role: 'assistant' as const,
        content: [{ type: 'text' as const, text: text || '...' }],
      }
    })

export const buildCustomAnthropicPayload = (
  body: CreateMessageRequest,
  model: string,
  stream: boolean,
  maxTokens?: number
) => {
  const systemPrompt = resolveCustomSystemPrompt(body)
  return {
    model: model.trim() || body.model,
    ...(systemPrompt ? { system: systemPrompt } : {}),
    messages: sanitizeAnthropicMessages(body.messages),
    max_tokens: maxTokens ?? 4096,
    stream,
  }
}

const readCustomErrorMessage = async (response: Response): Promise<string> => {
  const text = await response.text().catch(() => '')
  if (!text) {
    return response.statusText || `HTTP ${response.status}`
  }
  try {
    const parsed = JSON.parse(text) as { error?: { message?: unknown }; message?: unknown }
    if (typeof parsed.error?.message === 'string' && parsed.error.message.trim()) {
      return parsed.error.message
    }
    if (typeof parsed.message === 'string' && parsed.message.trim()) {
      return parsed.message
    }
  } catch {
    // 非 JSON 响应直接返回原文
  }
  return text.slice(0, 400)
}

const doCustomFetch = async (
  endpoint: string,
  headers: Record<string, string>,
  payload: unknown,
  signal?: AbortSignal
): Promise<Response> => {
  let response: Response
  try {
    response = await fetchWithProxyFallback(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal,
    })
  } catch (error) {
    if (signal?.aborted) {
      throw error
    }
    throw new CustomApiRequestError(
      'network',
      error instanceof Error ? error.message : String(error)
    )
  }
  if (!response.ok) {
    throw new CustomApiRequestError('http', await readCustomErrorMessage(response), response.status)
  }
  return response
}

const readRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null

const toStopReason = (finishReason: unknown): StopReason =>
  finishReason === 'length' ? 'max_tokens' : 'end_turn'

const toMessageUsage = (raw: unknown): MessageUsage | undefined => {
  const obj = readRecord(raw)
  if (!obj) {
    return undefined
  }
  const input = typeof obj.prompt_tokens === 'number' ? obj.prompt_tokens : 0
  const output = typeof obj.completion_tokens === 'number' ? obj.completion_tokens : 0
  const cached = readRecord(obj.prompt_tokens_details)?.cached_tokens
  const cacheRead = typeof cached === 'number' ? cached : 0
  return {
    input_tokens: Math.max(0, input - cacheRead),
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: cacheRead,
    output_tokens: output,
  }
}

const THINK_OPEN = '<think>'
const THINK_CLOSE = '</think>'

type ThinkParseState = {
  buffer: string
  inThink: boolean
}

const trailingTagPrefixLen = (lowerText: string, tag: string): number => {
  const maxLen = Math.min(lowerText.length, tag.length - 1)
  for (let len = maxLen; len >= 1; len -= 1) {
    if (lowerText.endsWith(tag.slice(0, len))) {
      return len
    }
  }
  return 0
}

const consumeThinkTags = (
  state: ThinkParseState,
  chunk: string
): Array<{ kind: 'thinking' | 'text'; text: string }> => {
  state.buffer += chunk
  const segments: Array<{ kind: 'thinking' | 'text'; text: string }> = []
  while (state.buffer.length > 0) {
    const lower = state.buffer.toLowerCase()
    const targetTag = state.inThink ? THINK_CLOSE : THINK_OPEN
    const kind = state.inThink ? 'thinking' : 'text'
    const idx = lower.indexOf(targetTag)
    if (idx !== -1) {
      if (idx > 0) {
        segments.push({ kind, text: state.buffer.slice(0, idx) })
      }
      state.buffer = state.buffer.slice(idx + targetTag.length)
      state.inThink = !state.inThink
      continue
    }
    const hold = trailingTagPrefixLen(lower, targetTag)
    const emitLen = state.buffer.length - hold
    if (emitLen > 0) {
      segments.push({ kind, text: state.buffer.slice(0, emitLen) })
    }
    state.buffer = hold > 0 ? state.buffer.slice(emitLen) : ''
    break
  }
  return segments
}

const stripInlineThinkTags = (text: string): string => {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
  return cleaned || text
}

export const extractOpenAiCompletionText = (raw: unknown): string => {
  const root = readRecord(raw)
  const choices = Array.isArray(root?.choices) ? root.choices : []
  const first = readRecord(choices[0])
  const message = readRecord(first?.message)
  if (typeof message?.content === 'string') {
    return stripInlineThinkTags(message.content)
  }
  if (Array.isArray(message?.content)) {
    const joined = message.content
      .map((part) => readRecord(part))
      .filter((part): part is Record<string, unknown> => part !== null && part.type === 'text')
      .map((part) => (typeof part.text === 'string' ? part.text : ''))
      .join('')
    return stripInlineThinkTags(joined)
  }
  return ''
}

export const createCustomOpenAiMessage = async (
  config: { url: string; apiKey: string; model: string },
  body: CreateMessageRequest,
  signal?: AbortSignal,
  maxTokens?: number
): Promise<string> => {
  const endpoint = normalizeCustomEndpoint(config.url, 'openai')
  const payload = {
    model: config.model.trim() || body.model,
    messages: buildOpenAiMessages(body),
    stream: false,
    ...(typeof maxTokens === 'number' ? { max_tokens: maxTokens } : {}),
  }
  const response = await doCustomFetch(
    endpoint,
    {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    payload,
    signal
  )
  const data = (await response.json()) as unknown
  return extractOpenAiCompletionText(data)
}

export async function* streamCustomOpenAiMessage(
  config: { url: string; apiKey: string; model: string },
  body: CreateMessageRequest,
  signal: AbortSignal
): AsyncGenerator<MessageStreamEvent> {
  const endpoint = normalizeCustomEndpoint(config.url, 'openai')
  const model = config.model.trim() || body.model
  const response = await doCustomFetch(
    endpoint,
    {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    {
      model,
      messages: buildOpenAiMessages(body),
      stream: true,
    },
    signal
  )

  const contentType = response.headers.get('Content-Type') ?? ''
  if (!response.body || !contentType.includes('text/event-stream')) {
    if (contentType.includes('application/json')) {
      const data = (await response.json().catch(() => null)) as unknown
      const text = extractOpenAiCompletionText(data)
      if (text) {
        const msgId = `custom-${Date.now()}`
        yield { type: 'message_start', message: { id: msgId, model } }
        yield {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '', citations: [] },
        }
        yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }
        yield { type: 'content_block_stop', index: 0 }
        yield {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn', stop_sequence: null },
        }
        yield { type: 'message_stop' }
        return
      }
    }
    throw new CustomApiRequestError(
      'protocol',
      await readCustomErrorMessage(response),
      response.status
    )
  }

  let started = false
  let blockIndex = -1
  let activeBlockType: 'thinking' | 'text' | null = null
  let stopReason: StopReason = 'end_turn'
  let latestUsage: MessageUsage | undefined
  const thinkState: ThinkParseState = { buffer: '', inThink: false }

  const ensureMessageStarted = async function* (id: string, modelName: string) {
    if (!started) {
      started = true
      yield {
        type: 'message_start',
        message: { id, model: modelName },
      } satisfies MessageStreamEvent
    }
  }

  const switchBlock = async function* (nextType: 'thinking' | 'text') {
    if (activeBlockType === nextType) {
      return
    }
    if (activeBlockType !== null && blockIndex >= 0) {
      yield { type: 'content_block_stop', index: blockIndex } satisfies MessageStreamEvent
    }
    blockIndex += 1
    activeBlockType = nextType
    yield {
      type: 'content_block_start',
      index: blockIndex,
      content_block:
        nextType === 'thinking'
          ? { type: 'thinking', thinking: '', signature: '' }
          : { type: 'text', text: '', citations: [] },
    } satisfies MessageStreamEvent
  }

  for await (const { data } of readServerSentEvents(response.body, signal)) {
    const trimmed = data.trim()
    if (!trimmed) {
      continue
    }
    if (trimmed === '[DONE]') {
      break
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      continue
    }
    const root = readRecord(parsed)
    if (!root) {
      continue
    }
    const errObj = readRecord(root.error)
    if (errObj && typeof errObj.message === 'string') {
      throw new CustomApiRequestError('stream', errObj.message)
    }
    const msgId = typeof root.id === 'string' && root.id ? root.id : `custom-${Date.now()}`
    const chunkModel = typeof root.model === 'string' && root.model ? root.model : model
    yield* ensureMessageStarted(msgId, chunkModel)

    if (root.usage) {
      latestUsage = toMessageUsage(root.usage)
    }

    const choices = Array.isArray(root.choices) ? root.choices : []
    const first = readRecord(choices[0])
    if (!first) {
      continue
    }
    if (first.finish_reason) {
      stopReason = toStopReason(first.finish_reason)
    }
    const delta = readRecord(first.delta)
    if (!delta) {
      continue
    }
    const reasoning =
      typeof delta.reasoning_content === 'string'
        ? delta.reasoning_content
        : typeof delta.reasoning === 'string'
          ? delta.reasoning
          : ''
    if (reasoning) {
      yield* switchBlock('thinking')
      yield {
        type: 'content_block_delta',
        index: blockIndex,
        delta: { type: 'thinking_delta', thinking: reasoning },
      }
    }
    if (typeof delta.content === 'string' && delta.content) {
      for (const segment of consumeThinkTags(thinkState, delta.content)) {
        yield* switchBlock(segment.kind)
        yield {
          type: 'content_block_delta',
          index: blockIndex,
          delta:
            segment.kind === 'thinking'
              ? { type: 'thinking_delta', thinking: segment.text }
              : { type: 'text_delta', text: segment.text },
        }
      }
    }
  }

  if (thinkState.buffer) {
    const kind = thinkState.inThink ? 'thinking' : 'text'
    yield* switchBlock(kind)
    yield {
      type: 'content_block_delta',
      index: blockIndex,
      delta:
        kind === 'thinking'
          ? { type: 'thinking_delta', thinking: thinkState.buffer }
          : { type: 'text_delta', text: thinkState.buffer },
    }
  }

  if (!started) {
    throw new CustomApiRequestError('interrupted', '')
  }
  if (activeBlockType !== null && blockIndex >= 0) {
    yield { type: 'content_block_stop', index: blockIndex }
  }
  yield {
    type: 'message_delta',
    delta: { stop_reason: stopReason, stop_sequence: null },
    ...(latestUsage ? { usage: latestUsage } : {}),
  }
  yield { type: 'message_stop' }
}

export const verifyCustomApiEndpoint = async (
  config: { url: string; apiKey: string; model: string; protocol: CustomApiProtocol },
  signal?: AbortSignal
): Promise<void> => {
  const endpoint = normalizeCustomEndpoint(config.url, config.protocol)
  if (!endpoint) {
    throw new CustomApiRequestError('protocol', 'Invalid API URL')
  }
  const testBody: CreateMessageRequest = {
    model: 'deepseek-flash',
    system: '',
    messages: [{ role: 'user', content: 'hi' }],
    thinking: { type: 'disabled' },
    safety_check: { level: 'high' },
  }
  if (config.protocol === 'openai') {
    await createCustomOpenAiMessage(config, testBody, signal, 16)
    return
  }
  await doCustomFetch(
    endpoint,
    {
      'x-api-key': config.apiKey,
      Authorization: `Bearer ${config.apiKey}`,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    buildCustomAnthropicPayload(testBody, config.model, false, 16),
    signal
  )
}
