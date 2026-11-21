import { describe, expect, it } from 'vitest'
import { readServerSentEvents, ServerSentEventDecoder, type ServerSentEvent } from '../sse.js'

const collect = async (
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal
): Promise<ServerSentEvent[]> => {
  const events: ServerSentEvent[] = []
  for await (const event of readServerSentEvents(stream, signal)) {
    events.push(event)
  }
  return events
}

const streamOf = (...chunks: Uint8Array[]): ReadableStream<Uint8Array> =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk)
      }
      controller.close()
    },
  })

describe('ServerSentEventDecoder', () => {
  it('parses event, id and multi-line data with CRLF', () => {
    const decoder = new ServerSentEventDecoder()
    const events = decoder.push('event: delta\r\nid: 7\r\ndata: a\r\ndata: b\r\n\r\n')

    expect(events).toEqual([{ event: 'delta', data: 'a\nb', lastEventId: '7' }])
  })

  it('waits when CRLF is split across chunks', () => {
    const decoder = new ServerSentEventDecoder()

    expect(decoder.push('data: a\r')).toEqual([])
    expect(decoder.push('\ndata: b\r\n\r\n')).toEqual([
      { event: 'message', data: 'a\nb', lastEventId: '' },
    ])
  })

  it('supports LF and CR-only line endings', () => {
    const decoder = new ServerSentEventDecoder()
    const events = decoder.push('data: x\r\rdata: y\n\n')

    expect(events.map((event) => event.data)).toEqual(['x', 'y'])
  })

  it('ignores comments and does not dispatch an event without data', () => {
    const decoder = new ServerSentEventDecoder()
    const events = decoder.push(': keep-alive\nevent: ping\n\ndata: ok\n\n')

    expect(events).toEqual([{ event: 'message', data: 'ok', lastEventId: '' }])
  })

  it('treats a trailing CR at stream end as a line break', () => {
    const decoder = new ServerSentEventDecoder()

    expect(decoder.push('data: tail\n\r')).toEqual([])
    expect(decoder.end()).toEqual([{ event: 'message', data: 'tail', lastEventId: '' }])
  })

  it('drops an event that never received a terminating blank line', () => {
    const decoder = new ServerSentEventDecoder()

    expect(decoder.push('data: partial\n')).toEqual([])
    expect(decoder.end()).toEqual([])
  })
})

describe('readServerSentEvents', () => {
  it('decodes multi-byte characters split across byte chunks and strips the BOM', async () => {
    const bytes = new TextEncoder().encode('\uFEFFdata: 你好\n\n')
    // BOM 3 字节 + "data: " 6 字节，第二个汉字的 UTF-8 序列被切成两段
    const events = await collect(streamOf(bytes.slice(0, 10), bytes.slice(10)))

    expect(events).toEqual([{ event: 'message', data: '你好', lastEventId: '' }])
  })

  it('yields nothing for an aborted stream', async () => {
    const controller = new AbortController()
    const stream = new ReadableStream<Uint8Array>({
      pull() {
        return new Promise(() => {})
      },
    })
    const pending = collect(stream, controller.signal)
    controller.abort()

    await expect(pending).resolves.toEqual([])
  })
})
