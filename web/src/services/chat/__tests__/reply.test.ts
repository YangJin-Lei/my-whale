import { describe, expect, it } from 'vitest'
import {
  applyEvent,
  canContinueReply,
  getContextRounds,
  getThinkingSeconds,
  settleReply,
  toRequestMessages,
} from '../reply.js'
import type { AssistantMessage, UserMessage } from '../types.js'
import type { MessageStreamEvent } from '../../api/types.js'

const user = (id: string, content = '你好'): UserMessage => ({
  id,
  role: 'user',
  content,
  files: [],
  createdAt: 1,
})

const assistant = (overrides: Partial<AssistantMessage> = {}): AssistantMessage => ({
  id: 'a1',
  role: 'assistant',
  createdAt: 2,
  model: 'deepseek-flash',
  prefix: true,
  status: 'streaming',
  blocks: [],
  ...overrides,
})

const textReply = (id: string, text: string, latestReminder?: string): AssistantMessage =>
  assistant({
    id,
    status: 'done',
    blocks: [{ type: 'text', text }],
    ...(latestReminder === undefined ? {} : { latestReminder }),
  })

describe('applyEvent', () => {
  it('accumulates text, thinking, signature and stops the thinking block', () => {
    const indexes = new Map<number, number>()
    let reply = assistant()

    reply = applyEvent(
      reply,
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'thinking', thinking: '', signature: '' },
      },
      1_000,
      indexes
    )
    reply = applyEvent(
      reply,
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '分析' } },
      1_100,
      indexes
    )
    reply = applyEvent(
      reply,
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'signature_delta', signature: 'sig-1' },
      },
      1_200,
      indexes
    )
    reply = applyEvent(
      reply,
      { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
      1_300,
      indexes
    )
    reply = applyEvent(
      reply,
      { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: '你好' } },
      1_400,
      indexes
    )
    reply = applyEvent(reply, { type: 'content_block_stop', index: 0 }, 1_500, indexes)

    expect(reply.status).toBe('streaming')
    expect(reply.blocks[0]).toMatchObject({
      type: 'thinking',
      thinking: '分析',
      signature: 'sig-1',
      startedAt: 1_000,
      endedAt: 1_500,
    })
    expect(reply.blocks[1]).toMatchObject({ type: 'text', text: '你好' })
  })

  it('does not let a skipped client tool block occupy an index', () => {
    const indexes = new Map<number, number>()
    let reply = assistant()

    reply = applyEvent(
      reply,
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 'tool-1', name: 'local', input: {} },
      },
      1,
      indexes
    )
    expect(reply.blocks).toEqual([])
    expect(reply.prefix).toBe(false)

    reply = applyEvent(
      reply,
      { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
      2,
      indexes
    )
    reply = applyEvent(
      reply,
      { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: '正文' } },
      3,
      indexes
    )

    expect(reply.blocks).toEqual([{ type: 'text', text: '正文', citations: [] }])
  })

  it('records stop reason and usage from message_delta', () => {
    const event: MessageStreamEvent = {
      type: 'message_delta',
      delta: { stop_reason: 'max_tokens', stop_sequence: null },
      usage: {
        input_tokens: 10,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        output_tokens: 20,
      },
    }

    const reply = applyEvent(assistant(), event, 1, new Map())

    expect(reply.stopReason).toBe('max_tokens')
    expect(reply.usage?.output_tokens).toBe(20)
  })
})

describe('settleReply', () => {
  it('closes an unfinished thinking block with the settle time', () => {
    const reply = settleReply(
      assistant({
        blocks: [{ type: 'thinking', thinking: '思考中', signature: 'sig', startedAt: 100 }],
      }),
      'done',
      900
    )

    expect(reply.status).toBe('done')
    expect(reply.blocks[0]).toMatchObject({ type: 'thinking', endedAt: 900 })
  })

  it('drops text and thinking on refusal but keeps server tool blocks', () => {
    const reply = settleReply(
      assistant({
        stopReason: 'refusal',
        blocks: [
          { type: 'thinking', thinking: '思考', signature: 'sig' },
          { type: 'text', text: '不能回答' },
          {
            type: 'server_tool_use',
            id: 'srvtoolu_search_1_abc',
            name: 'deepseek_web_search',
            input: { action: 'search', queries: ['测试'] },
            caller: { type: 'direct' },
            kind: 'search',
          },
        ],
      }),
      'done',
      1
    )

    expect(reply.blocks.map((block) => block.type)).toEqual(['server_tool_use'])
  })
})

describe('canContinueReply', () => {
  it('allows stopped replies and max_tokens replies only', () => {
    expect(canContinueReply(assistant({ status: 'stopped' }))).toBe(true)
    expect(canContinueReply(assistant({ status: 'done', stopReason: 'max_tokens' }))).toBe(true)
    expect(canContinueReply(assistant({ status: 'done', stopReason: 'end_turn' }))).toBe(false)
    expect(canContinueReply(assistant({ status: 'error' }))).toBe(false)
    expect(canContinueReply(assistant({ status: 'stopped', prefix: false }))).toBe(false)
  })

  it('rejects refusals, tool rounds and template text', () => {
    expect(canContinueReply(assistant({ status: 'stopped', stopReason: 'refusal' }))).toBe(false)
    expect(canContinueReply(assistant({ status: 'stopped', stopReason: 'tool_use' }))).toBe(false)
    expect(
      canContinueReply(
        assistant({
          status: 'stopped',
          blocks: [
            {
              type: 'web_search_tool_result',
              tool_use_id: 'tool-1',
              content: [],
              kind: 'search',
            },
          ],
        })
      )
    ).toBe(false)
    expect(
      canContinueReply(
        assistant({ status: 'stopped', blocks: [{ type: 'text', text: '提示', isTemplate: true }] })
      )
    ).toBe(false)
  })
})

describe('getContextRounds', () => {
  it('keeps only pairs whose answer is usable', () => {
    const history = [
      user('u1'),
      assistant({ id: 'a1', status: 'error', blocks: [{ type: 'text', text: '失败' }] }),
      user('u2'),
      textReply('a2', '正常回答'),
      user('u3'),
      assistant({ id: 'a3', status: 'stopped', blocks: [] }),
      user('u4'),
      textReply('a4', '停止后仍有正文'),
    ]

    const rounds = getContextRounds(history)

    expect(rounds.map(([question, reply]) => [question.id, reply.id])).toEqual([
      ['u2', 'a2'],
      ['u4', 'a4'],
    ])
  })
})

describe('toRequestMessages', () => {
  it('keeps compaction segments first and only inserts changed reminders', () => {
    const history = [
      user('u1'),
      textReply('a1', '第一答', 'R1'),
      user('u2'),
      textReply('a2', '第二答', 'R1'),
      user('u3'),
      textReply('a3', '第三答', 'R2'),
    ]

    const messages = toRequestMessages(history, user('u4', '本轮'), undefined, false, 'R2', [
      '摘要 A',
      '摘要 B',
    ])

    expect(messages.slice(0, 2)).toEqual([
      { role: 'latest_reminder', content: '[早期对话摘要] 摘要 A' },
      { role: 'latest_reminder', content: '[早期对话摘要] 摘要 B' },
    ])
    const reminders = messages
      .filter((message) => message.role === 'latest_reminder')
      .map((message) => message.content)
    expect(reminders).toEqual([
      '[早期对话摘要] 摘要 A',
      '[早期对话摘要] 摘要 B',
      'R1',
      'R2',
    ])
    expect(messages).toHaveLength(11)
  })

  it('omits an empty question whose files have no server id', () => {
    const emptyWithLocalFile: UserMessage = {
      ...user('u1', ''),
      files: [
        {
          id: 'f1',
          serverId: null,
          name: 'a.png',
          size: 1,
          isImage: true,
          mimeType: 'image/png',
        },
      ],
    }
    const history = [
      emptyWithLocalFile,
      textReply('a1', '回答'),
      user('u2', '有内容'),
      textReply('a2', '第二答'),
    ]

    const messages = toRequestMessages(history, user('u3', '本轮'))

    expect(messages.map((message) => message.role)).toEqual(['user', 'assistant', 'user'])
  })

  it('appends a continuation prefix only when it has meaningful content', () => {
    const question = user('u1', '继续写')
    const emptyPrefix = assistant({ blocks: [{ type: 'text', text: '   ' }] })
    const textPrefix = assistant({ blocks: [{ type: 'text', text: '后半段' }] })

    expect(toRequestMessages([], question, emptyPrefix)).toEqual([
      { role: 'user', content: '继续写' },
    ])
    expect(toRequestMessages([], question, textPrefix)).toEqual([
      { role: 'user', content: '继续写' },
      { role: 'assistant', content: [{ type: 'text', text: '后半段' }] },
    ])
  })

  it('replays thinking in a prefix only when thinking is enabled', () => {
    const question = user('u1', '继续')
    const prefix = assistant({
      blocks: [
        { type: 'thinking', thinking: '推理', signature: 'sig' },
        { type: 'text', text: '正文' },
      ],
    })

    const withThinking = toRequestMessages([], question, prefix, true)
    const withoutThinking = toRequestMessages([], question, prefix, false)

    expect(withThinking.at(-1)).toMatchObject({
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: '推理', signature: 'sig' },
        { type: 'text', text: '正文' },
      ],
    })
    expect(withoutThinking.at(-1)).toEqual({
      role: 'assistant',
      content: [{ type: 'text', text: '正文' }],
    })
  })
})

describe('getThinkingSeconds', () => {
  it('never reports less than one second', () => {
    expect(getThinkingSeconds(1_000, 1_000)).toBe(1)
    expect(getThinkingSeconds(1_000, 2_500)).toBe(2)
  })
})
