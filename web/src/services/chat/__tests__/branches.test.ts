import { describe, expect, it } from 'vitest'
import {
  appendBranch,
  buildMessageVersions,
  getVisibleMessages,
  normalizeSession,
  selectVersion,
} from '../branches.js'
import type { AssistantMessage, Message, Session, UserMessage } from '../types.js'

const user = (id: string, content = '你好'): UserMessage => ({
  id,
  role: 'user',
  content,
  files: [],
  createdAt: 1,
})

const assistant = (id: string, text = '收到'): AssistantMessage => ({
  id,
  role: 'assistant',
  createdAt: 2,
  model: 'deepseek-flash',
  prefix: true,
  status: 'done',
  blocks: [{ type: 'text', text }],
})

const session = (messages: Message[], rootMessageId?: string | null): Session => ({
  id: 's1',
  title: '测试会话',
  createdAt: 0,
  updatedAt: 0,
  messages,
  ...(rootMessageId === undefined ? {} : { rootMessageId }),
})

const branch = (message: Message, parentId: string | null, selectedChildId?: string): Message => ({
  ...message,
  parentId,
  ...(selectedChildId === undefined ? {} : { selectedChildId }),
})

describe('normalizeSession', () => {
  it('turns a linear message list into a single branch', () => {
    const normalized = normalizeSession(session([user('u1'), assistant('a1'), user('u2')]))

    expect(normalized.rootMessageId).toBe('u1')
    expect(normalized.messages.map((message) => message.parentId)).toEqual([null, 'u1', 'a1'])
    expect(normalized.messages.map((message) => message.selectedChildId)).toEqual([
      'a1',
      'u2',
      undefined,
    ])
  })

  it('keeps an already normalized session untouched', () => {
    const original = session([user('u1')], 'u1')
    expect(normalizeSession(original)).toBe(original)
  })
})

describe('getVisibleMessages', () => {
  it('returns the linear list when the session has no branch metadata', () => {
    const messages = [user('u1'), assistant('a1')]
    expect(getVisibleMessages(session(messages))).toBe(messages)
  })

  it('follows selectedChildId instead of creation order', () => {
    const root = branch(user('u1'), null, 'a2')
    const first = branch(assistant('a1', '旧回答'), 'u1')
    const second = branch(assistant('a2', '新回答'), 'u1', 'u2')
    const next = branch(user('u2', '继续'), 'a2')

    const visible = getVisibleMessages(session([root, first, second, next], 'u1'))

    expect(visible.map((message) => message.id)).toEqual(['u1', 'a2', 'u2'])
  })

  it('stops when a selected child is missing instead of guessing another branch', () => {
    const root = branch(user('u1'), null, 'missing')
    const orphan = branch(assistant('a1'), 'u1')

    const visible = getVisibleMessages(session([root, orphan], 'u1'))

    expect(visible.map((message) => message.id)).toEqual(['u1'])
  })
})

describe('appendBranch', () => {
  it('selects the new branch and leaves the old branch available', () => {
    const original = session(
      [branch(user('u1'), null, 'a1'), branch(assistant('a1'), 'u1')],
      'u1'
    )
    const updated = appendBranch(original, 'u1', [assistant('a2', '新回答')])

    const root = updated.messages.find((message) => message.id === 'u1')
    const newReply = updated.messages.find((message) => message.id === 'a2')

    expect(root?.selectedChildId).toBe('a2')
    expect(newReply?.parentId).toBe('u1')
    expect(updated.messages.some((message) => message.id === 'a1')).toBe(true)
    expect(getVisibleMessages(updated).map((message) => message.id)).toEqual(['u1', 'a2'])
  })

  it('uses the first appended message as the root for an empty session', () => {
    const updated = appendBranch(session([]), null, [user('u1')])

    expect(updated.rootMessageId).toBe('u1')
    expect(updated.messages[0]?.parentId).toBeNull()
  })
})

describe('selectVersion', () => {
  it('switches to a sibling on the visible path', () => {
    const original = session(
      [
        branch(user('u1'), null, 'a1'),
        branch(assistant('a1', '旧回答'), 'u1'),
        branch(assistant('a2', '新回答'), 'u1', 'u2'),
        branch(user('u2'), 'a2'),
      ],
      'u1'
    )

    const updated = selectVersion(original, 'a2')

    expect(updated.messages.find((message) => message.id === 'u1')?.selectedChildId).toBe('a2')
    expect(getVisibleMessages(updated).map((message) => message.id)).toEqual(['u1', 'a2', 'u2'])
  })

  it('ignores versions whose parent is not on the visible path', () => {
    const original = session(
      [
        branch(user('u1'), null, 'a1'),
        branch(assistant('a1'), 'u1'),
        branch(assistant('a2'), 'u1'),
        branch(assistant('b1'), 'a2'),
        branch(assistant('b2'), 'b1'),
      ],
      'u1'
    )

    expect(selectVersion(original, 'b2')).toBe(original)
    expect(selectVersion(original, 'missing')).toBe(original)
  })
})

describe('buildMessageVersions', () => {
  it('lists sibling versions and reuses the previous map when nothing changed', () => {
    const original = session(
      [branch(user('u1'), null, 'a1'), branch(assistant('a1'), 'u1'), branch(assistant('a2'), 'u1')],
      'u1'
    )

    const first = buildMessageVersions(original, new Map())
    expect(first.get('a1')).toEqual({ ids: ['a1', 'a2'], index: 0 })
    expect(first.get('a2')).toEqual({ ids: ['a1', 'a2'], index: 1 })

    const second = buildMessageVersions(original, first)
    expect(second).toBe(first)
  })

  it('rebuilds the map when a new sibling is appended', () => {
    const root = branch(user('u1'), null, 'a1')
    const replies = [branch(assistant('a1'), 'u1'), branch(assistant('a2'), 'u1')]
    const original = session([root, ...replies], 'u1')
    const first = buildMessageVersions(original, new Map())

    const updated = session(
      [root, ...replies, branch(assistant('a3'), 'u1')],
      'u1'
    )
    const second = buildMessageVersions(updated, first)

    expect(second).not.toBe(first)
    expect(second.get('a3')).toEqual({ ids: ['a1', 'a2', 'a3'], index: 2 })
  })
})
