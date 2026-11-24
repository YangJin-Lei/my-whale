import { create } from 'zustand'
import { ensureApiKey } from '../components/settings/settingsDialogState.js'
import { classifyApiError } from '../services/api/errors.js'
import type { TtsVoice } from '../services/api/speech.js'
import { getActiveApiKey, type Locale, useSettings } from '../services/settings.js'
import { createId } from '../utils/id.js'
import {
  deleteGameHistoryRecord,
  formatGameScoreLabel,
  upsertGameHistoryRecord,
  useGameHistory,
} from './history.js'
import { requestAiMoveFromLlm } from './llmPlayer.js'
import { resolveCurrentOpponent } from './opponents.js'
import { findRegisteredGame, type RegisteredGame } from './registry.js'
import type { GameId, GameOpponent } from './types.js'
import { speakGameLine, stopGameVoice, unlockGameAudio } from './voiceCue.js'

type GameStoreState = {
  drawerOpen: boolean
  expanded: boolean
  activeGameId: GameId | null
  activeRecordId: string | null
  activeRecordCreatedAt: number | null
  gameState: unknown
  aiThinking: boolean
  thinkingMode: boolean
  gameVoiceOn: boolean
  bubbleText: string
  thoughtText: string
  lastSpeechText: string
  lastVoice?: TtsVoice
  turnSecondsLeft: number | null
  errorText: string | null
  moveEpoch: number
}

let turnController: AbortController | null = null
let turnTimerId: number | null = null
let chainTimerId: number | null = null

const clearTurnTimers = () => {
  if (turnTimerId !== null) {
    window.clearInterval(turnTimerId)
    turnTimerId = null
  }
  if (chainTimerId !== null) {
    window.clearTimeout(chainTimerId)
    chainTimerId = null
  }
}

const abortPendingAiTurn = () => {
  clearTurnTimers()
  if (turnController) {
    turnController.abort()
    turnController = null
  }
}

const getInitialVoicePref = (): boolean => {
  try {
    return useSettings.getState().voiceEnabled
  } catch {
    return false
  }
}

export const useGameStore = create<GameStoreState>(() => ({
  drawerOpen: false,
  expanded: false,
  activeGameId: null,
  activeRecordId: null,
  activeRecordCreatedAt: null,
  gameState: null,
  aiThinking: false,
  thinkingMode: true,
  gameVoiceOn: getInitialVoicePref(),
  bubbleText: '',
  thoughtText: '',
  lastSpeechText: '',
  lastVoice: undefined,
  turnSecondsLeft: null,
  errorText: null,
  moveEpoch: 0,
}))

const formatApiFailure = (error: unknown, locale: Locale): string => {
  const kind = classifyApiError(error)
  if (kind === 'unauthorized') {
    return locale === 'zh-CN'
      ? 'API Key 无效，请在设置中更换后重试'
      : 'Invalid API Key. Please update it in Settings.'
  }
  if (kind === 'insufficientBalance') {
    return locale === 'zh-CN'
      ? '账户余额不足，请充值后重试'
      : 'Insufficient balance. Please top up and retry.'
  }
  if (kind === 'rateLimited') {
    return locale === 'zh-CN' ? '请求过于频繁，请稍后再试' : 'Rate limited. Please retry shortly.'
  }
  if (error instanceof Error && error.message) {
    return error.message
  }
  return locale === 'zh-CN' ? '请求失败，请点击重试' : 'Request failed. Please retry.'
}

const resolveActiveOpponent = (
  plugin: RegisteredGame,
  state: unknown,
  locale: Locale
): GameOpponent => {
  const fallback = resolveCurrentOpponent(locale)
  return plugin.resolveActiveOpponent
    ? plugin.resolveActiveOpponent(state, fallback, locale)
    : fallback
}

const getResultBubble = (plugin: RegisteredGame, state: unknown, locale: Locale): string | null => {
  const status = plugin.getStatus(state)
  if (status === 'player_win') {
    return locale === 'zh-CN' ? '这手太漂亮了，甘拜下风！' : 'Well played—you got me this round!'
  }
  if (status === 'ai_win') {
    return locale === 'zh-CN' ? '承让了，这一局我先收下。' : 'Good game! I take this round.'
  }
  if (status === 'draw') {
    return locale === 'zh-CN' ? '棋逢对手，难分伯仲。' : 'A hard-fought draw!'
  }
  return null
}

const syncActiveHistoryRecord = (plugin: RegisteredGame) => {
  const {
    activeGameId,
    activeRecordId,
    activeRecordCreatedAt,
    gameState,
    bubbleText,
    thoughtText,
  } = useGameStore.getState()
  if (activeGameId !== plugin.id || !gameState || !activeRecordId) {
    return
  }
  const locale = useSettings.getState().locale
  const opponent = resolveActiveOpponent(plugin, gameState, locale)
  const status = plugin.getStatus(gameState)
  const now = Date.now()
  upsertGameHistoryRecord({
    id: activeRecordId,
    gameId: plugin.id,
    opponentId: opponent.id,
    opponentName: opponent.name,
    status,
    scoreLabel: formatGameScoreLabel(plugin.id, gameState, status, locale),
    state: gameState,
    bubbleText,
    thoughtText,
    createdAt: activeRecordCreatedAt ?? now,
    updatedAt: now,
  })
}

const startTurnCountdown = (plugin: RegisteredGame, expectedEpoch: number) => {
  if (turnTimerId !== null) {
    window.clearInterval(turnTimerId)
    turnTimerId = null
  }
  const limit = plugin.turnTimeoutSec
  if (!limit || limit <= 0) {
    useGameStore.setState({ turnSecondsLeft: null })
    return
  }

  useGameStore.setState({ turnSecondsLeft: limit })
  turnTimerId = window.setInterval(() => {
    const store = useGameStore.getState()
    if (
      store.moveEpoch !== expectedEpoch ||
      !store.drawerOpen ||
      store.activeGameId !== plugin.id ||
      !store.gameState ||
      plugin.getStatus(store.gameState) !== 'playing'
    ) {
      clearTurnTimers()
      return
    }
    const nextSec = (store.turnSecondsLeft ?? limit) - 1
    if (nextSec > 0) {
      useGameStore.setState({ turnSecondsLeft: nextSec })
      return
    }

    clearTurnTimers()
    const currentTurn = plugin.getTurn(store.gameState)
    const locale = useSettings.getState().locale
    const opponent = resolveActiveOpponent(plugin, store.gameState, locale)
    const timeoutOutcome = plugin.handleTimeout?.(store.gameState, currentTurn, locale)
    if (!timeoutOutcome) {
      return
    }

    if (turnController) {
      turnController.abort()
      turnController = null
    }

    const bumpedEpoch = expectedEpoch + 1
    const resultLine = getResultBubble(plugin, timeoutOutcome.nextState, locale)
    const speech = resultLine || timeoutOutcome.speech || ''
    useGameStore.setState({
      gameState: timeoutOutcome.nextState,
      aiThinking: false,
      turnSecondsLeft: null,
      errorText: null,
      bubbleText: speech || store.bubbleText,
      lastSpeechText: speech || store.lastSpeechText,
      lastVoice: opponent.preferredVoice,
      moveEpoch: bumpedEpoch,
    })
    syncActiveHistoryRecord(plugin)
    if (speech && useGameStore.getState().gameVoiceOn) {
      speakGameLine(speech, opponent.preferredVoice)
    }

    if (plugin.getStatus(timeoutOutcome.nextState) === 'playing') {
      const nextSide = plugin.getTurn(timeoutOutcome.nextState)
      if (nextSide === 'ai') {
        chainTimerId = window.setTimeout(() => {
          void triggerAiTurn(plugin, bumpedEpoch)
        }, 420)
      } else {
        startTurnCountdown(plugin, bumpedEpoch)
      }
    }
  }, 1000)
}

const triggerAiTurn = async (plugin: RegisteredGame, expectedEpoch: number) => {
  if (!ensureApiKey()) {
    const locale = useSettings.getState().locale
    useGameStore.setState({
      aiThinking: false,
      errorText:
        locale === 'zh-CN' ? '请先配置 DeepSeek API Key 才能对弈' : 'Configure API Key first',
    })
    return
  }

  abortPendingAiTurn()
  const controller = new AbortController()
  turnController = controller

  const { locale } = useSettings.getState()
  const apiKey = getActiveApiKey()
  const { gameState, thinkingMode } = useGameStore.getState()
  if (!gameState) {
    return
  }
  const opponent = resolveActiveOpponent(plugin, gameState, locale)

  useGameStore.setState({
    aiThinking: true,
    errorText: null,
    bubbleText: locale === 'zh-CN' ? '正在思考这一步…' : 'Thinking through my move…',
    thoughtText: '',
  })
  startTurnCountdown(plugin, expectedEpoch)

  try {
    const requestTimeoutMs = plugin.turnTimeoutSec
      ? Math.max(12_000, (plugin.turnTimeoutSec - 2) * 1000)
      : undefined
    const decision = await requestAiMoveFromLlm({
      plugin,
      state: gameState,
      opponent,
      apiKey,
      thinking: thinkingMode,
      locale,
      signal: controller.signal,
      requestTimeoutMs,
      onThinkingUpdate: (snippet) => {
        const current = useGameStore.getState()
        if (current.moveEpoch === expectedEpoch && current.aiThinking) {
          useGameStore.setState({ thoughtText: snippet })
        }
      },
      onStateUpdate: (nextState) => {
        const current = useGameStore.getState()
        if (current.moveEpoch === expectedEpoch && current.aiThinking) {
          useGameStore.setState({ gameState: nextState })
        }
      },
    })

    if (controller.signal.aborted || useGameStore.getState().moveEpoch !== expectedEpoch) {
      return
    }

    clearTurnTimers()
    const latest = useGameStore.getState()
    const applied = plugin.applyAiMove(latest.gameState, decision.move, decision.speech, locale)
    const resultBubble = getResultBubble(plugin, applied.nextState, locale)
    const spokenLine = resultBubble || decision.speech
    const combinedThought = decision.thinkingTrace
      ? `${decision.thoughtSummary}\n\n${decision.thinkingTrace}`
      : decision.thoughtSummary

    const nextEpoch = expectedEpoch + 1
    useGameStore.setState({
      gameState: applied.nextState,
      aiThinking: false,
      bubbleText: spokenLine,
      thoughtText: combinedThought,
      lastSpeechText: spokenLine,
      lastVoice: opponent.preferredVoice,
      turnSecondsLeft: null,
      errorText: null,
      moveEpoch: nextEpoch,
    })
    syncActiveHistoryRecord(plugin)

    if (useGameStore.getState().gameVoiceOn) {
      speakGameLine(spokenLine, opponent.preferredVoice)
    }

    if (plugin.getStatus(applied.nextState) === 'playing') {
      const nextTurn = plugin.getTurn(applied.nextState)
      if (nextTurn === 'ai') {
        chainTimerId = window.setTimeout(() => {
          void triggerAiTurn(plugin, nextEpoch)
        }, 450)
      } else {
        startTurnCountdown(plugin, nextEpoch)
      }
    }
  } catch (error) {
    if (controller.signal.aborted || useGameStore.getState().moveEpoch !== expectedEpoch) {
      return
    }
    clearTurnTimers()
    const current = useGameStore.getState()
    if (error instanceof DOMException && error.name === 'AbortError' && current.gameState) {
      const timeoutOutcome = plugin.handleTimeout?.(current.gameState, 'ai', locale)
      if (timeoutOutcome) {
        const nextEpoch = expectedEpoch + 1
        const speech = timeoutOutcome.speech ?? ''
        useGameStore.setState({
          gameState: timeoutOutcome.nextState,
          aiThinking: false,
          bubbleText: speech || current.bubbleText,
          lastSpeechText: speech || current.lastSpeechText,
          turnSecondsLeft: null,
          errorText: null,
          moveEpoch: nextEpoch,
        })
        syncActiveHistoryRecord(plugin)
        if (plugin.getStatus(timeoutOutcome.nextState) === 'playing') {
          if (plugin.getTurn(timeoutOutcome.nextState) === 'ai') {
            chainTimerId = window.setTimeout(() => {
              void triggerAiTurn(plugin, nextEpoch)
            }, 420)
          } else {
            startTurnCountdown(plugin, nextEpoch)
          }
        }
        return
      }
    }

    useGameStore.setState({
      aiThinking: false,
      turnSecondsLeft: null,
      errorText: formatApiFailure(error, locale),
      bubbleText:
        locale === 'zh-CN' ? '刚刚思绪断了一下，点重试让我继续。' : 'Lost focus—tap retry.',
    })
  } finally {
    if (turnController === controller) {
      turnController = null
    }
  }
}

export const openGameDrawer = () => {
  useGameStore.setState({ drawerOpen: true })
}

export const toggleGameExpanded = () => {
  useGameStore.setState((prev) => ({ expanded: !prev.expanded }))
}

export const updateGameFeedback = (patch: {
  aiThinking?: boolean
  bubbleText?: string
  thoughtText?: string
  errorText?: string | null
  speechToSpeak?: string
}) => {
  const { speechToSpeak, ...rest } = patch
  useGameStore.setState({
    ...rest,
    ...(speechToSpeak ? { lastSpeechText: speechToSpeak } : {}),
  })
  if (speechToSpeak && useGameStore.getState().gameVoiceOn) {
    const locale = useSettings.getState().locale
    const opponent = resolveCurrentOpponent(locale)
    speakGameLine(speechToSpeak, opponent.preferredVoice)
  }
}

export const closeGameDrawer = () => {
  abortPendingAiTurn()
  stopGameVoice()
  useGameStore.setState((prev) => ({
    drawerOpen: false,
    aiThinking: false,
    turnSecondsLeft: null,
    moveEpoch: prev.moveEpoch + 1,
  }))
}

export const backToGamePicker = () => {
  abortPendingAiTurn()
  stopGameVoice()
  useGameStore.setState((prev) => ({
    activeGameId: null,
    activeRecordId: null,
    activeRecordCreatedAt: null,
    gameState: null,
    aiThinking: false,
    errorText: null,
    bubbleText: '',
    thoughtText: '',
    lastSpeechText: '',
    lastVoice: undefined,
    turnSecondsLeft: null,
    moveEpoch: prev.moveEpoch + 1,
  }))
}

export const startGame = (gameId: GameId) => {
  const plugin = findRegisteredGame(gameId)
  if (!plugin) {
    return
  }
  abortPendingAiTurn()
  stopGameVoice()
  const locale = useSettings.getState().locale
  const opponent = resolveCurrentOpponent(locale)
  const initialState = plugin.createInitialState()
  const nextEpoch = useGameStore.getState().moveEpoch + 1

  useGameStore.setState({
    drawerOpen: true,
    activeGameId: plugin.id,
    activeRecordId: createId(),
    activeRecordCreatedAt: Date.now(),
    gameState: initialState,
    aiThinking: false,
    errorText: null,
    bubbleText: opponent.greeting,
    thoughtText: '',
    lastSpeechText: opponent.greeting,
    lastVoice: opponent.preferredVoice,
    turnSecondsLeft: plugin.turnTimeoutSec ?? null,
    moveEpoch: nextEpoch,
  })

  if (plugin.getTurn(initialState) === 'ai') {
    void triggerAiTurn(plugin, nextEpoch)
  } else {
    startTurnCountdown(plugin, nextEpoch)
  }
}

export const resumeGameRecord = (recordId: string) => {
  const record = useGameHistory.getState().records.find((item) => item.id === recordId)
  if (!record) {
    return
  }
  const plugin = findRegisteredGame(record.gameId)
  if (!plugin) {
    return
  }
  abortPendingAiTurn()
  stopGameVoice()
  const locale = useSettings.getState().locale
  const opponent = resolveActiveOpponent(plugin, record.state, locale)
  const nextEpoch = useGameStore.getState().moveEpoch + 1

  useGameStore.setState({
    drawerOpen: true,
    activeGameId: plugin.id,
    activeRecordId: record.id,
    activeRecordCreatedAt: record.createdAt,
    gameState: record.state,
    aiThinking: false,
    errorText: null,
    bubbleText: record.bubbleText || opponent.greeting,
    thoughtText: record.thoughtText || '',
    lastSpeechText: record.bubbleText || opponent.greeting,
    lastVoice: opponent.preferredVoice,
    turnSecondsLeft: plugin.turnTimeoutSec ?? null,
    moveEpoch: nextEpoch,
  })

  if (plugin.getStatus(record.state) === 'playing') {
    if (plugin.getTurn(record.state) === 'ai') {
      void triggerAiTurn(plugin, nextEpoch)
    } else {
      startTurnCountdown(plugin, nextEpoch)
    }
  }
}

export const removeGameRecord = (recordId: string) => {
  deleteGameHistoryRecord(recordId)
  if (useGameStore.getState().activeRecordId === recordId) {
    useGameStore.setState({ activeRecordId: createId(), activeRecordCreatedAt: Date.now() })
  }
}

export const restartCurrentGame = () => {
  const { activeGameId } = useGameStore.getState()
  if (activeGameId) {
    startGame(activeGameId)
  }
}

export const undoGameRound = () => {
  const { activeGameId, gameState } = useGameStore.getState()
  const plugin = findRegisteredGame(activeGameId)
  if (!plugin || !gameState) {
    return
  }
  abortPendingAiTurn()
  stopGameVoice()
  const locale = useSettings.getState().locale
  const nextState = plugin.undoRound(gameState)
  const nextEpoch = useGameStore.getState().moveEpoch + 1
  useGameStore.setState({
    gameState: nextState,
    aiThinking: false,
    errorText: null,
    bubbleText: locale === 'zh-CN' ? '好，让你悔这一步，重新走吧。' : 'Alright, undo accepted.',
    thoughtText: '',
    moveEpoch: nextEpoch,
  })
  syncActiveHistoryRecord(plugin)
  startTurnCountdown(plugin, nextEpoch)
}

export const toggleGameThinkingMode = () => {
  useGameStore.setState((prev) => ({ thinkingMode: !prev.thinkingMode }))
}

export const toggleGameVoice = () => {
  unlockGameAudio()
  const next = !useGameStore.getState().gameVoiceOn
  if (!next) {
    stopGameVoice()
  }
  useGameStore.setState({ gameVoiceOn: next })
}

export const replayOpponentSpeech = () => {
  unlockGameAudio()
  const { lastSpeechText, bubbleText, lastVoice } = useGameStore.getState()
  const text = lastSpeechText || bubbleText
  if (text) {
    speakGameLine(text, lastVoice)
  }
}

export const submitPlayerGameMove = (move: unknown) => {
  unlockGameAudio()
  const state = useGameStore.getState()
  const plugin = findRegisteredGame(state.activeGameId)
  if (!plugin || !state.gameState || state.aiThinking) {
    return
  }
  const locale = useSettings.getState().locale
  const result = plugin.applyPlayerMove(state.gameState, move, locale)
  if ('error' in result) {
    useGameStore.setState({ errorText: result.error })
    return
  }

  clearTurnTimers()
  const nextEpoch = state.moveEpoch + 1
  const status = plugin.getStatus(result.nextState)
  const opponent = resolveActiveOpponent(plugin, result.nextState, locale)

  if (status !== 'playing') {
    const endBubble =
      getResultBubble(plugin, result.nextState, locale) ??
      (locale === 'zh-CN' ? '对局结束。' : 'Match ended.')
    useGameStore.setState({
      gameState: result.nextState,
      aiThinking: false,
      errorText: null,
      bubbleText: endBubble,
      lastSpeechText: endBubble,
      lastVoice: opponent.preferredVoice,
      turnSecondsLeft: null,
      moveEpoch: nextEpoch,
    })
    syncActiveHistoryRecord(plugin)
    if (state.gameVoiceOn) {
      speakGameLine(endBubble, opponent.preferredVoice)
    }
    return
  }

  useGameStore.setState({
    gameState: result.nextState,
    errorText: null,
    turnSecondsLeft: plugin.turnTimeoutSec ?? null,
    moveEpoch: nextEpoch,
  })
  syncActiveHistoryRecord(plugin)

  if (plugin.getTurn(result.nextState) === 'ai') {
    void triggerAiTurn(plugin, nextEpoch)
  } else {
    startTurnCountdown(plugin, nextEpoch)
  }
}

export const retryAiTurn = () => {
  unlockGameAudio()
  const state = useGameStore.getState()
  const plugin = findRegisteredGame(state.activeGameId)
  if (!plugin || !state.gameState || state.aiThinking) {
    return
  }
  if (plugin.getStatus(state.gameState) !== 'playing' || plugin.getTurn(state.gameState) !== 'ai') {
    return
  }
  const nextEpoch = state.moveEpoch + 1
  useGameStore.setState({ moveEpoch: nextEpoch })
  void triggerAiTurn(plugin, nextEpoch)
}

/**
 * 熄屏或切后台后，Android WebView 可能挂起网络请求并让本轮失败。
 * 回到前台且仍轮到 AI 时自动续上，避免用户手动点重试。
 */
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') {
      return
    }
    const state = useGameStore.getState()
    const plugin = findRegisteredGame(state.activeGameId)
    if (!plugin || !state.gameState || state.aiThinking || !state.errorText) {
      return
    }
    if (
      plugin.getStatus(state.gameState) === 'playing' &&
      plugin.getTurn(state.gameState) === 'ai'
    ) {
      retryAiTurn()
    }
  })
}
