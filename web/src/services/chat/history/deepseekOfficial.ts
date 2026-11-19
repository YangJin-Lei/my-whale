import { createId } from '../../../utils/id.js'
import type { AssistantMessage, Message, ReplyBlock, Session, UserMessage } from '../types.js'
import { fail } from './errors.js'

const parseTimestamp = (raw: unknown, fallback: number): number => {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw < 1e12 ? Math.round(raw * 1000) : Math.round(raw)
  }
  if (typeof raw === 'string' && raw.trim()) {
    const parsed = Date.parse(raw)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return fallback
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const extractOfficialMessage = (
  rawMsg: Record<string, unknown>,
  nodeId: string,
  parentId: string | null,
  fallbackTime: number
): Message | null => {
  const fragments = Array.isArray(rawMsg.fragments) ? rawMsg.fragments.filter(isRecord) : []

  const createdAt = parseTimestamp(rawMsg.inserted_at ?? rawMsg.created_at, fallbackTime)
  const rawRole = typeof rawMsg.role === 'string' ? rawMsg.role.toUpperCase() : ''

  let hasRequest = false
  let requestText = ''
  const assistantBlocks: ReplyBlock[] = []

  for (const frag of fragments) {
    const fType = typeof frag.type === 'string' ? frag.type.toUpperCase() : ''
    const content = typeof frag.content === 'string' ? frag.content : ''
    if (fType === 'REQUEST') {
      hasRequest = true
      requestText += content
    } else if (fType === 'THINK') {
      if (content) {
        assistantBlocks.push({
          type: 'thinking',
          thinking: content,
          ...(typeof frag.elapsed_secs === 'number' ? { elapsedSeconds: frag.elapsed_secs } : {}),
        })
      }
    } else if (fType === 'RESPONSE' || fType === 'TEMPLATE_RESPONSE') {
      if (content) {
        assistantBlocks.push({
          type: 'text',
          text: content,
          ...(fType === 'TEMPLATE_RESPONSE' ? { isTemplate: true } : {}),
        })
      }
    }
  }

  const directContent = typeof rawMsg.content === 'string' ? rawMsg.content : ''
  const directThinking =
    typeof rawMsg.thinking_content === 'string'
      ? rawMsg.thinking_content
      : typeof rawMsg.reasoning_content === 'string'
        ? rawMsg.reasoning_content
        : ''

  const isUser =
    rawRole === 'USER' ||
    (rawRole === '' && (hasRequest || (assistantBlocks.length === 0 && !directThinking)))

  if (isUser) {
    const text = (hasRequest ? requestText : directContent).trim()
    if (!text) {
      return null
    }
    const msg: UserMessage = {
      id: nodeId,
      parentId,
      role: 'user',
      content: text,
      files: [],
      createdAt,
    }
    return msg
  }

  if (assistantBlocks.length === 0) {
    if (directThinking.trim()) {
      assistantBlocks.push({ type: 'thinking', thinking: directThinking })
    }
    if (directContent.trim()) {
      assistantBlocks.push({ type: 'text', text: directContent })
    }
  }
  if (assistantBlocks.length === 0) {
    return null
  }

  const assistantMsg: AssistantMessage = {
    id: nodeId,
    parentId,
    role: 'assistant',
    createdAt,
    model: null,
    prefix: false,
    status: 'done',
    blocks: assistantBlocks,
  }
  return assistantMsg
}

const parseMappingConversation = (conv: Record<string, unknown>, now: number): Message[] => {
  const mapping = conv.mapping
  if (!isRecord(mapping)) {
    return []
  }

  const rawMessages: Message[] = []
  const visited = new Set<string>()
  const rootKey = Object.hasOwn(mapping, 'root')
    ? 'root'
    : Object.keys(mapping).find((key) => {
        const node = mapping[key]
        return isRecord(node) && (node.parent === null || node.parent === undefined)
      })

  const visit = (key: string, prevParentId: string | null) => {
    if (visited.has(key)) {
      return
    }
    visited.add(key)
    const node = mapping[key]
    if (!isRecord(node)) {
      return
    }

    let nextParentId = prevParentId
    if (isRecord(node.message)) {
      const msgId = String(node.id ?? key ?? createId())
      const extracted = extractOfficialMessage(node.message, msgId, prevParentId, now)
      if (extracted) {
        rawMessages.push(extracted)
        nextParentId = extracted.id
      }
    }

    const children = Array.isArray(node.children) ? node.children : []
    for (const child of children) {
      if (typeof child === 'string') {
        visit(child, nextParentId)
      }
    }
  }

  if (rootKey) {
    visit(rootKey, null)
  } else {
    let prevId: string | null = null
    for (const [key, node] of Object.entries(mapping)) {
      if (!isRecord(node) || !isRecord(node.message)) {
        continue
      }
      const extracted = extractOfficialMessage(node.message, String(node.id ?? key), prevId, now)
      if (extracted) {
        rawMessages.push(extracted)
        prevId = extracted.id
      }
    }
  }

  // 回填 selectedChildId 让分叉树沿最后选中的一条分支展示
  const byId = new Map(rawMessages.map((m) => [m.id, m]))
  for (const m of rawMessages) {
    if (m.parentId) {
      const parent = byId.get(m.parentId)
      if (parent) {
        parent.selectedChildId = m.id
      }
    }
  }

  return rawMessages
}

const parseFlatMessages = (conv: Record<string, unknown>, now: number): Message[] => {
  if (!Array.isArray(conv.messages)) {
    return []
  }
  const result: Message[] = []
  let prevId: string | null = null
  conv.messages.forEach((raw, idx) => {
    if (!isRecord(raw)) {
      return
    }
    const id = String(raw.id ?? `msg-${idx + 1}`)
    const msg = extractOfficialMessage(raw, id, prevId, now + idx)
    if (msg) {
      result.push(msg)
      prevId = msg.id
    }
  })
  return result
}

const toSingleSession = (
  rawConv: Record<string, unknown>,
  fallbackTime: number
): Session | null => {
  const createdAt = parseTimestamp(rawConv.inserted_at ?? rawConv.created_at, fallbackTime)
  const updatedAt = parseTimestamp(rawConv.updated_at, createdAt)
  const messages = isRecord(rawConv.mapping)
    ? parseMappingConversation(rawConv, createdAt)
    : parseFlatMessages(rawConv, createdAt)

  if (messages.length === 0) {
    return null
  }
  const title = typeof rawConv.title === 'string' ? rawConv.title : ''
  const id = typeof rawConv.id === 'string' && rawConv.id.trim() ? rawConv.id.trim() : createId()

  return {
    id,
    title,
    createdAt,
    updatedAt,
    messages,
  }
}

/**
 * 解析 DeepSeek 官方手机端/网页端导出的 `conversations.json`（兼容单会话、会话数组与 `{ conversations: [...] }`）。
 */
export const parseOfficialDeepSeekConversations = (rawJson: unknown): Session[] => {
  const now = Date.now()
  let items: unknown[]
  if (Array.isArray(rawJson)) {
    items = rawJson
  } else if (isRecord(rawJson) && Array.isArray(rawJson.conversations)) {
    items = rawJson.conversations
  } else if (isRecord(rawJson) && (isRecord(rawJson.mapping) || Array.isArray(rawJson.messages))) {
    items = [rawJson]
  } else {
    return fail('backupUnrecognized')
  }

  const sessions: Session[] = []
  let recognizedShape = false
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i]
    if (!isRecord(item)) {
      continue
    }
    if (isRecord(item.mapping) || Array.isArray(item.messages)) {
      recognizedShape = true
      const session = toSingleSession(item, now - i * 1000)
      if (session) {
        sessions.push(session)
      }
    }
  }

  if (!recognizedShape && items.length > 0) {
    return fail('backupUnrecognized')
  }
  return sessions
}
