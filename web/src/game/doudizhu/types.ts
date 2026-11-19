import type { Locale } from '../../services/settings.js'

export type CardSuit = 'S' | 'H' | 'C' | 'D' | 'J'

/**
 * 扑克点数权重：
 * 3..10 -> 3..10, J=11, Q=12, K=13, A=14, 2=15, 小王=16, 大王=17
 */
export type Card = {
  id: string
  rank: number
  suit: CardSuit
}

export type DoudizhuSeatId = 'player' | 'ai_right' | 'ai_left'

export type DoudizhuRole = 'landlord' | 'peasant'

export type DoudizhuPhase = 'bidding' | 'playing' | 'finished'

export type ComboKind =
  | 'single'
  | 'pair'
  | 'triple'
  | 'triple_single'
  | 'triple_pair'
  | 'straight'
  | 'double_straight'
  | 'airplane'
  | 'airplane_single'
  | 'airplane_pair'
  | 'four_two_single'
  | 'four_two_pair'
  | 'bomb'
  | 'rocket'

export type DetectedCombo = {
  kind: ComboKind
  mainRank: number
  length: number
  sequenceLength?: number
  cards: Card[]
}

export type DoudizhuMove =
  | { type: 'bid'; score: 0 | 1 | 2 | 3 }
  | { type: 'play'; cardIds: string[] }
  | { type: 'pass' }

export type DoudizhuPlayLog = {
  seat: DoudizhuSeatId
  phase: 'bidding' | 'playing'
  text: string
  cards?: Card[]
  comboKind?: ComboKind
  pass?: boolean
  bidScore?: number
}

export type SeatPlayDisplay = {
  cards: Card[]
  pass: boolean
  bidLabel?: string
  speech: string
}

export type DoudizhuState = {
  phase: DoudizhuPhase
  hands: Record<DoudizhuSeatId, Card[]>
  bottomCards: Card[]
  currentTurn: DoudizhuSeatId
  firstBidder: DoudizhuSeatId
  bidTurnCount: number
  highestBid: 0 | 1 | 2 | 3
  highestBidder: DoudizhuSeatId | null
  landlordSeat: DoudizhuSeatId | null
  /** 桌面上当前待压的牌型（领出状态或首手为 null） */
  tablePlay: {
    seat: DoudizhuSeatId
    combo: DetectedCombo
  } | null
  passStreak: number
  /** 每位玩家当前桌面展示区（出牌 / 不要 / 叫分与气泡台词） */
  seatDisplays: Record<DoudizhuSeatId, SeatPlayDisplay>
  /** 已打出的明牌按点数累计（供受限算牌减法使用） */
  playedCountByRank: Record<number, number>
  /** 一局内 AI 算牌总次数上限（<= 5） */
  cardCountBudgetLeft: number
  /** 最近已发生的 8 手摘要（避免超出人类短期记忆范围） */
  recentHistory: DoudizhuPlayLog[]
  winnerTeam: 'landlord' | 'peasants' | null
  /** 允许玩家悔牌回到上一个玩家行动前的快照 */
  undoStack: Array<{
    phase: DoudizhuPhase
    hands: Record<DoudizhuSeatId, Card[]>
    bottomCards: Card[]
    currentTurn: DoudizhuSeatId
    highestBid: 0 | 1 | 2 | 3
    highestBidder: DoudizhuSeatId | null
    landlordSeat: DoudizhuSeatId | null
    tablePlay: { seat: DoudizhuSeatId; combo: DetectedCombo } | null
    passStreak: number
    seatDisplays: Record<DoudizhuSeatId, SeatPlayDisplay>
    playedCountByRank: Record<number, number>
    cardCountBudgetLeft: number
    recentHistory: DoudizhuPlayLog[]
  }>
}

export const getSeatLabel = (seat: DoudizhuSeatId, locale: Locale): string => {
  if (locale === 'zh-CN') {
    return seat === 'player' ? '你' : seat === 'ai_right' ? '下家' : '上家'
  }
  return seat === 'player' ? 'You' : seat === 'ai_right' ? 'Right' : 'Left'
}
