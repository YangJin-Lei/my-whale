import { create } from 'zustand'
import { classifyApiError } from '../services/api/errors.js'
import { type Locale, useSettings } from '../services/settings.js'
import { ensureApiKey } from '../components/settings/settingsDialogState.js'
import { requestAiMoveFromLlm } from './llmPlayer.js'
import { resolveCurrentOpponent } from './opponents.js'
import { findRegisteredGame, type RegisteredGame } from './registry.js'
import type { GameId } from './types.js'
import { speakGameLine, stopGameVoice, unlockGameAudio } from './voiceCue.js'

type GameStoreState = {
  drawerOpen: boolean
  activeGameId: GameId | null
  gameState: unknown
  aiThinking: boolean
  thinkingMode: boolean
  gameVoiceOn: boolean
  bubbleText: string
  thoughtText: string
  lastSpeechText: string
  errorText: string | null
  moveEpoch: number
}

let turnController: AbortController | null = null

const abortPendingAiTurn = () => {
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
  activeGameId: null,
  gameState: null,
  aiThinking: false,
  thinkingMode: true,
  gameVoiceOn: getInitialVoicePref(),
  bubbleText: '',
  thoughtText: '',
  lastSpeechText: '',
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

  const { apiKey, locale } = useSettings.getState()
  const { gameState, thinkingMode } = useGameStore.getState()
  const opponent = resolveCurrentOpponent(locale)

  useGameStore.setState({
    aiThinking: true,
    errorText: null,
    bubbleText: locale === 'zh-CN' ? '正在思考这一步…' : 'Thinking through my move…',
    thoughtText: '',
  })

  try {
    const decision = await requestAiMoveFromLlm({
      plugin,
      state: gameState,
      opponent,
      apiKey: apiKey ?? '',
      thinking: thinkingMode,
      locale,
      signal: controller.signal,
      onThinkingUpdate: (snippet) => {
        const current = useGameStore.getState()
        if (current.moveEpoch === expectedEpoch && current.aiThinking) {
          useGameStore.setState({ thoughtText: snippet })
        }
      },
    })

    if (controller.signal.aborted || useGameStore.getState().moveEpoch !== expectedEpoch) {
      return
    }

    const latest = useGameStore.getState()
    const applied = plugin.applyAiMove(latest.gameState, decision.move)
    const resultBubble = getResultBubble(plugin, applied.nextState, locale)
    const spokenLine = resultBubble || decision.speech
    const combinedThought = decision.thinkingTrace
      ? `${decision.thoughtSummary}\n\n${decision.thinkingTrace}`
      : decision.thoughtSummary

    useGameStore.setState({
      gameState: applied.nextState,
      aiThinking: false,
      bubbleText: spokenLine,
      thoughtText: combinedThought,
      lastSpeechText: spokenLine,
      errorText: null,
    })

    if (useGameStore.getState().gameVoiceOn) {
      speakGameLine(spokenLine)
    }
  } catch (error) {
    if (controller.signal.aborted || useGameStore.getState().moveEpoch !== expectedEpoch) {
      return
    }
    useGameStore.setState({
      aiThinking: false,
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

export const closeGameDrawer = () => {
  abortPendingAiTurn()
  stopGameVoice()
  useGameStore.setState((prev) => ({
    drawerOpen: false,
    aiThinking: false,
    moveEpoch: prev.moveEpoch + 1,
  }))
}

export const backToGamePicker = () => {
  abortPendingAiTurn()
  stopGameVoice()
  useGameStore.setState((prev) => ({
    activeGameId: null,
    gameState: null,
    aiThinking: false,
    errorText: null,
    bubbleText: '',
    thoughtText: '',
    lastSpeechText: '',
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

  useGameStore.setState((prev) => ({
    drawerOpen: true,
    activeGameId: plugin.id,
    gameState: initialState,
    aiThinking: false,
    errorText: null,
    bubbleText: opponent.greeting,
    thoughtText: '',
    lastSpeechText: opponent.greeting,
    moveEpoch: prev.moveEpoch + 1,
  }))
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
  useGameStore.setState((prev) => ({
    gameState: nextState,
    aiThinking: false,
    errorText: null,
    bubbleText: locale === 'zh-CN' ? '好，让你悔这一步，重新走吧。' : 'Alright, undo accepted.',
    thoughtText: '',
    moveEpoch: prev.moveEpoch + 1,
  }))
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
  const { lastSpeechText, bubbleText } = useGameStore.getState()
  const text = lastSpeechText || bubbleText
  if (text) {
    speakGameLine(text)
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

  const nextEpoch = state.moveEpoch + 1
  const status = plugin.getStatus(result.nextState)

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
      moveEpoch: nextEpoch,
    })
    if (state.gameVoiceOn) {
      speakGameLine(endBubble)
    }
    return
  }

  useGameStore.setState({
    gameState: result.nextState,
    errorText: null,
    moveEpoch: nextEpoch,
  })
  void triggerAiTurn(plugin, nextEpoch)
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
