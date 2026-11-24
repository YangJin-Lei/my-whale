import type { Locale } from '../../services/settings.js'
import type {
  MahjongClaimOption,
  MahjongMeld,
  MahjongMove,
  MahjongPendingClaim,
  MahjongSeatId,
  MahjongState,
  MahjongTile,
  MahjongUndoSnapshot,
} from './types.js'
import { getMahjongSeatLabel } from './types.js'

export const MAHJONG_TILE_KIND_COUNT = 34
export const MAHJONG_SEAT_ORDER: readonly MahjongSeatId[] = [
  'player',
  'ai_right',
  'ai_across',
  'ai_left',
]

const HONOR_SHORT = ['E', 'S', 'W', 'N', 'Z', 'F', 'B'] as const
const HONOR_ZH = ['东', '南', '西', '北', '中', '发', '白'] as const
const CN_NUMS = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'] as const

export const nextMahjongSeat = (seat: MahjongSeatId): MahjongSeatId => {
  const idx = MAHJONG_SEAT_ORDER.indexOf(seat)
  return MAHJONG_SEAT_ORDER[(idx + 1) % MAHJONG_SEAT_ORDER.length]
}

export const seatDistance = (fromSeat: MahjongSeatId, toSeat: MahjongSeatId): number => {
  const a = MAHJONG_SEAT_ORDER.indexOf(fromSeat)
  const b = MAHJONG_SEAT_ORDER.indexOf(toSeat)
  return (b - a + 4) % 4
}

export const tileCodeToShortCode = (code: number): string => {
  if (code >= 0 && code <= 8) {
    return `${code + 1}m`
  }
  if (code >= 9 && code <= 17) {
    return `${code - 8}s`
  }
  if (code >= 18 && code <= 26) {
    return `${code - 17}p`
  }
  return HONOR_SHORT[code - 27] ?? '?'
}

export const tileCodeToLabel = (code: number, locale: Locale = 'zh-CN'): string => {
  if (locale !== 'zh-CN') {
    return tileCodeToShortCode(code)
  }
  if (code >= 0 && code <= 8) {
    return `${code + 1}万`
  }
  if (code >= 9 && code <= 17) {
    return `${code - 8}条`
  }
  if (code >= 18 && code <= 26) {
    return `${code - 17}筒`
  }
  return HONOR_ZH[code - 27] ?? '?'
}

export const tileCodeSuit = (code: number): 'm' | 's' | 'p' | 'honor' => {
  if (code < 9) {
    return 'm'
  }
  if (code < 18) {
    return 's'
  }
  if (code < 27) {
    return 'p'
  }
  return 'honor'
}

export const sortMahjongTiles = (tiles: readonly MahjongTile[]): MahjongTile[] =>
  [...tiles].sort((a, b) => {
    if (a.code !== b.code) {
      return a.code - b.code
    }
    return a.id.localeCompare(b.id)
  })

export const createShuffledMahjongDeck = (): MahjongTile[] => {
  const deck: MahjongTile[] = []
  for (let code = 0; code < MAHJONG_TILE_KIND_COUNT; code += 1) {
    const short = tileCodeToShortCode(code)
    for (let copy = 0; copy < 4; copy += 1) {
      deck.push({ id: `${short}_${copy}`, code })
    }
  }
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = deck[i]
    deck[i] = deck[j]
    deck[j] = tmp
  }
  return deck
}

export const countByCode = (tiles: readonly MahjongTile[]): number[] => {
  const counts = Array.from({ length: MAHJONG_TILE_KIND_COUNT }, () => 0)
  for (const t of tiles) {
    if (t.code >= 0 && t.code < MAHJONG_TILE_KIND_COUNT) {
      counts[t.code] += 1
    }
  }
  return counts
}

const canFormMelds = (counts: number[], meldsNeeded: number): boolean => {
  if (meldsNeeded === 0) {
    return counts.every((c) => c === 0)
  }
  let idx = -1
  for (let i = 0; i < MAHJONG_TILE_KIND_COUNT; i += 1) {
    if (counts[i] > 0) {
      idx = i
      break
    }
  }
  if (idx === -1) {
    return false
  }

  // 尝试刻子
  if (counts[idx] >= 3) {
    counts[idx] -= 3
    if (canFormMelds(counts, meldsNeeded - 1)) {
      counts[idx] += 3
      return true
    }
    counts[idx] += 3
  }

  // 尝试顺子（仅万/条/筒同花色相邻 3 张）
  if (idx < 27 && idx % 9 <= 6 && counts[idx + 1] > 0 && counts[idx + 2] > 0) {
    counts[idx] -= 1
    counts[idx + 1] -= 1
    counts[idx + 2] -= 1
    if (canFormMelds(counts, meldsNeeded - 1)) {
      counts[idx] += 1
      counts[idx + 1] += 1
      counts[idx + 2] += 1
      return true
    }
    counts[idx] += 1
    counts[idx + 1] += 1
    counts[idx + 2] += 1
  }

  return false
}

const isSevenPairs = (counts: readonly number[], openMeldCount: number): boolean => {
  if (openMeldCount !== 0) {
    return false
  }
  let pairs = 0
  for (const c of counts) {
    if (c === 0) {
      continue
    }
    if (c === 2) {
      pairs += 1
    } else if (c === 4) {
      pairs += 2
    } else {
      return false
    }
  }
  return pairs === 7
}

export const canHuCounts = (counts: readonly number[], openMeldCount: number): boolean => {
  const total = counts.reduce((acc, c) => acc + c, 0)
  const expectedMelds = 4 - openMeldCount
  if (expectedMelds < 0 || total !== expectedMelds * 3 + 2) {
    return false
  }
  if (isSevenPairs(counts, openMeldCount)) {
    return true
  }
  const work = [...counts]
  for (let eye = 0; eye < MAHJONG_TILE_KIND_COUNT; eye += 1) {
    if (work[eye] >= 2) {
      work[eye] -= 2
      if (canFormMelds(work, expectedMelds)) {
        return true
      }
      work[eye] += 2
    }
  }
  return false
}

export const canHu = (
  closedTiles: readonly MahjongTile[],
  openMeldCount: number,
  extraTile?: MahjongTile | null
): boolean => {
  const counts = countByCode(closedTiles)
  if (extraTile) {
    counts[extraTile.code] += 1
  }
  return canHuCounts(counts, openMeldCount)
}

export const getTingWaits = (
  closedTiles: readonly MahjongTile[],
  openMeldCount: number
): number[] => {
  const expected = (4 - openMeldCount) * 3 + 1
  if (closedTiles.length !== expected) {
    return []
  }
  const base = countByCode(closedTiles)
  const waits: number[] = []
  for (let code = 0; code < MAHJONG_TILE_KIND_COUNT; code += 1) {
    if (base[code] >= 4) {
      continue
    }
    base[code] += 1
    if (canHuCounts(base, openMeldCount)) {
      waits.push(code)
    }
    base[code] -= 1
  }
  return waits
}

export const getDiscardTingMap = (
  closedTiles: readonly MahjongTile[],
  openMeldCount: number
): Map<number, number[]> => {
  const result = new Map<number, number[]>()
  const counts = countByCode(closedTiles)
  for (let discardCode = 0; discardCode < MAHJONG_TILE_KIND_COUNT; discardCode += 1) {
    if (counts[discardCode] <= 0) {
      continue
    }
    counts[discardCode] -= 1
    const waits: number[] = []
    for (let drawCode = 0; drawCode < MAHJONG_TILE_KIND_COUNT; drawCode += 1) {
      if (counts[drawCode] >= 4) {
        continue
      }
      counts[drawCode] += 1
      if (canHuCounts(counts, openMeldCount)) {
        waits.push(drawCode)
      }
      counts[drawCode] -= 1
    }
    counts[discardCode] += 1
    if (waits.length > 0) {
      result.set(discardCode, waits)
    }
  }
  return result
}

const canFormAllTriplets = (counts: number[], meldsNeeded: number): boolean => {
  const work = [...counts]
  for (let eye = 0; eye < MAHJONG_TILE_KIND_COUNT; eye += 1) {
    if (work[eye] >= 2) {
      work[eye] -= 2
      let tripletCount = 0
      let ok = true
      for (const c of work) {
        if (c === 3) {
          tripletCount += 1
        } else if (c !== 0) {
          ok = false
          break
        }
      }
      if (ok && tripletCount === meldsNeeded) {
        return true
      }
      work[eye] += 2
    }
  }
  return false
}

export const analyzeWinPattern = ({
  closedTiles,
  melds,
  winTile,
  winType,
  isKongDraw,
  wallLeft,
  locale,
}: {
  closedTiles: readonly MahjongTile[]
  melds: readonly MahjongMeld[]
  winTile: MahjongTile
  winType: 'zimo' | 'dianpao'
  isKongDraw: boolean
  wallLeft: number
  locale: Locale
}): { fanNames: string[]; totalFan: number } => {
  const allTiles = [...closedTiles, winTile, ...melds.flatMap((m) => m.tiles)]
  const countsClosedWithWin = countByCode([...closedTiles, winTile])
  const suits = new Set<string>()
  let hasHonor = false
  for (const t of allTiles) {
    const suit = tileCodeSuit(t.code)
    if (suit === 'honor') {
      hasHonor = true
    } else {
      suits.add(suit)
    }
  }

  const fans: Array<{ zh: string; en: string; value: number }> = []
  const openCount = melds.filter((m) => m.kind !== 'angang').length

  if (isSevenPairs(countsClosedWithWin, melds.length)) {
    const dragonCount = countsClosedWithWin.filter((c) => c === 4).length
    if (dragonCount > 0) {
      fans.push({ zh: '龙七对', en: 'Quad Seven Pairs', value: 4 * dragonCount })
    } else {
      fans.push({ zh: '七对', en: 'Seven Pairs', value: 2 })
    }
  } else {
    const meldsPongOnly = melds.every((m) => m.kind !== 'chi')
    if (meldsPongOnly && canFormAllTriplets(countsClosedWithWin, 4 - melds.length)) {
      fans.push({ zh: '碰碰胡', en: 'All Pungs', value: 2 })
    }
  }

  if (suits.size === 1 && !hasHonor) {
    fans.push({ zh: '清一色', en: 'Full Flush', value: 4 })
  } else if (suits.size === 1 && hasHonor) {
    fans.push({ zh: '混一色', en: 'Half Flush', value: 2 })
  }

  if (openCount === 0 && !fans.some((f) => f.zh.includes('七对'))) {
    fans.push({ zh: '门前清', en: 'Concealed Hand', value: 1 })
  }
  if (winType === 'zimo') {
    fans.push({ zh: '自摸', en: 'Self-Draw', value: 1 })
  }
  if (isKongDraw) {
    fans.push({ zh: '杠上开花', en: 'Kong Win', value: 2 })
  }
  if (wallLeft === 0) {
    fans.push({ zh: '海底捞月', en: 'Last Tile', value: 2 })
  }
  if (fans.length === 0) {
    fans.push({ zh: '平胡', en: 'Common Hand', value: 1 })
  }

  const totalFan = fans.reduce((acc, item) => acc + item.value, 0)
  return {
    fanNames: fans.map((f) => (locale === 'zh-CN' ? f.zh : f.en)),
    totalFan,
  }
}

export const getDiscardPhaseOptions = (
  state: MahjongState,
  seat: MahjongSeatId
): { canHu: boolean; angangCodes: number[]; bugangCodes: number[] } => {
  const hand = state.hands[seat]
  const melds = state.melds[seat]
  const huReady = canHu(hand, melds.length)
  const counts = countByCode(hand)

  const angangCodes: number[] = []
  if (state.wall.length > 0) {
    for (let code = 0; code < MAHJONG_TILE_KIND_COUNT; code += 1) {
      if (counts[code] === 4) {
        angangCodes.push(code)
      }
    }
  }

  const bugangCodes: number[] = []
  if (state.wall.length > 0) {
    for (const meld of melds) {
      if (meld.kind === 'pong') {
        const pongCode = meld.tiles[0]?.code
        if (pongCode !== undefined && counts[pongCode] >= 1) {
          bugangCodes.push(pongCode)
        }
      }
    }
  }

  return { canHu: huReady, angangCodes, bugangCodes }
}

const findChiCombinations = (
  hand: readonly MahjongTile[],
  targetCode: number
): [number, number][] => {
  if (targetCode >= 27) {
    return []
  }
  const posInSuit = targetCode % 9
  const counts = countByCode(hand)
  const combos: [number, number][] = []

  if (posInSuit >= 2 && counts[targetCode - 2] > 0 && counts[targetCode - 1] > 0) {
    combos.push([targetCode - 2, targetCode - 1])
  }
  if (
    posInSuit >= 1 &&
    posInSuit <= 7 &&
    counts[targetCode - 1] > 0 &&
    counts[targetCode + 1] > 0
  ) {
    combos.push([targetCode - 1, targetCode + 1])
  }
  if (posInSuit <= 6 && counts[targetCode + 1] > 0 && counts[targetCode + 2] > 0) {
    combos.push([targetCode + 1, targetCode + 2])
  }
  return combos
}

export const buildClaimQueue = (
  state: MahjongState,
  discardSeat: MahjongSeatId,
  tile: MahjongTile
): MahjongPendingClaim[] => {
  const claims: MahjongPendingClaim[] = []
  const nextOfDiscard = nextMahjongSeat(discardSeat)

  for (let offset = 1; offset <= 3; offset += 1) {
    let seat = discardSeat
    for (let i = 0; i < offset; i += 1) {
      seat = nextMahjongSeat(seat)
    }
    const hand = state.hands[seat]
    const melds = state.melds[seat]
    const counts = countByCode(hand)
    const options: MahjongClaimOption[] = []

    if (canHu(hand, melds.length, tile)) {
      options.push({ type: 'hu' })
    }
    if (counts[tile.code] >= 3 && state.wall.length > 0) {
      options.push({ type: 'gang' })
    }
    if (counts[tile.code] >= 2) {
      options.push({ type: 'pong' })
    }
    if (seat === nextOfDiscard) {
      const chiPairs = findChiCombinations(hand, tile.code)
      for (const pair of chiPairs) {
        options.push({ type: 'chi', useCodes: pair })
      }
    }

    if (options.length > 0) {
      const priority = options.some((o) => o.type === 'hu')
        ? 3
        : options.some((o) => o.type === 'gang' || o.type === 'pong')
          ? 2
          : 1
      claims.push({ seat, priority, options })
    }
  }

  claims.sort((a, b) => {
    if (b.priority !== a.priority) {
      return b.priority - a.priority
    }
    return seatDistance(discardSeat, a.seat) - seatDistance(discardSeat, b.seat)
  })
  return claims
}

const cloneUndoSnapshot = (state: MahjongState): MahjongUndoSnapshot => ({
  phase: state.phase,
  wall: [...state.wall],
  hands: {
    player: [...state.hands.player],
    ai_right: [...state.hands.ai_right],
    ai_across: [...state.hands.ai_across],
    ai_left: [...state.hands.ai_left],
  },
  melds: {
    player: state.melds.player.map((m) => ({ ...m, tiles: [...m.tiles] })),
    ai_right: state.melds.ai_right.map((m) => ({ ...m, tiles: [...m.tiles] })),
    ai_across: state.melds.ai_across.map((m) => ({ ...m, tiles: [...m.tiles] })),
    ai_left: state.melds.ai_left.map((m) => ({ ...m, tiles: [...m.tiles] })),
  },
  discards: {
    player: [...state.discards.player],
    ai_right: [...state.discards.ai_right],
    ai_across: [...state.discards.ai_across],
    ai_left: [...state.discards.ai_left],
  },
  seatSpeeches: { ...state.seatSpeeches },
  currentTurn: state.currentTurn,
  lastDrawnId: state.lastDrawnId,
  lastDiscard: state.lastDiscard,
  lastDrawWasKong: state.lastDrawWasKong,
  pendingClaims: state.pendingClaims,
  recentLogs: [...state.recentLogs],
})

export const undoMahjongRound = (state: MahjongState): MahjongState => {
  const snap = state.undoStack[state.undoStack.length - 1]
  if (!snap) {
    return state
  }
  return {
    ...state,
    phase: snap.phase,
    wall: snap.wall,
    hands: snap.hands,
    melds: snap.melds,
    discards: snap.discards,
    seatSpeeches: snap.seatSpeeches,
    currentTurn: snap.currentTurn,
    lastDrawnId: snap.lastDrawnId,
    lastDiscard: snap.lastDiscard,
    lastDrawWasKong: snap.lastDrawWasKong,
    pendingClaims: snap.pendingClaims,
    recentLogs: snap.recentLogs,
    winResult: null,
    undoStack: state.undoStack.slice(0, -1),
  }
}

const pushLog = (logs: readonly string[], line: string): string[] => [...logs, line].slice(-10)

export const createInitialMahjongState = (): MahjongState => {
  const deck = createShuffledMahjongDeck()
  const pHand = sortMahjongTiles(deck.slice(0, 13))
  const drawTile = deck[13]
  const playerHand = sortMahjongTiles([...pHand, drawTile])
  const rightHand = sortMahjongTiles(deck.slice(14, 27))
  const acrossHand = sortMahjongTiles(deck.slice(27, 40))
  const leftHand = sortMahjongTiles(deck.slice(40, 53))
  const wall = deck.slice(53)

  return {
    phase: 'playing_discard',
    wall,
    hands: {
      player: playerHand,
      ai_right: rightHand,
      ai_across: acrossHand,
      ai_left: leftHand,
    },
    melds: {
      player: [],
      ai_right: [],
      ai_across: [],
      ai_left: [],
    },
    discards: {
      player: [],
      ai_right: [],
      ai_across: [],
      ai_left: [],
    },
    seatSpeeches: {
      player: '',
      ai_right: '',
      ai_across: '',
      ai_left: '',
    },
    currentTurn: 'player',
    lastDrawnId: drawTile.id,
    lastDiscard: null,
    lastDrawWasKong: false,
    pendingClaims: [],
    recentLogs: [],
    winResult: null,
    undoStack: [],
  }
}

const advanceToNextDraw = (
  state: MahjongState,
  fromSeat: MahjongSeatId,
  nextSpeeches: Record<MahjongSeatId, string>,
  nextLogs: string[],
  nextUndo: MahjongUndoSnapshot[],
  locale: Locale
): { nextState: MahjongState } => {
  if (state.wall.length === 0) {
    return {
      nextState: {
        ...state,
        phase: 'finished',
        seatSpeeches: nextSpeeches,
        lastDrawnId: null,
        lastDrawWasKong: false,
        pendingClaims: [],
        recentLogs: pushLog(
          nextLogs,
          locale === 'zh-CN' ? '牌山已空，本局荒庄和牌' : 'Wall exhausted—Draw!'
        ),
        winResult: null,
        undoStack: nextUndo,
      },
    }
  }

  const nextSeat = nextMahjongSeat(fromSeat)
  const drawn = state.wall[0]
  const nextWall = state.wall.slice(1)
  const nextHand = sortMahjongTiles([...state.hands[nextSeat], drawn])

  return {
    nextState: {
      ...state,
      phase: 'playing_discard',
      wall: nextWall,
      hands: {
        ...state.hands,
        [nextSeat]: nextHand,
      },
      seatSpeeches: nextSpeeches,
      currentTurn: nextSeat,
      lastDrawnId: drawn.id,
      lastDrawWasKong: false,
      pendingClaims: [],
      recentLogs: nextLogs,
      undoStack: nextUndo,
    },
  }
}

export const applyMahjongMove = (
  state: MahjongState,
  seat: MahjongSeatId,
  move: MahjongMove,
  speech = '',
  locale: Locale = 'zh-CN',
  recordPlayerUndo = false
): { nextState: MahjongState } | { error: string } => {
  if (state.phase === 'finished') {
    return { error: locale === 'zh-CN' ? '本局已结束' : 'Match already finished' }
  }

  const nextUndo =
    recordPlayerUndo && seat === 'player'
      ? [...state.undoStack.slice(-4), cloneUndoSnapshot(state)]
      : state.undoStack

  if (state.phase === 'claim_window') {
    const activeClaim = state.pendingClaims[0]
    if (!activeClaim || activeClaim.seat !== seat) {
      return { error: locale === 'zh-CN' ? '当前未轮到你响应吃碰杠胡' : 'Not your claim turn' }
    }
    const discardInfo = state.lastDiscard
    if (!discardInfo) {
      return { error: locale === 'zh-CN' ? '桌面无待响应牌' : 'No discard to claim' }
    }

    const nextSpeeches = {
      ...state.seatSpeeches,
      [seat]: speech || state.seatSpeeches[seat],
    }

    if (move.type === 'pass') {
      const remaining = state.pendingClaims.slice(1)
      if (remaining.length > 0) {
        return {
          nextState: {
            ...state,
            seatSpeeches: nextSpeeches,
            pendingClaims: remaining,
            undoStack: nextUndo,
          },
        }
      }
      return advanceToNextDraw(
        state,
        discardInfo.seat,
        nextSpeeches,
        state.recentLogs,
        nextUndo,
        locale
      )
    }

    if (move.type === 'hu') {
      const hasHu = activeClaim.options.some((o) => o.type === 'hu')
      if (!hasHu) {
        return { error: locale === 'zh-CN' ? '当前不能点炮胡牌' : 'Cannot Hu on this discard' }
      }
      const { fanNames, totalFan } = analyzeWinPattern({
        closedTiles: state.hands[seat],
        melds: state.melds[seat],
        winTile: discardInfo.tile,
        winType: 'dianpao',
        isKongDraw: false,
        wallLeft: state.wall.length,
        locale,
      })
      const seatLabel = getMahjongSeatLabel(seat, locale)
      const tileLabel = tileCodeToLabel(discardInfo.tile.code, locale)
      return {
        nextState: {
          ...state,
          phase: 'finished',
          seatSpeeches: {
            ...nextSpeeches,
            [seat]: speech || (locale === 'zh-CN' ? '胡啦！' : 'Hu!'),
          },
          pendingClaims: [],
          winResult: {
            winnerSeat: seat,
            winType: 'dianpao',
            loserSeat: discardInfo.seat,
            winTile: discardInfo.tile,
            fanNames,
            totalFan,
          },
          recentLogs: pushLog(
            state.recentLogs,
            locale === 'zh-CN'
              ? `${seatLabel} 胡 ${tileLabel}（${fanNames.join('·')} ${totalFan}番）`
              : `${seatLabel} wins on ${tileLabel} (${totalFan} Fan)`
          ),
          undoStack: nextUndo,
        },
      }
    }

    if (move.type === 'gang') {
      const hasGang = activeClaim.options.some((o) => o.type === 'gang')
      if (!hasGang || state.wall.length === 0) {
        return { error: locale === 'zh-CN' ? '当前不能明杠' : 'Cannot Kong' }
      }
      const matching = state.hands[seat].filter((t) => t.code === discardInfo.tile.code).slice(0, 3)
      const removeIds = new Set(matching.map((t) => t.id))
      const meld: MahjongMeld = {
        kind: 'minggang',
        tiles: [...matching, discardInfo.tile],
        fromSeat: discardInfo.seat,
      }
      const replacement = state.wall[state.wall.length - 1]
      const nextWall = state.wall.slice(0, -1)
      const nextHand = sortMahjongTiles([
        ...state.hands[seat].filter((t) => !removeIds.has(t.id)),
        replacement,
      ])
      const nextDiscards = {
        ...state.discards,
        [discardInfo.seat]: state.discards[discardInfo.seat].slice(0, -1),
      }
      const seatLabel = getMahjongSeatLabel(seat, locale)
      const tileLabel = tileCodeToLabel(discardInfo.tile.code, locale)
      return {
        nextState: {
          ...state,
          phase: 'playing_discard',
          wall: nextWall,
          hands: { ...state.hands, [seat]: nextHand },
          melds: { ...state.melds, [seat]: [...state.melds[seat], meld] },
          discards: nextDiscards,
          seatSpeeches: {
            ...nextSpeeches,
            [seat]: speech || (locale === 'zh-CN' ? '杠！' : 'Kong!'),
          },
          currentTurn: seat,
          lastDrawnId: replacement.id,
          lastDiscard: null,
          lastDrawWasKong: true,
          pendingClaims: [],
          recentLogs: pushLog(
            state.recentLogs,
            locale === 'zh-CN' ? `${seatLabel} 明杠 ${tileLabel}` : `${seatLabel} Kong ${tileLabel}`
          ),
          undoStack: nextUndo,
        },
      }
    }

    if (move.type === 'pong') {
      const hasPong = activeClaim.options.some((o) => o.type === 'pong')
      if (!hasPong) {
        return { error: locale === 'zh-CN' ? '当前不能碰牌' : 'Cannot Pung' }
      }
      const matching = state.hands[seat].filter((t) => t.code === discardInfo.tile.code).slice(0, 2)
      const removeIds = new Set(matching.map((t) => t.id))
      const meld: MahjongMeld = {
        kind: 'pong',
        tiles: [...matching, discardInfo.tile],
        fromSeat: discardInfo.seat,
      }
      const nextHand = state.hands[seat].filter((t) => !removeIds.has(t.id))
      const nextDiscards = {
        ...state.discards,
        [discardInfo.seat]: state.discards[discardInfo.seat].slice(0, -1),
      }
      const seatLabel = getMahjongSeatLabel(seat, locale)
      const tileLabel = tileCodeToLabel(discardInfo.tile.code, locale)
      return {
        nextState: {
          ...state,
          phase: 'playing_discard',
          hands: { ...state.hands, [seat]: nextHand },
          melds: { ...state.melds, [seat]: [...state.melds[seat], meld] },
          discards: nextDiscards,
          seatSpeeches: {
            ...nextSpeeches,
            [seat]: speech || (locale === 'zh-CN' ? '碰！' : 'Pung!'),
          },
          currentTurn: seat,
          lastDrawnId: null,
          lastDiscard: null,
          lastDrawWasKong: false,
          pendingClaims: [],
          recentLogs: pushLog(
            state.recentLogs,
            locale === 'zh-CN' ? `${seatLabel} 碰 ${tileLabel}` : `${seatLabel} Pung ${tileLabel}`
          ),
          undoStack: nextUndo,
        },
      }
    }

    if (move.type === 'chi') {
      const [c1, c2] = [...move.useCodes].sort((a, b) => a - b) as [number, number]
      const matchingOption = activeClaim.options.find(
        (o) => o.type === 'chi' && o.useCodes[0] === c1 && o.useCodes[1] === c2
      )
      if (!matchingOption) {
        return { error: locale === 'zh-CN' ? '手牌无法组成该顺子吃牌' : 'Illegal Chow combination' }
      }
      const t1 = state.hands[seat].find((t) => t.code === c1)
      const t2 = state.hands[seat].find((t) => t.code === c2 && t.id !== t1?.id)
      if (!t1 || !t2) {
        return { error: locale === 'zh-CN' ? '缺少吃牌所需手牌' : 'Missing tiles for Chow' }
      }
      const meld: MahjongMeld = {
        kind: 'chi',
        tiles: sortMahjongTiles([t1, t2, discardInfo.tile]),
        fromSeat: discardInfo.seat,
      }
      const nextHand = state.hands[seat].filter((t) => t.id !== t1.id && t.id !== t2.id)
      const nextDiscards = {
        ...state.discards,
        [discardInfo.seat]: state.discards[discardInfo.seat].slice(0, -1),
      }
      const seatLabel = getMahjongSeatLabel(seat, locale)
      const tileLabel = tileCodeToLabel(discardInfo.tile.code, locale)
      return {
        nextState: {
          ...state,
          phase: 'playing_discard',
          hands: { ...state.hands, [seat]: nextHand },
          melds: { ...state.melds, [seat]: [...state.melds[seat], meld] },
          discards: nextDiscards,
          seatSpeeches: {
            ...nextSpeeches,
            [seat]: speech || (locale === 'zh-CN' ? '吃！' : 'Chow!'),
          },
          currentTurn: seat,
          lastDrawnId: null,
          lastDiscard: null,
          lastDrawWasKong: false,
          pendingClaims: [],
          recentLogs: pushLog(
            state.recentLogs,
            locale === 'zh-CN' ? `${seatLabel} 吃 ${tileLabel}` : `${seatLabel} Chow ${tileLabel}`
          ),
          undoStack: nextUndo,
        },
      }
    }

    return {
      error: locale === 'zh-CN' ? '当前需响应吃碰杠胡或过' : 'Must respond to claim or pass',
    }
  }

  // 出牌阶段
  if (state.currentTurn !== seat) {
    return { error: locale === 'zh-CN' ? '未轮到当前席位摸打' : 'Not this seat turn' }
  }

  const ownHand = state.hands[seat]
  const nextSpeeches = {
    ...state.seatSpeeches,
    [seat]: speech || state.seatSpeeches[seat],
  }

  if (move.type === 'hu') {
    if (!canHu(ownHand, state.melds[seat].length)) {
      return {
        error: locale === 'zh-CN' ? '当前手牌尚不满足胡牌条件' : 'Hand is not a winning hand',
      }
    }
    const drawnTile = ownHand.find((t) => t.id === state.lastDrawnId) ?? ownHand[ownHand.length - 1]
    if (!drawnTile) {
      return { error: 'Missing drawn tile' }
    }
    const closedWithoutWin = ownHand.filter((t) => t.id !== drawnTile.id)
    const { fanNames, totalFan } = analyzeWinPattern({
      closedTiles: closedWithoutWin,
      melds: state.melds[seat],
      winTile: drawnTile,
      winType: 'zimo',
      isKongDraw: state.lastDrawWasKong,
      wallLeft: state.wall.length,
      locale,
    })
    const seatLabel = getMahjongSeatLabel(seat, locale)
    return {
      nextState: {
        ...state,
        phase: 'finished',
        seatSpeeches: {
          ...nextSpeeches,
          [seat]: speech || (locale === 'zh-CN' ? '自摸胡了！' : 'Self-draw win!'),
        },
        winResult: {
          winnerSeat: seat,
          winType: 'zimo',
          winTile: drawnTile,
          fanNames,
          totalFan,
        },
        recentLogs: pushLog(
          state.recentLogs,
          locale === 'zh-CN'
            ? `${seatLabel} 自摸胡牌（${fanNames.join('·')} ${totalFan}番）`
            : `${seatLabel} self-draw win (${totalFan} Fan)`
        ),
        undoStack: nextUndo,
      },
    }
  }

  if (move.type === 'angang') {
    if (state.wall.length === 0) {
      return { error: locale === 'zh-CN' ? '牌山已空无法暗杠' : 'Cannot Kong with empty wall' }
    }
    const matching = ownHand.filter((t) => t.code === move.code)
    if (matching.length < 4) {
      return { error: locale === 'zh-CN' ? '不足 4 张无法暗杠' : 'Need 4 tiles for concealed Kong' }
    }
    const meldTiles = matching.slice(0, 4)
    const removeIds = new Set(meldTiles.map((t) => t.id))
    const replacement = state.wall[state.wall.length - 1]
    const nextWall = state.wall.slice(0, -1)
    const nextHand = sortMahjongTiles([...ownHand.filter((t) => !removeIds.has(t.id)), replacement])
    const seatLabel = getMahjongSeatLabel(seat, locale)
    const tileLabel = tileCodeToLabel(move.code, locale)
    return {
      nextState: {
        ...state,
        wall: nextWall,
        hands: { ...state.hands, [seat]: nextHand },
        melds: {
          ...state.melds,
          [seat]: [...state.melds[seat], { kind: 'angang', tiles: meldTiles }],
        },
        seatSpeeches: {
          ...nextSpeeches,
          [seat]: speech || (locale === 'zh-CN' ? '暗杠！' : 'Concealed Kong!'),
        },
        lastDrawnId: replacement.id,
        lastDrawWasKong: true,
        recentLogs: pushLog(
          state.recentLogs,
          locale === 'zh-CN'
            ? `${seatLabel} 暗杠 ${tileLabel}`
            : `${seatLabel} concealed Kong ${tileLabel}`
        ),
        undoStack: nextUndo,
      },
    }
  }

  if (move.type === 'bugang') {
    if (state.wall.length === 0) {
      return { error: locale === 'zh-CN' ? '牌山已空无法补杠' : 'Cannot add Kong with empty wall' }
    }
    const meldIdx = state.melds[seat].findIndex(
      (m) => m.kind === 'pong' && m.tiles[0]?.code === move.code
    )
    const addTile = ownHand.find((t) => t.code === move.code)
    if (meldIdx === -1 || !addTile) {
      return { error: locale === 'zh-CN' ? '找不到对应碰牌或手牌无法补杠' : 'Cannot add to Pung' }
    }
    const nextMelds = state.melds[seat].map((m, idx) =>
      idx === meldIdx ? { ...m, kind: 'bugang' as const, tiles: [...m.tiles, addTile] } : m
    )
    const replacement = state.wall[state.wall.length - 1]
    const nextWall = state.wall.slice(0, -1)
    const nextHand = sortMahjongTiles([...ownHand.filter((t) => t.id !== addTile.id), replacement])
    const seatLabel = getMahjongSeatLabel(seat, locale)
    const tileLabel = tileCodeToLabel(move.code, locale)
    return {
      nextState: {
        ...state,
        wall: nextWall,
        hands: { ...state.hands, [seat]: nextHand },
        melds: { ...state.melds, [seat]: nextMelds },
        seatSpeeches: {
          ...nextSpeeches,
          [seat]: speech || (locale === 'zh-CN' ? '补杠！' : 'Add Kong!'),
        },
        lastDrawnId: replacement.id,
        lastDrawWasKong: true,
        recentLogs: pushLog(
          state.recentLogs,
          locale === 'zh-CN'
            ? `${seatLabel} 补杠 ${tileLabel}`
            : `${seatLabel} added Kong ${tileLabel}`
        ),
        undoStack: nextUndo,
      },
    }
  }

  if (move.type !== 'discard') {
    return { error: locale === 'zh-CN' ? '请打出一张手牌或选择胡/杠' : 'Must discard, Hu, or Kong' }
  }

  const targetTile = ownHand.find((t) => t.id === move.tileId)
  if (!targetTile) {
    return { error: locale === 'zh-CN' ? '手牌中未找到指定牌' : 'Selected tile not in hand' }
  }

  const remainingHand = ownHand.filter((t) => t.id !== targetTile.id)
  const nextDiscards = {
    ...state.discards,
    [seat]: [...state.discards[seat], targetTile],
  }
  const seatLabel = getMahjongSeatLabel(seat, locale)
  const tileLabel = tileCodeToLabel(targetTile.code, locale)
  const nextLogs = pushLog(
    state.recentLogs,
    locale === 'zh-CN' ? `${seatLabel} 打出 ${tileLabel}` : `${seatLabel} discarded ${tileLabel}`
  )

  const afterDiscard: MahjongState = {
    ...state,
    hands: { ...state.hands, [seat]: remainingHand },
    discards: nextDiscards,
    seatSpeeches: {
      ...nextSpeeches,
      [seat]: speech || tileLabel,
    },
    lastDrawnId: null,
    lastDiscard: { seat, tile: targetTile },
    lastDrawWasKong: false,
    recentLogs: nextLogs,
  }

  const claims = buildClaimQueue(afterDiscard, seat, targetTile)
  if (claims.length > 0) {
    return {
      nextState: {
        ...afterDiscard,
        phase: 'claim_window',
        pendingClaims: claims,
        undoStack: nextUndo,
      },
    }
  }

  return advanceToNextDraw(
    afterDiscard,
    seat,
    afterDiscard.seatSpeeches,
    nextLogs,
    nextUndo,
    locale
  )
}

const TILE_ALIASES: Record<string, number> = {
  E: 27,
  EAST: 27,
  东: 27,
  东风: 27,
  S: 28,
  SOUTH: 28,
  南: 28,
  南风: 28,
  W: 29,
  WEST: 29,
  西: 29,
  西风: 29,
  N: 30,
  NORTH: 30,
  北: 30,
  北风: 30,
  Z: 31,
  ZHONG: 31,
  RED: 31,
  中: 31,
  红中: 31,
  F: 32,
  FA: 32,
  GREEN: 32,
  发: 32,
  发财: 32,
  B: 33,
  BAI: 33,
  WHITE: 33,
  白: 33,
  白板: 33,
}

export const parseTileCodeToken = (raw: string): number | null => {
  const s = raw.trim()
  if (!s) {
    return null
  }
  const upper = s.toUpperCase()
  if (TILE_ALIASES[upper] !== undefined) {
    return TILE_ALIASES[upper]
  }
  if (TILE_ALIASES[s] !== undefined) {
    return TILE_ALIASES[s]
  }

  const shortMatch = /^([1-9])([MSP])$/.exec(upper)
  if (shortMatch) {
    const n = Number(shortMatch[1]) - 1
    if (shortMatch[2] === 'M') {
      return n
    }
    if (shortMatch[2] === 'S') {
      return 9 + n
    }
    return 18 + n
  }

  const zhMatch = /^([1-9一二三四五六七八九])(万|萬|条|條|索|筒|饼)$/.exec(s)
  if (zhMatch) {
    let rank = Number(zhMatch[1])
    if (Number.isNaN(rank)) {
      rank = CN_NUMS.indexOf(zhMatch[1] as (typeof CN_NUMS)[number])
    }
    if (rank >= 1 && rank <= 9) {
      const unit = zhMatch[2]
      if (unit === '万' || unit === '萬') {
        return rank - 1
      }
      if (unit === '条' || unit === '條' || unit === '索') {
        return 9 + rank - 1
      }
      return 18 + rank - 1
    }
  }
  return null
}

export const resolveTileTokenFromHand = (
  hand: readonly MahjongTile[],
  rawToken: string
): MahjongTile | null => {
  const byId = hand.find((t) => t.id === rawToken.trim())
  if (byId) {
    return byId
  }
  const code = parseTileCodeToken(rawToken)
  if (code === null) {
    return null
  }
  return hand.find((t) => t.code === code) ?? null
}

/** 兜底启发式出牌/响应：能胡必胡，否则优先听牌、其次孤张字牌/幺九 */
export const pickSmartMahjongMove = (state: MahjongState): MahjongMove | null => {
  if (state.phase === 'finished') {
    return null
  }
  if (state.phase === 'claim_window') {
    const claim = state.pendingClaims[0]
    if (!claim) {
      return null
    }
    if (claim.options.some((o) => o.type === 'hu')) {
      return { type: 'hu' }
    }
    return { type: 'pass' }
  }

  const seat = state.currentTurn
  const hand = state.hands[seat]
  const melds = state.melds[seat]
  if (hand.length === 0) {
    return null
  }
  if (canHu(hand, melds.length)) {
    return { type: 'hu' }
  }

  const tingMap = getDiscardTingMap(hand, melds.length)
  if (tingMap.size > 0) {
    let bestCode = -1
    let bestWaitCount = -1
    for (const [code, waits] of tingMap.entries()) {
      if (waits.length > bestWaitCount) {
        bestWaitCount = waits.length
        bestCode = code
      }
    }
    const tile = hand.find((t) => t.code === bestCode)
    if (tile) {
      return { type: 'discard', tileId: tile.id }
    }
  }

  // 评估拆孤张优先级：单张字牌 > 边张幺九 > 无邻张孤张 > 摸进张
  const counts = countByCode(hand)
  let bestTile = hand[hand.length - 1]
  let bestIsolateScore = -999

  for (const tile of hand) {
    const c = tile.code
    let score = 0
    const copies = counts[c]
    score -= (copies - 1) * 14
    if (c >= 27) {
      score += 12
    } else {
      const r = c % 9
      if (r === 0 || r === 8) {
        score += 5
      }
      if (r > 0 && counts[c - 1] > 0) {
        score -= 9
      }
      if (r < 8 && counts[c + 1] > 0) {
        score -= 9
      }
      if (r > 1 && counts[c - 2] > 0) {
        score -= 4
      }
      if (r < 7 && counts[c + 2] > 0) {
        score -= 4
      }
    }
    if (score > bestIsolateScore) {
      bestIsolateScore = score
      bestTile = tile
    }
  }

  return { type: 'discard', tileId: bestTile.id }
}
