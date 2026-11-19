import { create } from 'zustand'
import { findPetById } from '../pet/catalog.js'
import { useChatStore } from '../services/chat/store.js'
import { findPersona, usePersonaStore } from '../services/persona/store.js'
import { type Locale, useSettings } from '../services/settings.js'
import type { GameOpponent } from './types.js'

const CUSTOM_OPPONENT_STORAGE_KEY = 'mywhale_game_custom_opponent_v1'

export const PET_OPPONENT_ID = 'active-pet-opponent'
export const DEFAULT_OPPONENT_ID = 'whale-logo-default'
export const ACTIVE_PERSONA_OPPONENT_ID = 'active-chat-persona'
export const CUSTOM_OPPONENT_ID = 'user-custom-opponent'

export type OpponentPresetChoice =
  | typeof PET_OPPONENT_ID
  | typeof DEFAULT_OPPONENT_ID
  | typeof ACTIVE_PERSONA_OPPONENT_ID
  | typeof CUSTOM_OPPONENT_ID

export type CustomOpponentDraft = {
  name: string
  tagline: string
  systemPrompt: string
  greeting: string
}

type StoredOpponentConfig = {
  selectedChoice: OpponentPresetChoice
  custom: CustomOpponentDraft
}

const DEFAULT_CUSTOM_ZH: CustomOpponentDraft = {
  name: '棋馆陪练师',
  tagline: '自定义角色',
  systemPrompt: '你是一位棋风犀利、爱复盘点拨的棋馆高手，每一步都言简意赅、有棋感。',
  greeting: '手谈一局吧，你先落子，让我看看你的路数。',
}

const DEFAULT_CUSTOM_EN: CustomOpponentDraft = {
  name: 'Club Coach',
  tagline: 'Custom Opponent',
  systemPrompt:
    'You are a sharp board-game coach who reads shapes quickly and drops concise tactical remarks.',
  greeting: 'Let us play a clean match. Your move first.',
}

const loadStoredConfig = (): StoredOpponentConfig => {
  try {
    const raw = window.localStorage.getItem(CUSTOM_OPPONENT_STORAGE_KEY)
    if (!raw) {
      return {
        selectedChoice: PET_OPPONENT_ID,
        custom: DEFAULT_CUSTOM_ZH,
      }
    }
    const parsed = JSON.parse(raw) as Partial<StoredOpponentConfig>
    const choice: OpponentPresetChoice =
      parsed.selectedChoice === DEFAULT_OPPONENT_ID ||
      parsed.selectedChoice === ACTIVE_PERSONA_OPPONENT_ID ||
      parsed.selectedChoice === CUSTOM_OPPONENT_ID
        ? parsed.selectedChoice
        : PET_OPPONENT_ID
    const custom: CustomOpponentDraft = {
      name: typeof parsed.custom?.name === 'string' ? parsed.custom.name : DEFAULT_CUSTOM_ZH.name,
      tagline:
        typeof parsed.custom?.tagline === 'string'
          ? parsed.custom.tagline
          : DEFAULT_CUSTOM_ZH.tagline,
      systemPrompt:
        typeof parsed.custom?.systemPrompt === 'string'
          ? parsed.custom.systemPrompt
          : DEFAULT_CUSTOM_ZH.systemPrompt,
      greeting:
        typeof parsed.custom?.greeting === 'string'
          ? parsed.custom.greeting
          : DEFAULT_CUSTOM_ZH.greeting,
    }
    return { selectedChoice: choice, custom }
  } catch {
    return {
      selectedChoice: PET_OPPONENT_ID,
      custom: DEFAULT_CUSTOM_ZH,
    }
  }
}

const persistConfig = (config: StoredOpponentConfig) => {
  try {
    window.localStorage.setItem(CUSTOM_OPPONENT_STORAGE_KEY, JSON.stringify(config))
  } catch {
    // 存储空间受限时忽略持久化错误
  }
}

const initial = loadStoredConfig()

export const useGameOpponentStore = create<StoredOpponentConfig>(() => initial)

export const setGameOpponentChoice = (selectedChoice: OpponentPresetChoice) => {
  useGameOpponentStore.setState((prev) => {
    const next = { ...prev, selectedChoice }
    persistConfig(next)
    return next
  })
}

export const saveCustomGameOpponent = (draft: CustomOpponentDraft, locale: Locale) => {
  const fallback = locale === 'zh-CN' ? DEFAULT_CUSTOM_ZH : DEFAULT_CUSTOM_EN
  const cleaned: CustomOpponentDraft = {
    name: draft.name.trim() || fallback.name,
    tagline: draft.tagline.trim() || fallback.tagline,
    systemPrompt: draft.systemPrompt.trim() || fallback.systemPrompt,
    greeting: draft.greeting.trim() || fallback.greeting,
  }
  useGameOpponentStore.setState(() => {
    const next: StoredOpponentConfig = {
      selectedChoice: CUSTOM_OPPONENT_ID,
      custom: cleaned,
    }
    persistConfig(next)
    return next
  })
}

/**
 * 解析当前坐在棋盘对面的 AI 对手：
 * - 默认使用应用 Logo（「my-whale 对弈官」）
 * - 支持一键同步当前聊天的 AI 人设
 * - 支持用户/开发者自定义角色配置
 */
export const resolveCurrentOpponent = (locale: Locale): GameOpponent => {
  const { selectedChoice, custom } = useGameOpponentStore.getState()
  const activePet = findPetById(useSettings.getState().activePetId)

  if (selectedChoice === PET_OPPONENT_ID) {
    const petName = activePet.name[locale]
    return {
      id: `pet:${activePet.id}`,
      name: petName,
      petSpriteUrl: activePet.spriteUrl,
      petCols: activePet.cols,
      petRows: activePet.rows,
      preferredVoice: activePet.voicePack?.preferredVoice,
      voicePack: activePet.voicePack,
      tagline: locale === 'zh-CN' ? '桌宠' : 'Pet',
      systemPrompt: activePet.promptHint[locale],
      greeting:
        locale === 'zh-CN'
          ? `我是${petName}，来跟我下一局吧！`
          : `I'm ${petName}. Let's play a round!`,
      customizable: true,
    }
  }

  if (selectedChoice === ACTIVE_PERSONA_OPPONENT_ID) {
    const chatState = useChatStore.getState()
    const customPersonas = usePersonaStore.getState().personas
    const activeSession =
      chatState.activeId !== null ? chatState.sessionCache[chatState.activeId] : undefined
    const snapshot = activeSession?.persona?.snapshot
    if (snapshot) {
      return {
        id: `session:${activeSession?.persona?.personaId ?? snapshot.name}`,
        name: snapshot.name,
        avatar: snapshot.avatar,
        useAppLogo: !snapshot.avatar,
        tagline: locale === 'zh-CN' ? '当前会话人设' : 'Active Persona',
        systemPrompt: snapshot.instructions || snapshot.name,
        greeting:
          locale === 'zh-CN'
            ? `我是${snapshot.name}，来下这一局吧。`
            : `I am ${snapshot.name}. Ready for a match?`,
        customizable: true,
      }
    }
    const draftPersona = findPersona(chatState.draftPersonaId, customPersonas, locale)
    return {
      id: `draft:${draftPersona.id}`,
      name: draftPersona.name,
      avatar: draftPersona.avatar,
      useAppLogo: !draftPersona.avatar,
      tagline:
        draftPersona.description || (locale === 'zh-CN' ? '当前选中人设' : 'Selected Persona'),
      systemPrompt: draftPersona.instructions || draftPersona.description,
      greeting:
        draftPersona.greeting ||
        (locale === 'zh-CN'
          ? `我是${draftPersona.name}，请先手。`
          : `I am ${draftPersona.name}. Your move first.`),
      customizable: true,
    }
  }

  if (selectedChoice === CUSTOM_OPPONENT_ID) {
    return {
      id: CUSTOM_OPPONENT_ID,
      name: custom.name,
      useAppLogo: true,
      tagline: custom.tagline,
      systemPrompt: custom.systemPrompt,
      greeting: custom.greeting,
      customizable: true,
    }
  }

  if (locale === 'zh-CN') {
    return {
      id: DEFAULT_OPPONENT_ID,
      name: 'my-whale',
      useAppLogo: true,
      tagline: '桌面棋伴',
      systemPrompt:
        '你是坐在棋盘对面的 my-whale AI 棋手，性格沉稳机敏，偶尔会简短点评棋形、节奏或调侃一句，但始终专注认真下棋。',
      greeting: '棋盘已铺好，你先落子，我在对面看着。',
      customizable: true,
    }
  }

  return {
    id: DEFAULT_OPPONENT_ID,
    name: 'my-whale',
    useAppLogo: true,
    tagline: 'Board Companion',
    systemPrompt:
      'You are my-whale sitting across the game board—calm, perceptive, and competitive, giving crisp natural commentary while playing seriously.',
    greeting: 'Board is ready. Make your opening move.',
    customizable: true,
  }
}

export const getCurrentLocale = (): Locale => useSettings.getState().locale
