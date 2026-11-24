import type { Locale } from '../../services/settings.js'

/**
 * 麻将牌编码：
 * 0..8   = 1万..9万 (m)
 * 9..17  = 1条..9条 (s)
 * 18..26 = 1筒..9筒 (p)
 * 27..30 = 东南西北 (E, S, W, N)
 * 31..33 = 中发白   (Z, F, B)
 */
export type MahjongTile = {
  id: string
  code: number
}

export type MahjongSeatId = 'player' | 'ai_right' | 'ai_across' | 'ai_left'

export type MahjongMeldKind = 'chi' | 'pong' | 'minggang' | 'angang' | 'bugang'

export type MahjongMeld = {
  kind: MahjongMeldKind
  tiles: MahjongTile[]
  fromSeat?: MahjongSeatId
}

export type MahjongClaimOption =
  | { type: 'hu' }
  | { type: 'gang' }
  | { type: 'pong' }
  | { type: 'chi'; useCodes: [number, number] }

export type MahjongPendingClaim = {
  seat: MahjongSeatId
  priority: number
  options: MahjongClaimOption[]
}

export type MahjongMove =
  | { type: 'discard'; tileId: string }
  | { type: 'hu' }
  | { type: 'angang'; code: number }
  | { type: 'bugang'; code: number }
  | { type: 'pong' }
  | { type: 'gang' }
  | { type: 'chi'; useCodes: [number, number] }
  | { type: 'pass' }

export type MahjongWinResult = {
  winnerSeat: MahjongSeatId
  winType: 'zimo' | 'dianpao'
  loserSeat?: MahjongSeatId
  winTile: MahjongTile
  fanNames: string[]
  totalFan: number
}

export type MahjongUndoSnapshot = {
  phase: MahjongState['phase']
  wall: MahjongTile[]
  hands: Record<MahjongSeatId, MahjongTile[]>
  melds: Record<MahjongSeatId, MahjongMeld[]>
  discards: Record<MahjongSeatId, MahjongTile[]>
  seatSpeeches: Record<MahjongSeatId, string>
  currentTurn: MahjongSeatId
  lastDrawnId: string | null
  lastDiscard: { seat: MahjongSeatId; tile: MahjongTile } | null
  lastDrawWasKong: boolean
  pendingClaims: MahjongPendingClaim[]
  recentLogs: string[]
}

export type MahjongState = {
  phase: 'playing_discard' | 'claim_window' | 'finished'
  wall: MahjongTile[]
  hands: Record<MahjongSeatId, MahjongTile[]>
  melds: Record<MahjongSeatId, MahjongMeld[]>
  discards: Record<MahjongSeatId, MahjongTile[]>
  seatSpeeches: Record<MahjongSeatId, string>
  currentTurn: MahjongSeatId
  lastDrawnId: string | null
  lastDiscard: { seat: MahjongSeatId; tile: MahjongTile } | null
  lastDrawWasKong: boolean
  pendingClaims: MahjongPendingClaim[]
  recentLogs: string[]
  winResult: MahjongWinResult | null
  undoStack: MahjongUndoSnapshot[]
}

export const getMahjongSeatLabel = (seat: MahjongSeatId, locale: Locale): string => {
  if (locale === 'zh-CN') {
    if (seat === 'player') {
      return '你（东风）'
    }
    if (seat === 'ai_right') {
      return '下家（南风）'
    }
    if (seat === 'ai_across') {
      return '对家（西风）'
    }
    return '上家（北风）'
  }
  if (seat === 'player') {
    return 'You (East)'
  }
  if (seat === 'ai_right') {
    return 'Right (South)'
  }
  if (seat === 'ai_across') {
    return 'Across (West)'
  }
  return 'Left (North)'
}
