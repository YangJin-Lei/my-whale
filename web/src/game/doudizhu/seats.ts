import { create } from 'zustand'
import { findPetById } from '../../pet/catalog.js'
import { type Locale, useSettings } from '../../services/settings.js'
import type { GameOpponent } from '../types.js'
import type { DoudizhuSeatId } from './types.js'

const STORAGE_KEY = 'mywhale_doudizhu_seats_v1'

export type AiSeatId = Exclude<DoudizhuSeatId, 'player'>

type DoudizhuSeatConfig = Record<AiSeatId, string>

const DEFAULT_SEATS: DoudizhuSeatConfig = {
  ai_left: 'jiyi',
  ai_right: 'usagi',
}

const loadSeats = (): DoudizhuSeatConfig => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return DEFAULT_SEATS
    }
    const parsed = JSON.parse(raw) as Partial<DoudizhuSeatConfig>
    return {
      ai_left: typeof parsed.ai_left === 'string' && parsed.ai_left ? parsed.ai_left : 'jiyi',
      ai_right: typeof parsed.ai_right === 'string' && parsed.ai_right ? parsed.ai_right : 'usagi',
    }
  } catch {
    return DEFAULT_SEATS
  }
}

export const useDoudizhuSeatStore = create<DoudizhuSeatConfig>(() => loadSeats())

export const setDoudizhuSeatPet = (seat: AiSeatId, petId: string) => {
  useDoudizhuSeatStore.setState((prev) => {
    const next = { ...prev, [seat]: petId }
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {
      // 忽略存储空间受限
    }
    return next
  })
}

export const resolveDoudizhuSeatOpponent = (seat: AiSeatId, locale: Locale): GameOpponent => {
  const configuredPetId = useDoudizhuSeatStore.getState()[seat]
  const fallbackId =
    seat === 'ai_right'
      ? useSettings.getState().activePetId || DEFAULT_SEATS.ai_right
      : DEFAULT_SEATS.ai_left
  const pet = findPetById(configuredPetId || fallbackId)
  const petName = pet.name[locale]
  const seatTag =
    locale === 'zh-CN' ? (seat === 'ai_right' ? '下家' : '上家') : seat === 'ai_right' ? 'R' : 'L'

  // 若两桌宠物默认音色相同，按左右席位分配女声/男声便于双人语音区分，后续可直接切换专属语音包
  const preferredVoice = pet.voicePack?.preferredVoice ?? (seat === 'ai_left' ? 'stella' : 'tide')

  return {
    id: `ddz:${seat}:${pet.id}`,
    name: petName,
    petSpriteUrl: pet.spriteUrl,
    petCols: pet.cols,
    petRows: pet.rows,
    preferredVoice,
    voicePack: pet.voicePack,
    tagline: seatTag,
    systemPrompt: pet.promptHint[locale],
    greeting:
      locale === 'zh-CN' ? `我是${petName}，准备发牌开局！` : `${petName} is ready at the table.`,
    customizable: true,
  }
}
