import { create } from 'zustand'
import { ensureApiKey } from '../components/settings/settingsDialogState.js'
import { streamMessage } from '../services/api/client.js'
import type { MessageParam } from '../services/api/types.js'
import { useChatStore } from '../services/chat/store.js'
import { findPersona, usePersonaStore } from '../services/persona/store.js'
import { useSettings } from '../services/settings.js'
import { findPetById } from './catalog.js'
import type { NaiwaMood } from './NaiwaSprite.js'
import { speakPetLine, stopPetVoice, unlockPetAudio } from './petVoice.js'

type PetTurn = {
  role: 'user' | 'assistant'
  text: string
}

type PetStoreState = {
  panelOpen: boolean
  mood: NaiwaMood
  replyText: string
  streaming: boolean
  voiceReplyOn: boolean
  errorText: string | null
  turns: PetTurn[]
}

let activeController: AbortController | null = null
let moodResetTimer: number | null = null

const clearMoodReset = () => {
  if (moodResetTimer !== null) {
    window.clearTimeout(moodResetTimer)
    moodResetTimer = null
  }
}

export const usePetStore = create<PetStoreState>(() => ({
  panelOpen: false,
  mood: 'wave',
  replyText: '',
  streaming: false,
  voiceReplyOn: true,
  errorText: null,
  turns: [],
}))

export const setPetMood = (mood: NaiwaMood) => {
  clearMoodReset()
  usePetStore.setState({ mood })
}

export const togglePetPanel = () => {
  clearMoodReset()
  const next = !usePetStore.getState().panelOpen
  usePetStore.setState((prev) => ({
    panelOpen: next,
    mood: prev.streaming ? prev.mood : next ? 'wait' : 'idle',
  }))
}

export const closePetPanel = () => {
  clearMoodReset()
  usePetStore.setState((prev) => ({
    panelOpen: false,
    mood: prev.streaming ? prev.mood : 'idle',
  }))
}

export const togglePetVoice = () => {
  unlockPetAudio()
  const next = !usePetStore.getState().voiceReplyOn
  if (!next) {
    stopPetVoice()
  }
  usePetStore.setState({ voiceReplyOn: next })
}

export const replayPetReply = () => {
  unlockPetAudio()
  const text = usePetStore.getState().replyText
  if (text) {
    speakPetLine(text)
  }
}

export const stopPetSession = () => {
  clearMoodReset()
  if (activeController) {
    activeController.abort()
    activeController = null
  }
  stopPetVoice()
  usePetStore.setState({ streaming: false, mood: 'idle' })
}

const resolvePetSystemPrompt = (): string => {
  const { locale, profile, activePetId } = useSettings.getState()
  const pet = findPetById(activePetId)
  const chatState = useChatStore.getState()
  const customPersonas = usePersonaStore.getState().personas
  const activeSession =
    chatState.activeId !== null ? chatState.sessionCache[chatState.activeId] : undefined
  const snapshot = activeSession?.persona?.snapshot
  const persona = snapshot
    ? { name: snapshot.name, instructions: snapshot.instructions }
    : findPersona(chatState.draftPersonaId, customPersonas, locale)

  const parts =
    locale === 'zh-CN'
      ? [
          `${pet.promptHint['zh-CN']}（当前关联助手：${persona.name}）`,
          persona.instructions?.trim() || '',
          profile.trim() ? `用户信息：${profile.trim()}` : '',
          '请像随时在桌面陪伴的轻量助手一样直接、口语化、简明作答（通常 1~3 句即可，除非用户问复杂问题），不输出冗长排版和 Emoji。',
        ]
      : [
          `${pet.promptHint['en-US']} (linked assistant: ${persona.name})`,
          persona.instructions?.trim() || '',
          profile.trim() ? `User profile: ${profile.trim()}` : '',
          'Reply naturally, concisely, and conversationally in 1-3 short sentences unless more detail is needed.',
        ]

  return parts.filter(Boolean).join('\n\n')
}

export const sendPetQuery = async (rawText: string, forceSpeak = false): Promise<void> => {
  const query = rawText.trim()
  if (!query) {
    return
  }
  if (!ensureApiKey()) {
    return
  }

  unlockPetAudio()
  clearMoodReset()
  if (activeController) {
    activeController.abort()
  }

  const controller = new AbortController()
  activeController = controller
  const prevTurns = usePetStore.getState().turns.slice(-6)
  const { apiKey, locale } = useSettings.getState()

  usePetStore.setState({
    panelOpen: true,
    streaming: true,
    mood: 'think',
    replyText: '',
    errorText: null,
    turns: [...prevTurns, { role: 'user', text: query }],
  })

  const messages: MessageParam[] = [
    ...prevTurns.map(
      (turn): MessageParam =>
        turn.role === 'user'
          ? { role: 'user', content: turn.text }
          : { role: 'assistant', content: [{ type: 'text', text: turn.text }] }
    ),
    { role: 'user', content: query },
  ]

  let accumulated = ''

  try {
    const events = streamMessage(
      apiKey ?? '',
      {
        model: 'deepseek-flash',
        system: resolvePetSystemPrompt(),
        messages,
        thinking: { type: 'disabled' },
        safety_check: { level: 'high' },
      },
      controller.signal
    )

    for await (const event of events) {
      if (controller.signal.aborted) {
        return
      }
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        accumulated += event.delta.text
        usePetStore.setState({
          replyText: accumulated,
          mood: 'speak',
        })
      }
    }

    const finalText = accumulated.trim()
    usePetStore.setState((prev) => ({
      streaming: false,
      replyText: finalText,
      mood: 'laugh',
      turns: finalText
        ? [...prev.turns, { role: 'assistant' as const, text: finalText }].slice(-8)
        : prev.turns,
    }))

    if (finalText && (usePetStore.getState().voiceReplyOn || forceSpeak)) {
      speakPetLine(finalText)
    }

    moodResetTimer = window.setTimeout(() => {
      usePetStore.setState((prev) =>
        prev.streaming ? prev : { mood: prev.panelOpen ? 'wait' : 'idle' }
      )
    }, 2600)
  } catch {
    if (controller.signal.aborted) {
      return
    }
    usePetStore.setState({
      streaming: false,
      mood: 'sad',
      errorText: locale === 'zh-CN' ? '请稍后重试' : 'Retry later',
    })
  } finally {
    if (activeController === controller) {
      activeController = null
    }
  }
}
