import { getCachedParsedAttachment, type ParsedAttachment } from '../../capabilities/index.js'
import { translate, type TranslationMessage } from '../../i18n/index.js'
import {
  ensureNativeCacheStarted,
  fetchWithProxyFallback,
  normalizeCacheBackendUrl,
  resolveEffectiveOrigin,
} from '../cacheBackend.js'
import { useSettings } from '../settings.js'
import {
  buildCustomAnthropicPayload,
  createCustomOpenAiMessage,
  CustomApiRequestError,
  normalizeCustomEndpoint,
  streamCustomOpenAiMessage,
  verifyCustomApiEndpoint,
} from './openaiCompat.js'
import { readMessageEvent } from './parseEvent.js'
import { readServerSentEvents } from './sse.js'
import type {
  ApiErrorBody,
  CreateMessageRequest,
  FileBlockParam,
  FileObject,
  FilePurpose,
  MessageParam,
  MessageStreamEvent,
  TextBlockParam,
} from './types.js'

type CustomAttachmentResolver = (fileId: string) => Promise<ParsedAttachment | null>

let customAttachmentResolver: CustomAttachmentResolver | null = null

export const setCustomAttachmentResolver = (resolver: CustomAttachmentResolver | null) => {
  customAttachmentResolver = resolver
}

const resolveFileBlockForCustomApi = async (
  block: FileBlockParam
): Promise<FileBlockParam | TextBlockParam> => {
  if (block.source.type !== 'file') {
    return block
  }
  const fileId = block.source.file_id
  let parsed: ParsedAttachment | null | undefined = getCachedParsedAttachment(fileId)
  if (!parsed && customAttachmentResolver) {
    parsed = await customAttachmentResolver(fileId).catch(() => null)
  }
  if (!parsed) {
    return block
  }
  if (parsed.kind === 'image') {
    return {
      type: 'image',
      source: {
        type: 'base64',
        media_type: parsed.mimeType,
        data: parsed.base64,
      },
    }
  }
  return { type: 'text', text: parsed.text }
}

const resolveCustomBodyFiles = async (
  body: CreateMessageRequest
): Promise<CreateMessageRequest> => {
  let changed = false
  const nextMessages: MessageParam[] = []
  for (const msg of body.messages) {
    if (msg.role !== 'user' || typeof msg.content === 'string') {
      nextMessages.push(msg)
      continue
    }
    const nextBlocks = await Promise.all(
      msg.content.map((block) =>
        block.type === 'text' ? block : resolveFileBlockForCustomApi(block)
      )
    )
    if (nextBlocks.some((b, idx) => b !== msg.content[idx])) {
      changed = true
    }
    nextMessages.push({ ...msg, content: nextBlocks })
  }
  return changed ? { ...body, messages: nextMessages } : body
}

/** 构建期 API 地址，默认 https://api.deepseek.com；本地开发支持开发服务器代理 */
export const API_ORIGIN = __API_ORIGIN__
/** 未开启缓存模式走默认直连 API，开启缓存模式后切换至小后端代理 */
const getBaseOrigin = () => resolveEffectiveOrigin(API_ORIGIN)
const getAnthropicBaseUrl = () => `${getBaseOrigin()}/anthropic/v1`
/** 引用 Files API 上传的图片、调用 Anthropic 兼容 Files API 时必须携带 */
const FILES_BETA = 'files-api-2025-04-14'

export type ApiErrorKind =
  /** 非 2xx 响应 */
  | 'http'
  /** 流中返回的错误帧（如等待生成超时），随后连接关闭 */
  | 'stream'
  /** 请求没有到达服务端（断网、跨域被拦截等） */
  | 'network'
  /** 流在 message_stop 之前结束 */
  | 'interrupted'
  /** 响应不符合协议（如非 SSE 响应） */
  | 'protocol'

export class ApiError extends Error {
  readonly localMessage?: TranslationMessage

  constructor(
    readonly kind: ApiErrorKind,
    message: string | TranslationMessage,
    readonly status?: number
  ) {
    super(typeof message === 'string' ? message : translate(message.key, message.params))
    this.name = 'ApiError'
    this.localMessage = typeof message === 'string' ? undefined : message
  }
}

const isErrorBody = (value: unknown): value is ApiErrorBody =>
  typeof value === 'object' &&
  value !== null &&
  'error' in value &&
  typeof (value as ApiErrorBody).error?.message === 'string'

const readErrorResponse = async (
  response: Response,
  kind: 'http' | 'protocol' = 'http',
  fallback = response.statusText
): Promise<ApiError> => {
  const text = await response.text().catch(() => '')
  let message = text || fallback
  try {
    const body: unknown = JSON.parse(text)
    if (isErrorBody(body)) {
      message = body.error.message
    }
  } catch {
    // 非 JSON 响应体直接展示原文
  }
  return new ApiError(kind, message, response.status)
}

const requestCustomProxy = async (url: string, init: RequestInit): Promise<Response> => {
  let response: Response
  try {
    response = await fetchWithProxyFallback(url, init)
  } catch (error) {
    if (init.signal?.aborted) {
      throw error
    }
    throw new ApiError('network', error instanceof Error ? error.message : String(error))
  }
  if (!response.ok) {
    throw await readErrorResponse(response)
  }
  return response
}

const unsupportedAnthropicThinkingEndpoints = new Set<string>()

const requestCustomAnthropic = async (
  endpoint: string,
  customKey: string,
  customModel: string,
  body: CreateMessageRequest,
  stream: boolean,
  signal?: AbortSignal
): Promise<Response> => {
  const headers = {
    'x-api-key': customKey,
    Authorization: `Bearer ${customKey}`,
    'anthropic-version': '2023-06-01',
    'Content-Type': 'application/json',
    Accept: stream ? 'text/event-stream' : 'application/json',
  }
  const cacheKey = `${endpoint}::${customModel}`
  const tryWithThinking =
    body.thinking.type === 'enabled' && !unsupportedAnthropicThinkingEndpoints.has(cacheKey)
  try {
    return await requestCustomProxy(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(
        buildCustomAnthropicPayload(body, customModel, stream, undefined, tryWithThinking)
      ),
      signal,
    })
  } catch (error) {
    if (
      tryWithThinking &&
      error instanceof ApiError &&
      error.kind === 'http' &&
      (error.status === 400 || error.status === 422)
    ) {
      unsupportedAnthropicThinkingEndpoints.add(cacheKey)
      return requestCustomProxy(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(
          buildCustomAnthropicPayload(body, customModel, stream, undefined, false)
        ),
        signal,
      })
    }
    throw error
  }
}

export const request = async (url: string, init: RequestInit): Promise<Response> => {
  const { cacheModeEnabled, cacheBackendUrl } = useSettings.getState()
  const cacheOrigin = normalizeCacheBackendUrl(cacheBackendUrl)
  const isCacheTarget = cacheModeEnabled && url.startsWith(cacheOrigin)
  if (isCacheTarget) {
    await ensureNativeCacheStarted()
  }
  let response: Response
  try {
    response = await fetch(url, init)
  } catch (error) {
    if (init.signal?.aborted) {
      throw error
    }
    if (isCacheTarget && cacheOrigin !== API_ORIGIN) {
      const directUrl = `${API_ORIGIN}${url.slice(cacheOrigin.length)}`
      try {
        response = await fetch(directUrl, init)
      } catch (fallbackError) {
        if (init.signal?.aborted) {
          throw fallbackError
        }
        throw new ApiError(
          'network',
          fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
        )
      }
    } else {
      throw new ApiError('network', error instanceof Error ? error.message : String(error))
    }
  }
  if (!response.ok) {
    throw await readErrorResponse(response)
  }
  return response
}

const anthropicHeaders = (apiKey: string, beta: boolean): Record<string, string> => ({
  // DeepSeek 兼容接口的鉴权方式，也可使用 Authorization: Bearer。
  'x-api-key': apiKey,
  // Files API 和通过 file_id 引用图片时必传；纯文本聊天无需携带。
  ...(beta ? { 'anthropic-beta': FILES_BETA } : {}),
})

/** 用 GET /models 校验 API Key（不产生费用） */
export const verifyApiKey = async (apiKey: string, signal?: AbortSignal): Promise<void> => {
  await request(`${getBaseOrigin()}/models`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` },
    signal,
  })
}

export type BalanceInfo = {
  currency: 'CNY' | 'USD' | string
  total_balance: string
  granted_balance: string
  topped_up_balance: string
}

export type BalanceResponse = {
  is_available: boolean
  balance_infos: BalanceInfo[]
}

/** GET /user/balance 查询余额（不产生费用） */
export const getBalance = async (
  apiKey: string,
  signal?: AbortSignal
): Promise<BalanceResponse> => {
  const response = await request(`${getBaseOrigin()}/user/balance`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    signal,
  })
  return (await response.json()) as BalanceResponse
}

/**
 * POST /anthropic/v1/files 上传附件（不设过期时间，会话里的历史附件一直可用）。
 * purpose 为 null 时不传该字段（图片）；purpose 必须排在 file 之前。
 */
export const uploadFile = async (
  apiKey: string,
  file: File,
  purpose: FilePurpose | null,
  signal?: AbortSignal
): Promise<FileObject> => {
  const form = new FormData()
  if (purpose) {
    form.append('purpose', purpose)
  }
  form.append('file', file)
  const response = await request(`${getAnthropicBaseUrl()}/files`, {
    method: 'POST',
    headers: anthropicHeaders(apiKey, true),
    body: form,
    signal,
  })
  return (await response.json()) as FileObject
}

/** DELETE /anthropic/v1/files/{file_id} */
export const deleteFile = async (apiKey: string, fileId: string): Promise<void> => {
  await request(`${getAnthropicBaseUrl()}/files/${encodeURIComponent(fileId)}`, {
    method: 'DELETE',
    headers: anthropicHeaders(apiKey, true),
  })
}

const hasFile = (body: CreateMessageRequest) =>
  body.messages.some(
    (message) =>
      typeof message.content !== 'string' &&
      message.content.some((block) => block.type === 'image' || block.type === 'document')
  )

/**
 * POST /anthropic/v1/messages（stream: false），用于后台记忆提炼等单次请求。
 */
export const createMessage = async (
  apiKey: string,
  body: CreateMessageRequest,
  signal?: AbortSignal
): Promise<string> => {
  const settings = useSettings.getState()
  if (settings.apiProvider === 'custom') {
    const customUrl = settings.customApiUrl.trim()
    const customKey = settings.customApiKey?.trim() || apiKey
    const customModel = settings.customApiModel.trim() || body.model
    if (!customUrl || !customKey) {
      throw new ApiError('http', 'Missing custom API URL or API Key', 401)
    }
    try {
      const resolvedBody = await resolveCustomBodyFiles(body)
      if (settings.customApiProtocol === 'openai') {
        return await createCustomOpenAiMessage(
          { url: customUrl, apiKey: customKey, model: customModel },
          resolvedBody,
          signal
        )
      }
      const endpoint = normalizeCustomEndpoint(customUrl, 'anthropic')
      const response = await requestCustomAnthropic(
        endpoint,
        customKey,
        customModel,
        resolvedBody,
        false,
        signal
      )
      const data = (await response.json()) as {
        content?: Array<{ type?: string; text?: string }>
      }
      return (data.content ?? [])
        .filter((block) => block.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text ?? '')
        .join('')
    } catch (error) {
      if (error instanceof CustomApiRequestError) {
        throw new ApiError(error.kind, error.message, error.status)
      }
      throw error
    }
  }

  const response = await request(`${getAnthropicBaseUrl()}/messages`, {
    method: 'POST',
    headers: {
      ...anthropicHeaders(apiKey, hasFile(body)),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ ...body, stream: false }),
    signal,
  })
  const data = (await response.json()) as {
    content?: Array<{ type?: string; text?: string }>
  }
  return (data.content ?? [])
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text ?? '')
    .join('')
}

export const verifyCustomApi = async (
  config: { url: string; apiKey: string; model: string; protocol: 'openai' | 'anthropic' },
  signal?: AbortSignal
): Promise<void> => {
  try {
    await verifyCustomApiEndpoint(config, signal)
  } catch (error) {
    if (error instanceof CustomApiRequestError) {
      throw new ApiError(error.kind, error.message, error.status)
    }
    throw error
  }
}

export type StreamApiOverride = {
  provider: 'official' | 'custom'
  protocol?: 'openai' | 'anthropic'
  url?: string
  apiKey?: string
  model?: string
}

type LocalSearchOutcome = {
  ok?: boolean
  backend?: string
  cached?: boolean
  results?: Array<{
    title?: string
    url?: string
    snippet?: string
    pageContent?: string
  }>
}

const extractLastUserPlainText = (messages: MessageParam[]): string => {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i]
    if (msg.role !== 'user') {
      continue
    }
    if (typeof msg.content === 'string') {
      return msg.content
    }
    return msg.content
      .filter((b): b is TextBlockParam => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
  }
  return ''
}

const sanitizeCustomSearchQuery = (raw: string): string =>
  raw
    .replace(/<latest_reminder>[\s\S]*?<\/latest_reminder>/gi, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140)

const runCustomBuiltinSearch = async (
  body: CreateMessageRequest,
  cacheBackendUrl: string,
  signal: AbortSignal
): Promise<{
  patchedBody: CreateMessageRequest
  syntheticEvents: MessageStreamEvent[]
}> => {
  const wantsSearch = body.tools?.some((t) => t.name === 'deepseek_web_search')
  if (!wantsSearch) {
    return { patchedBody: body, syntheticEvents: [] }
  }
  const query = sanitizeCustomSearchQuery(extractLastUserPlainText(body.messages))
  if (!query) {
    return { patchedBody: body, syntheticEvents: [] }
  }

  const base = normalizeCacheBackendUrl(cacheBackendUrl)
  await ensureNativeCacheStarted()
  const controller = new AbortController()
  const onParentAbort = () => controller.abort()
  signal.addEventListener('abort', onParentAbort, { once: true })
  const timer = setTimeout(() => controller.abort(), 9000)

  try {
    const res = await fetch(`${base}/api/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, limit: 8, deepRead: true }),
      signal: controller.signal,
    })
    if (!res.ok) {
      return { patchedBody: body, syntheticEvents: [] }
    }
    const data = (await res.json()) as LocalSearchOutcome
    const items = (data.results ?? []).filter((r) => r.url && r.title)
    if (items.length === 0) {
      return { patchedBody: body, syntheticEvents: [] }
    }

    const toolId = `srvtoolu_custom_${Date.now().toString(36)}`
    const syntheticEvents: MessageStreamEvent[] = [
      {
        type: 'content_block_start',
        index: 900,
        content_block: {
          type: 'server_tool_use',
          id: toolId,
          name: 'deepseek_web_search',
          input: { action: 'search', query, queries: [query] },
          caller: { type: 'direct' },
          kind: 'search',
        },
      },
      { type: 'content_block_stop', index: 900 },
      {
        type: 'content_block_start',
        index: 901,
        content_block: {
          type: 'web_search_tool_result',
          tool_use_id: toolId,
          kind: 'search',
          content: items.map((item) => {
            let siteName: string | null = null
            try {
              siteName = new URL(item.url ?? '').hostname
            } catch {
              siteName = null
            }
            return {
              type: 'web_search_result' as const,
              title: item.title ?? '',
              url: item.url ?? '',
              snippet: item.snippet ?? '',
              site_name: siteName,
              site_icon: null,
              encrypted_content: '',
              page_age: null,
            }
          }),
        },
      },
      { type: 'content_block_stop', index: 901 },
    ]

    const lines = items.map((item, idx) => {
      const baseLine = `${idx + 1}. ${item.title ?? ''}\nURL: ${item.url ?? ''}\n摘要: ${item.snippet ?? ''}`
      return item.pageContent ? `${baseLine}\n正文节选:\n${item.pageContent}` : baseLine
    })
    const note = `【系统已通过内置增强搜索工具(${data.backend ?? 'search'})获取以下实时结果，请结合这些资料回答】\n关键词: ${query}\n${lines.join('\n\n')}`
    const nextMessages = body.messages.map((msg, idx) => {
      if (idx !== body.messages.length - 1 || msg.role !== 'user') {
        return msg
      }
      if (typeof msg.content === 'string') {
        return { ...msg, content: `${msg.content}\n\n${note}` }
      }
      return { ...msg, content: [...msg.content, { type: 'text' as const, text: `\n\n${note}` }] }
    })
    const remainingTools = body.tools?.filter(
      (t) => t.name !== 'deepseek_web_search' && t.name !== 'deepseek_read_url'
    )
    return {
      patchedBody: {
        ...body,
        messages: nextMessages,
        ...(remainingTools && remainingTools.length > 0
          ? { tools: remainingTools }
          : { tools: undefined }),
      },
      syntheticEvents,
    }
  } catch {
    return { patchedBody: body, syntheticEvents: [] }
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', onParentAbort)
  }
}

/**
 * POST /anthropic/v1/messages（stream: true），逐个产出流式事件，收到 message_stop 时结束。
 * ping、保活注释与无法解析的内容不产出；中止请求时抛出 signal 的 AbortError。
 */
export async function* streamMessage(
  apiKey: string,
  body: CreateMessageRequest,
  signal: AbortSignal,
  sessionId?: string,
  apiOverride?: StreamApiOverride
): AsyncGenerator<MessageStreamEvent> {
  const settings = useSettings.getState()
  const activeProvider = apiOverride?.provider ?? settings.apiProvider
  if (activeProvider === 'custom') {
    const customUrl = (apiOverride?.url ?? settings.customApiUrl).trim()
    const customKey = (apiOverride?.apiKey ?? settings.customApiKey ?? '').trim() || apiKey
    const customModel = (apiOverride?.model ?? settings.customApiModel).trim() || body.model
    const customProtocol = apiOverride?.protocol ?? settings.customApiProtocol
    if (!customUrl || !customKey) {
      throw new ApiError('http', 'Missing custom API URL or API Key', 401)
    }
    const baseResolved = await resolveCustomBodyFiles(body)
    const { patchedBody: resolvedBody, syntheticEvents } = settings.builtinSearchEnabled
      ? await runCustomBuiltinSearch(baseResolved, settings.cacheBackendUrl, signal)
      : { patchedBody: baseResolved, syntheticEvents: [] }
    for (const synth of syntheticEvents) {
      yield synth
    }
    if (customProtocol === 'openai') {
      try {
        yield* streamCustomOpenAiMessage(
          { url: customUrl, apiKey: customKey, model: customModel },
          resolvedBody,
          signal
        )
        return
      } catch (error) {
        if (error instanceof CustomApiRequestError) {
          throw new ApiError(error.kind, error.message, error.status)
        }
        throw error
      }
    }
    const endpoint = normalizeCustomEndpoint(customUrl, 'anthropic')
    const response = await requestCustomAnthropic(
      endpoint,
      customKey,
      customModel,
      resolvedBody,
      true,
      signal
    )
    const contentType = response.headers.get('Content-Type') ?? ''
    if (!response.body || !contentType.includes('text/event-stream')) {
      throw await readErrorResponse(response, 'protocol', '')
    }
    for await (const { event: eventName, data } of readServerSentEvents(response.body, signal)) {
      let payload: unknown
      try {
        payload = JSON.parse(data)
      } catch {
        if (eventName !== 'error') {
          continue
        }
      }
      if (isErrorBody(payload)) {
        throw new ApiError('stream', payload.error.message)
      }
      if (eventName === 'error') {
        throw new ApiError('stream', data)
      }
      const event = readMessageEvent(payload)
      if (!event) {
        continue
      }
      yield event
      if (event.type === 'message_stop') {
        return
      }
    }
    throw new ApiError('interrupted', '')
  }

  const effectiveOfficialKey = (apiOverride?.apiKey ?? '').trim() || apiKey
  const effectiveBody =
    apiOverride?.provider === 'official' && apiOverride.model?.trim()
      ? { ...body, model: apiOverride.model.trim() as CreateMessageRequest['model'] }
      : body

  const response = await request(`${getAnthropicBaseUrl()}/messages`, {
    method: 'POST',
    headers: {
      ...anthropicHeaders(effectiveOfficialKey, hasFile(effectiveBody)),
      ...(sessionId ? { 'x-session-id': sessionId } : {}),
      'x-builtin-search': settings.builtinSearchEnabled ? '1' : '0',
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({ ...effectiveBody, stream: true }),
    signal,
  })
  const contentType = response.headers.get('Content-Type') ?? ''
  if (!response.body || !contentType.includes('text/event-stream')) {
    throw await readErrorResponse(response, 'protocol', '')
  }
  for await (const { event: eventName, data } of readServerSentEvents(response.body, signal)) {
    let payload: unknown
    try {
      payload = JSON.parse(data)
    } catch {
      if (eventName !== 'error') {
        continue
      }
    }
    if (isErrorBody(payload)) {
      throw new ApiError('stream', payload.error.message)
    }
    if (eventName === 'error') {
      throw new ApiError('stream', data)
    }
    const event = readMessageEvent(payload)
    if (!event) {
      continue
    }
    yield event
    if (event.type === 'message_stop') {
      return
    }
  }
  // 服务端没有提供错误内容时保持为空，不推测断流原因。
  throw new ApiError('interrupted', '')
}
