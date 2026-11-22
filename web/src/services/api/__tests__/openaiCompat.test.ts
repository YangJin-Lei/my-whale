import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildCustomAnthropicPayload,
  extractOpenAiCompletionText,
  streamCustomOpenAiMessage,
} from '../openaiCompat.js'
import type { CreateMessageRequest, MessageStreamEvent } from '../types.js'

const makeBody = (): CreateMessageRequest => ({
  model: 'deepseek-flash',
  system: '默认系统设定',
  messages: [
    { role: 'latest_reminder', content: '[早期对话摘要] 用户偏好简短回答' },
    { role: 'latest_reminder', content: '2026-11-22,星期日,杭州,Web,中文' },
    { role: 'user', content: '你好' },
  ],
  thinking: { type: 'enabled' },
  safety_check: { level: 'high' },
})

describe('openaiCompat custom API helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('preserves compaction summary and adds Chinese rule in Anthropic custom payload', () => {
    const payload = buildCustomAnthropicPayload(makeBody(), 'claude-test', true)
    expect(payload.system).toContain('默认系统设定')
    expect(payload.system).toContain('[早期对话摘要] 用户偏好简短回答')
    expect(payload.system).toContain('请始终使用中文进行思考和回复')
    expect(payload.messages).toHaveLength(1)
    expect(payload.messages[0]?.role).toBe('user')
  })

  it('strips inline <think> tags from non-streaming OpenAI completion text', () => {
    const text = extractOpenAiCompletionText({
      choices: [{ message: { content: '<think>Analyze the Request</think>\n你好世界' } }],
    })
    expect(text).toBe('你好世界')
  })

  it('splits chunk-boundary <think>...</think> into thinking_delta and text_delta during SSE', async () => {
    const encoder = new TextEncoder()
    const sseChunks = [
      'data: {"id":"1","choices":[{"index":0,"delta":{"content":"<thi"}}]}\n\n',
      'data: {"id":"1","choices":[{"index":0,"delta":{"content":"nk>内部思考</th"}}]}\n\n',
      'data: {"id":"1","choices":[{"index":0,"delta":{"content":"ink>正式中文回复"}}]}\n\n',
      'data: [DONE]\n\n',
    ]
    let capturedBody = ''
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        capturedBody = typeof init?.body === 'string' ? init.body : ''
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            for (const chunk of sseChunks) {
              controller.enqueue(encoder.encode(chunk))
            }
            controller.close()
          },
        })
        return new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })
      })
    )

    const events: MessageStreamEvent[] = []
    for await (const ev of streamCustomOpenAiMessage(
      { url: 'https://example.com/v1', apiKey: 'sk-test', model: 'glm-4-flash' },
      makeBody(),
      new AbortController().signal
    )) {
      events.push(ev)
    }

    const parsedReq = JSON.parse(capturedBody) as {
      messages: Array<{ role: string; content: string }>
    }
    expect(parsedReq.messages[0]?.role).toBe('system')
    expect(parsedReq.messages[0]?.content).toContain('请始终使用中文进行思考和回复')

    const thinkingText = events
      .filter((e) => e.type === 'content_block_delta' && e.delta.type === 'thinking_delta')
      .map((e) =>
        e.type === 'content_block_delta' && e.delta.type === 'thinking_delta'
          ? e.delta.thinking
          : ''
      )
      .join('')
    const replyText = events
      .filter((e) => e.type === 'content_block_delta' && e.delta.type === 'text_delta')
      .map((e) =>
        e.type === 'content_block_delta' && e.delta.type === 'text_delta' ? e.delta.text : ''
      )
      .join('')

    expect(thinkingText).toBe('内部思考')
    expect(replyText).toBe('正式中文回复')
  })
})
