import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GamePlugin } from '../types.js'

const mocks = vi.hoisted(() => {
  class MockApiError extends Error {
    kind: string

    constructor(kind: string, message: string) {
      super(message)
      this.kind = kind
    }
  }
  return {
    MockApiError,
    streamMessage: vi.fn(),
    settings: { gameCacheEnabled: true },
  }
})

vi.mock('../../services/api/client.js', () => ({
  ApiError: mocks.MockApiError,
  streamMessage: mocks.streamMessage,
}))

vi.mock('../../services/settings.js', () => ({
  useSettings: { getState: () => mocks.settings },
}))

import { requestAiMoveFromLlm } from '../llmPlayer.js'
import { clearGameDecisionCache } from '../history.js'

const storage = new Map<string, string>()

const installWindow = () => {
  vi.stubGlobal('window', {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value)
      },
      removeItem: (key: string) => {
        storage.delete(key)
      },
      clear: () => storage.clear(),
    },
  })
}

const validDecision = () => '{"move":"H8","thoughtSummary":"占据中路","speech":"该你了"}'

const mockDecisionStream = () => {
  mocks.streamMessage.mockImplementation(async function* () {
    yield {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: validDecision() },
    }
  })
}

type TestState = { version: number }

const createPlugin = (): GamePlugin<TestState, string> =>
  ({
    id: 'test-game',
    name: { 'zh-CN': '测试', 'en-US': 'Test' },
    subtitle: { 'zh-CN': '', 'en-US': '' },
    badge: { 'zh-CN': '', 'en-US': '' },
    firstTurn: 'player',
    createInitialState: () => ({ version: 0 }),
    getTurn: () => 'ai',
    getStatus: () => 'playing',
    canUndo: () => false,
    undoRound: (state: TestState) => state,
    applyPlayerMove: (state: TestState) => ({ nextState: { version: state.version + 1 } }),
    applyAiMove: (state: TestState) => ({ nextState: { version: state.version + 1 } }),
    buildAiPrompt: (state: TestState) => ({
      systemPrompt: '固定规则系统提示词',
      userPrompt: `当前状态 ${state.version}`,
      stablePrefix: state.version > 0 ? '对局记录：B:H8' : undefined,
    }),
    parseAndValidateAiMove: (_state: TestState, rawMove: unknown) => ({
      valid: true,
      move: String(rawMove),
    }),
    pickFallbackMove: () => 'H8',
    BoardComponent: () => null,
  }) as unknown as GamePlugin<TestState, string>

const defaultOpponent = {
  id: 'default',
  name: '测试对手',
  tagline: '',
  systemPrompt: '',
  greeting: '',
}

beforeEach(() => {
  storage.clear()
  installWindow()
  clearGameDecisionCache()
  mocks.settings.gameCacheEnabled = true
  mocks.streamMessage.mockReset()
  mockDecisionStream()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('requestAiMoveFromLlm cache', () => {
  it('reuses the cached decision for the same locale and prompt', async () => {
    const plugin = createPlugin()
    const common = {
      plugin,
      state: { version: 1 },
      opponent: defaultOpponent,
      apiKey: 'test-key',
      thinking: true,
      signal: new AbortController().signal,
    }

    const first = await requestAiMoveFromLlm({ ...common, locale: 'zh-CN' })
    const second = await requestAiMoveFromLlm({ ...common, locale: 'zh-CN' })

    expect(first.move).toBe('H8')
    expect(second.move).toBe('H8')
    expect(mocks.streamMessage).toHaveBeenCalledTimes(1)
  })

  it('does not reuse a zh-CN decision after switching to en-US', async () => {
    const plugin = createPlugin()
    const common = {
      plugin,
      state: { version: 1 },
      opponent: defaultOpponent,
      apiKey: 'test-key',
      thinking: true,
      signal: new AbortController().signal,
    }

    await requestAiMoveFromLlm({ ...common, locale: 'zh-CN' })
    await requestAiMoveFromLlm({ ...common, locale: 'en-US' })

    expect(mocks.streamMessage).toHaveBeenCalledTimes(2)
  })

  it('sends the stable prefix first and never forwards a shared game session id', async () => {
    const plugin = createPlugin()

    await requestAiMoveFromLlm({
      plugin,
      state: { version: 2 },
      opponent: defaultOpponent,
      apiKey: 'test-key',
      thinking: true,
      locale: 'zh-CN',
      signal: new AbortController().signal,
    })

    const call = mocks.streamMessage.mock.calls[0]
    expect(call).toHaveLength(3)
    const body = call?.[1] as { messages: Array<{ content: unknown }>; system: string }
    expect(body.messages[0]?.content).toContain('对局记录：B:H8')
    expect(body.system).toContain('200 字以内')
  })

  it('retries once on a transient network error', async () => {
    mocks.streamMessage
      .mockImplementationOnce(async function* () {
        yield { type: 'ping' }
        throw new mocks.MockApiError('network', 'offline')
      })
      .mockImplementationOnce(async function* () {
        yield {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: validDecision() },
        }
      })

    const decision = await requestAiMoveFromLlm({
      plugin: createPlugin(),
      state: { version: 1 },
      opponent: defaultOpponent,
      apiKey: 'test-key',
      thinking: true,
      locale: 'zh-CN',
      signal: new AbortController().signal,
    })

    expect(decision.move).toBe('H8')
    expect(mocks.streamMessage).toHaveBeenCalledTimes(2)
  })

  it('retries after an idle stall instead of failing the turn', async () => {
    vi.useFakeTimers()
    installWindow()

    let callCount = 0
    mocks.streamMessage.mockImplementation((...args: unknown[]) => {
      callCount += 1
      if (callCount === 1) {
        const signal = args[2] as AbortSignal
        return (async function* () {
          await new Promise((_, reject) => {
            signal.addEventListener(
              'abort',
              () => reject(new DOMException('Aborted', 'AbortError')),
              { once: true }
            )
          })
          yield { type: 'ping' }
        })()
      }
      return (async function* () {
        yield {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: validDecision() },
        }
      })()
    })

    const pending = requestAiMoveFromLlm({
      plugin: createPlugin(),
      state: { version: 1 },
      opponent: defaultOpponent,
      apiKey: 'test-key',
      thinking: true,
      locale: 'zh-CN',
      signal: new AbortController().signal,
      requestTimeoutMs: 8 * 60_000,
    })

    await vi.advanceTimersByTimeAsync(90_001)
    await vi.advanceTimersByTimeAsync(1_000)

    await expect(pending).resolves.toMatchObject({ move: 'H8' })
    expect(callCount).toBe(2)
  })
})
