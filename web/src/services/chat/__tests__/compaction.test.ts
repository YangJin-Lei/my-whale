import { describe, expect, it, vi } from 'vitest'

vi.mock('../../api/client.js', () => ({
  createMessage: vi.fn(),
}))

import {
  estimateHistoryTokens,
  estimateMessageTokens,
  estimateTextTokens,
  fitRequestHistory,
  formatCompactionRecordsBlock,
  recallCompactedEvidence,
} from '../compaction.js'
import type { AssistantMessage, SessionCompaction, UserMessage } from '../types.js'

const user = (id: string, content: string): UserMessage => ({
  id,
  role: 'user',
  content,
  files: [],
  createdAt: 1,
})

const assistant = (id: string, text: string): AssistantMessage => ({
  id,
  role: 'assistant',
  createdAt: 2,
  model: 'deepseek-flash',
  prefix: true,
  status: 'done',
  blocks: [{ type: 'text', text }],
})

describe('token estimation', () => {
  it('estimates ASCII and CJK text differently', () => {
    expect(estimateTextTokens('')).toBe(0)
    expect(estimateTextTokens('abc')).toBe(1)
    expect(estimateTextTokens('你好')).toBe(3)
    expect(estimateTextTokens('a你')).toBe(2)
  })

  it('charges image and document attachments fixed token costs', () => {
    const imageQuestion: UserMessage = {
      ...user('u1', ''),
      files: [
        {
          id: 'f1',
          serverId: 'file-1',
          name: 'a.png',
          size: 1,
          isImage: true,
          mimeType: 'image/png',
        },
      ],
    }
    const documentQuestion: UserMessage = {
      ...user('u2', ''),
      files: [
        {
          id: 'f2',
          serverId: 'file-2',
          name: 'a.pdf',
          size: 1,
          isImage: false,
          mimeType: 'application/pdf',
        },
      ],
    }

    expect(estimateMessageTokens(imageQuestion)).toBe(1024 + 12)
    expect(estimateMessageTokens(documentQuestion)).toBe(2048 + 12)
    expect(estimateMessageTokens(assistant('a1', 'abcd'))).toBe(2 + 12)
  })

  it('sums every message in the history', () => {
    expect(
      estimateHistoryTokens([user('u1', 'abc'), assistant('a1', 'abc')])
    ).toBe(13 + 13)
  })
})

describe('fitRequestHistory', () => {
  const rounds = [
    [user('u1', 'abc'), assistant('a1', 'abc')],
    [user('u2', 'abc'), assistant('a2', 'abc')],
    [user('u3', 'abc'), assistant('a3', 'abc')],
  ] as const

  it('keeps the newest round even when it alone exceeds the budget', () => {
    const fitted = fitRequestHistory(rounds.flat(), 1)

    expect(fitted.map((message) => message.id)).toEqual(['u3', 'a3'])
  })

  it('drops older rounds until the budget is satisfied', () => {
    const fitted = fitRequestHistory(rounds.flat(), 30)

    expect(fitted.map((message) => message.id)).toEqual(['u3', 'a3'])
  })

  it('returns the whole history when there are no usable rounds', () => {
    const history = [user('u1', '没有回答')]

    expect(fitRequestHistory(history, 10)).toBe(history)
  })
})

describe('formatCompactionRecordsBlock', () => {
  it('returns an empty string without records', () => {
    expect(formatCompactionRecordsBlock(undefined)).toBe('')
    expect(
      formatCompactionRecordsBlock({
        level: 'light',
        retainedFromId: null,
        lastReplyId: null,
        segments: [],
        records: [],
        updatedAt: 0,
      })
    ).toBe('')
  })

  it('renders records with their category and level', () => {
    const compaction: SessionCompaction = {
      level: 'medium',
      retainedFromId: 'u2',
      lastReplyId: 'a2',
      segments: [],
      records: [
        {
          id: 'r1',
          category: 'preference',
          content: '用户喜欢简洁回答',
          quote: '',
          sourceMessageId: 'u1',
          importance: 3,
          updatedAt: 1,
        },
      ],
      updatedAt: 1,
    }

    expect(formatCompactionRecordsBlock(compaction)).toBe(
      '[长期对话关键事实 · 档位:medium]\n- [preference] 用户喜欢简洁回答'
    )
  })
})

describe('recallCompactedEvidence', () => {
  const history = [
    user('u1', '我不吃香菜'),
    assistant('a1', '好的，记住你不吃香菜'),
    user('u2', '继续'),
    assistant('a2', '继续回答'),
  ]

  it('recalls an early snippet that matches the current question', () => {
    const evidence = recallCompactedEvidence(history, 'u2', '晚饭想吃香菜吗', 1_000)

    expect(evidence).toContain('[按需召回的早期原文依据]')
    expect(evidence).toContain('[早期第1轮原文片段]')
    expect(evidence).toContain('不吃香菜')
  })

  it('returns an empty string without a match or a valid cut point', () => {
    expect(recallCompactedEvidence(history, 'u2', '完全无关的问题', 1_000)).toBe('')
    expect(recallCompactedEvidence(history, null, '香菜', 1_000)).toBe('')
    expect(recallCompactedEvidence(history, 'u1', '香菜', 1_000)).toBe('')
    expect(recallCompactedEvidence(history, 'u2', '香菜', 0)).toBe('')
  })
})
