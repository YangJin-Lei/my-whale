import { create } from 'zustand'
import { findPetById } from '../../pet/catalog.js'
import { type Locale, useSettings } from '../../services/settings.js'
import type { GameOpponent } from '../types.js'
import type { MahjongSeatId } from './types.js'

const STORAGE_KEY = 'mywhale_mahjong_seats_v1'

export type MahjongAiSeatId = Exclude<MahjongSeatId, 'player'>

type MahjongSeatConfig = Record<MahjongAiSeatId, string>

const DEFAULT_SEATS: MahjongSeatConfig = {
  ai_right: 'usagi',
  ai_across: 'nailong',
  ai_left: 'jiyi',
}

const loadSeats = (): MahjongSeatConfig => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return DEFAULT_SEATS
    }
    const parsed = JSON.parse(raw) as Partial<MahjongSeatConfig>
    return {
      ai_right:
        typeof parsed.ai_right === 'string' && parsed.ai_right
          ? parsed.ai_right
          : DEFAULT_SEATS.ai_right,
      ai_across:
        typeof parsed.ai_across === 'string' && parsed.ai_across
          ? parsed.ai_across
          : DEFAULT_SEATS.ai_across,
      ai_left:
        typeof parsed.ai_left === 'string' && parsed.ai_left
          ? parsed.ai_left
          : DEFAULT_SEATS.ai_left,
    }
  } catch {
    return DEFAULT_SEATS
  }
}

export const useMahjongSeatStore = create<MahjongSeatConfig>(() => loadSeats())

export const setMahjongSeatPet = (seat: MahjongAiSeatId, petId: string) => {
  useMahjongSeatStore.setState((prev) => {
    const next = { ...prev, [seat]: petId }
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {
      // 存储受限时忽略写入错误
    }
    return next
  })
}

export const resolveMahjongSeatOpponent = (seat: MahjongAiSeatId, locale: Locale): GameOpponent => {
  const configuredPetId = useMahjongSeatStore.getState()[seat]
  const fallbackId =
    seat === 'ai_right'
      ? useSettings.getState().activePetId || DEFAULT_SEATS.ai_right
      : DEFAULT_SEATS[seat]
  const pet = findPetById(configuredPetId || fallbackId)
  const petName = pet.name[locale]
  const seatTag =
    locale === 'zh-CN'
      ? seat === 'ai_right'
        ? '下家'
        : seat === 'ai_across'
          ? '对家'
          : '上家'
      : seat === 'ai_right'
        ? 'R'
        : seat === 'ai_across'
          ? 'Across'
          : 'L'

  const preferredVoice = pet.voicePack?.preferredVoice ?? (seat === 'ai_left' ? 'stella' : 'tide')

  return {
    id: `mj:${seat}:${pet.id}`,
    name: petName,
    petSpriteUrl: pet.spriteUrl,
    petCols: pet.cols,
    petRows: pet.rows,
    preferredVoice,
    voicePack: pet.voicePack,
    tagline: seatTag,
    systemPrompt: pet.promptHint[locale],
    greeting:
      locale === 'zh-CN' ? `我是${petName}，洗好牌了，开搓！` : `${petName} is ready at the table.`,
    customizable: true,
  }
}
