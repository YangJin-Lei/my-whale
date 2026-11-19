import type { Locale } from '../../services/settings.js'
import type {
  Card,
  CardSuit,
  ComboKind,
  DetectedCombo,
  DoudizhuMove,
  DoudizhuSeatId,
  DoudizhuState,
  SeatPlayDisplay,
} from './types.js'
import { getSeatLabel } from './types.js'

const SUITS: readonly CardSuit[] = ['S', 'H', 'C', 'D']
const SEAT_ORDER: readonly DoudizhuSeatId[] = ['player', 'ai_right', 'ai_left']
const SUIT_SYMBOLS: Record<CardSuit, string> = {
  S: '♠',
  H: '♥',
  C: '♣',
  D: '♦',
  J: '',
}

export const CARD_COUNT_BUDGET_MAX = 5

const TOTAL_DECK_COUNT_BY_RANK: Record<number, number> = {
  3: 4,
  4: 4,
  5: 4,
  6: 4,
  7: 4,
  8: 4,
  9: 4,
  10: 4,
  11: 4,
  12: 4,
  13: 4,
  14: 4,
  15: 4,
  16: 1,
  17: 1,
}

export const rankToLabel = (rank: number, locale: Locale = 'zh-CN'): string => {
  if (rank >= 3 && rank <= 10) {
    return String(rank)
  }
  if (rank === 11) {
    return 'J'
  }
  if (rank === 12) {
    return 'Q'
  }
  if (rank === 13) {
    return 'K'
  }
  if (rank === 14) {
    return 'A'
  }
  if (rank === 15) {
    return '2'
  }
  if (rank === 16) {
    return locale === 'zh-CN' ? '小王' : 'SJ'
  }
  return locale === 'zh-CN' ? '大王' : 'BJ'
}

export const formatCardToken = (card: Card, locale: Locale = 'zh-CN'): string => {
  if (card.rank === 16 || card.rank === 17) {
    return rankToLabel(card.rank, locale)
  }
  return `${SUIT_SYMBOLS[card.suit]}${rankToLabel(card.rank)}`
}

export const sortHandDesc = (cards: readonly Card[]): Card[] =>
  [...cards].sort((a, b) => {
    if (b.rank !== a.rank) {
      return b.rank - a.rank
    }
    return a.id.localeCompare(b.id)
  })

const sortAsc = (cards: readonly Card[]): Card[] => [...cards].sort((a, b) => a.rank - b.rank)

export const createShuffledDeck = (): Card[] => {
  const deck: Card[] = []
  for (let rank = 3; rank <= 15; rank += 1) {
    for (const suit of SUITS) {
      deck.push({ id: `${rank}${suit}`, rank, suit })
    }
  }
  deck.push({ id: '16J', rank: 16, suit: 'J' })
  deck.push({ id: '17J', rank: 17, suit: 'J' })

  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = deck[i]
    deck[i] = deck[j]
    deck[j] = tmp
  }
  return deck
}

const emptyDisplay = (): SeatPlayDisplay => ({
  cards: [],
  pass: false,
  speech: '',
})

export const nextSeat = (seat: DoudizhuSeatId): DoudizhuSeatId => {
  const idx = SEAT_ORDER.indexOf(seat)
  return SEAT_ORDER[(idx + 1) % SEAT_ORDER.length]
}

export const createInitialDoudizhuState = (
  firstBidder: DoudizhuSeatId = 'player'
): DoudizhuState => {
  const deck = createShuffledDeck()
  return {
    phase: 'bidding',
    hands: {
      player: sortHandDesc(deck.slice(0, 17)),
      ai_right: sortHandDesc(deck.slice(17, 34)),
      ai_left: sortHandDesc(deck.slice(34, 51)),
    },
    bottomCards: sortHandDesc(deck.slice(51, 54)),
    currentTurn: firstBidder,
    firstBidder,
    bidTurnCount: 0,
    highestBid: 0,
    highestBidder: null,
    landlordSeat: null,
    tablePlay: null,
    passStreak: 0,
    seatDisplays: {
      player: emptyDisplay(),
      ai_right: emptyDisplay(),
      ai_left: emptyDisplay(),
    },
    playedCountByRank: {},
    cardCountBudgetLeft: CARD_COUNT_BUDGET_MAX,
    recentHistory: [],
    winnerTeam: null,
    undoStack: [],
  }
}

const countRanks = (cards: readonly Card[]): Map<number, number> => {
  const map = new Map<number, number>()
  for (const c of cards) {
    map.set(c.rank, (map.get(c.rank) ?? 0) + 1)
  }
  return map
}

const isConsecutive = (ranksAsc: readonly number[]): boolean => {
  if (ranksAsc.length === 0) {
    return false
  }
  for (let i = 1; i < ranksAsc.length; i += 1) {
    if (ranksAsc[i] !== ranksAsc[i - 1] + 1) {
      return false
    }
  }
  return true
}

const findHighestConsecutiveRun = (
  candidateRanksDesc: number[],
  neededLength: number
): number | null => {
  const set = new Set(candidateRanksDesc)
  const sorted = [...set].filter((r) => r <= 14).sort((a, b) => b - a)
  for (const top of sorted) {
    const start = top - neededLength + 1
    if (start < 3) {
      continue
    }
    let ok = true
    for (let r = start; r <= top; r += 1) {
      if (!set.has(r)) {
        ok = false
        break
      }
    }
    if (ok) {
      return top
    }
  }
  return null
}

/** 识别全部 14 类斗地主合法牌型；非法返回 null */
export const detectCombo = (rawCards: readonly Card[]): DetectedCombo | null => {
  const cards = sortAsc(rawCards)
  const len = cards.length
  if (len === 0) {
    return null
  }

  const counts = countRanks(cards)
  const entries = [...counts.entries()].sort((a, b) => {
    if (b[1] !== a[1]) {
      return b[1] - a[1]
    }
    return a[0] - b[0]
  })
  const ranksAsc = [...counts.keys()].sort((a, b) => a - b)

  if (len === 2 && ranksAsc.length === 2 && ranksAsc[0] === 16 && ranksAsc[1] === 17) {
    return { kind: 'rocket', mainRank: 17, length: 2, cards }
  }
  if (len === 1) {
    return { kind: 'single', mainRank: cards[0].rank, length: 1, cards }
  }
  if (len === 2 && entries[0][1] === 2) {
    return { kind: 'pair', mainRank: entries[0][0], length: 2, cards }
  }
  if (len === 3 && entries[0][1] === 3) {
    return { kind: 'triple', mainRank: entries[0][0], length: 3, cards }
  }
  if (len === 4) {
    if (entries[0][1] === 4) {
      return { kind: 'bomb', mainRank: entries[0][0], length: 4, cards }
    }
    if (entries[0][1] === 3) {
      return { kind: 'triple_single', mainRank: entries[0][0], length: 4, cards }
    }
    return null
  }
  if (len === 5 && entries.length === 2 && entries[0][1] === 3 && entries[1][1] === 2) {
    return { kind: 'triple_pair', mainRank: entries[0][0], length: 5, cards }
  }
  if (
    len >= 5 &&
    entries.length === len &&
    ranksAsc[ranksAsc.length - 1] <= 14 &&
    isConsecutive(ranksAsc)
  ) {
    return {
      kind: 'straight',
      mainRank: ranksAsc[0],
      length: len,
      sequenceLength: len,
      cards,
    }
  }
  if (
    len >= 6 &&
    len % 2 === 0 &&
    entries.every(([, count]) => count === 2) &&
    ranksAsc[ranksAsc.length - 1] <= 14 &&
    isConsecutive(ranksAsc)
  ) {
    return {
      kind: 'double_straight',
      mainRank: ranksAsc[0],
      length: len,
      sequenceLength: entries.length,
      cards,
    }
  }
  if (
    len >= 6 &&
    len % 3 === 0 &&
    entries.every(([, count]) => count === 3) &&
    ranksAsc[ranksAsc.length - 1] <= 14 &&
    isConsecutive(ranksAsc)
  ) {
    return {
      kind: 'airplane',
      mainRank: ranksAsc[0],
      length: len,
      sequenceLength: entries.length,
      cards,
    }
  }
  if (len === 6 && entries[0][1] === 4) {
    return { kind: 'four_two_single', mainRank: entries[0][0], length: 6, cards }
  }

  // 飞机带单翼（k >= 2 组连三 + k 张任意单翼，不可带双王炸作翼）
  if (len >= 8 && len % 4 === 0) {
    const k = len / 4
    const tripleCandidates = entries
      .filter(([rank, count]) => rank <= 14 && count >= 3)
      .map(([rank]) => rank)
    const top = findHighestConsecutiveRun(tripleCandidates, k)
    if (top !== null) {
      const start = top - k + 1
      const restCounts = new Map(counts)
      for (let r = start; r <= top; r += 1) {
        restCounts.set(r, (restCounts.get(r) ?? 0) - 3)
      }
      const hasBothJokersAsWings = (restCounts.get(16) ?? 0) > 0 && (restCounts.get(17) ?? 0) > 0
      if (!hasBothJokersAsWings) {
        return {
          kind: 'airplane_single',
          mainRank: start,
          length: len,
          sequenceLength: k,
          cards,
        }
      }
    }
  }

  // 飞机带对翼（k >= 2 组连三 + k 对）
  if (len >= 10 && len % 5 === 0) {
    const k = len / 5
    const tripleCandidates = entries
      .filter(([rank, count]) => rank <= 14 && count >= 3)
      .map(([rank]) => rank)
    const top = findHighestConsecutiveRun(tripleCandidates, k)
    if (top !== null) {
      const start = top - k + 1
      const restCounts = new Map(counts)
      for (let r = start; r <= top; r += 1) {
        restCounts.set(r, (restCounts.get(r) ?? 0) - 3)
      }
      const allWingsArePairs = [...restCounts.values()].every((cnt) => cnt >= 0 && cnt % 2 === 0)
      if (allWingsArePairs) {
        return {
          kind: 'airplane_pair',
          mainRank: start,
          length: len,
          sequenceLength: k,
          cards,
        }
      }
    }
  }

  // 四带二对
  if (len === 8 && entries[0][1] === 4) {
    const main = entries[0][0]
    const remainingOk = entries
      .filter(([rank]) => rank !== main)
      .every(([, cnt]) => cnt === 2 || cnt === 4)
    if (remainingOk) {
      return { kind: 'four_two_pair', mainRank: main, length: 8, cards }
    }
  }

  return null
}

export const canBeatCombo = (candidate: DetectedCombo, target: DetectedCombo | null): boolean => {
  if (!target) {
    return true
  }
  if (candidate.kind === 'rocket') {
    return true
  }
  if (target.kind === 'rocket') {
    return false
  }
  if (candidate.kind === 'bomb') {
    if (target.kind !== 'bomb') {
      return true
    }
    return candidate.mainRank > target.mainRank
  }
  if (target.kind === 'bomb') {
    return false
  }
  if (candidate.kind !== target.kind || candidate.length !== target.length) {
    return false
  }
  if (
    candidate.sequenceLength !== undefined &&
    candidate.sequenceLength !== target.sequenceLength
  ) {
    return false
  }
  return candidate.mainRank > target.mainRank
}

export const describeComboName = (kind: ComboKind, locale: Locale): string => {
  const zh: Record<ComboKind, string> = {
    single: '单张',
    pair: '对子',
    triple: '三张',
    triple_single: '三带一',
    triple_pair: '三带二',
    straight: '顺子',
    double_straight: '连对',
    airplane: '飞机',
    airplane_single: '飞机带单',
    airplane_pair: '飞机带对',
    four_two_single: '四带二',
    four_two_pair: '四带两对',
    bomb: '炸弹',
    rocket: '王炸',
  }
  const en: Record<ComboKind, string> = {
    single: 'Single',
    pair: 'Pair',
    triple: 'Triple',
    triple_single: 'Triple+1',
    triple_pair: 'Triple+Pair',
    straight: 'Straight',
    double_straight: 'Pairs Run',
    airplane: 'Airplane',
    airplane_single: 'Plane+1s',
    airplane_pair: 'Plane+Pairs',
    four_two_single: 'Four+2',
    four_two_pair: 'Four+2 Pairs',
    bomb: 'Bomb',
    rocket: 'Rocket',
  }
  return locale === 'zh-CN' ? zh[kind] : en[kind]
}

/**
 * 为前端「提示」与超时兜底生成合法大过桌上牌型的候选出牌组合列表（按由小到大排序）。
 */
export const findBeatCandidates = (
  hand: readonly Card[],
  target: DetectedCombo | null
): Card[][] => {
  const asc = sortAsc(hand)
  if (asc.length === 0) {
    return []
  }

  const byRank = new Map<number, Card[]>()
  for (const c of asc) {
    const arr = byRank.get(c.rank) ?? []
    arr.push(c)
    byRank.set(c.rank, arr)
  }
  const sortedRanks = [...byRank.keys()].sort((a, b) => a - b)

  if (!target) {
    const leads: Card[][] = []
    for (const r of sortedRanks) {
      const group = byRank.get(r) ?? []
      if (group.length >= 2) {
        leads.push(group.slice(0, 2))
      }
      leads.push([group[0]])
    }
    return leads
  }

  const results: Card[][] = []
  const pushIfBeats = (cards: Card[]) => {
    const combo = detectCombo(cards)
    if (combo && canBeatCombo(combo, target)) {
      results.push(cards)
    }
  }

  if (target.kind === 'single') {
    for (const r of sortedRanks) {
      if (r > target.mainRank) {
        const g = byRank.get(r)
        if (g?.[0]) {
          results.push([g[0]])
        }
      }
    }
  } else if (target.kind === 'pair') {
    for (const r of sortedRanks) {
      const g = byRank.get(r)
      if (r > target.mainRank && g && g.length >= 2) {
        results.push(g.slice(0, 2))
      }
    }
  } else if (target.kind === 'triple') {
    for (const r of sortedRanks) {
      const g = byRank.get(r)
      if (r > target.mainRank && g && g.length >= 3) {
        results.push(g.slice(0, 3))
      }
    }
  } else if (target.kind === 'triple_single') {
    for (const r of sortedRanks) {
      const g = byRank.get(r)
      if (r > target.mainRank && g && g.length >= 3) {
        const wing = sortedRanks
          .filter((wr) => wr !== r)
          .map((wr) => byRank.get(wr)?.[0])
          .find(Boolean)
        if (wing) {
          pushIfBeats([...g.slice(0, 3), wing])
        }
      }
    }
  } else if (target.kind === 'triple_pair') {
    for (const r of sortedRanks) {
      const g = byRank.get(r)
      if (r > target.mainRank && g && g.length >= 3) {
        const pairRank = sortedRanks.find((pr) => pr !== r && (byRank.get(pr)?.length ?? 0) >= 2)
        const pairCards = pairRank !== undefined ? byRank.get(pairRank) : undefined
        if (pairCards) {
          pushIfBeats([...g.slice(0, 3), ...pairCards.slice(0, 2)])
        }
      }
    }
  } else if (target.kind === 'straight' && target.sequenceLength) {
    const seqLen = target.sequenceLength
    for (let start = target.mainRank + 1; start + seqLen - 1 <= 14; start += 1) {
      const seq: Card[] = []
      let ok = true
      for (let r = start; r < start + seqLen; r += 1) {
        const card = byRank.get(r)?.[0]
        if (!card) {
          ok = false
          break
        }
        seq.push(card)
      }
      if (ok) {
        results.push(seq)
      }
    }
  } else if (target.kind === 'double_straight' && target.sequenceLength) {
    const seqLen = target.sequenceLength
    for (let start = target.mainRank + 1; start + seqLen - 1 <= 14; start += 1) {
      const seq: Card[] = []
      let ok = true
      for (let r = start; r < start + seqLen; r += 1) {
        const g = byRank.get(r)
        if (!g || g.length < 2) {
          ok = false
          break
        }
        seq.push(g[0], g[1])
      }
      if (ok) {
        results.push(seq)
      }
    }
  }

  // 普通炸弹兜底压制
  if (target.kind !== 'rocket') {
    for (const r of sortedRanks) {
      const g = byRank.get(r)
      if (g && g.length === 4 && (target.kind !== 'bomb' || r > target.mainRank)) {
        results.push(g)
      }
    }
    const sj = byRank.get(16)?.[0]
    const bj = byRank.get(17)?.[0]
    if (sj && bj) {
      results.push([sj, bj])
    }
  }

  return results
}

const cloneUndoSnapshot = (state: DoudizhuState): DoudizhuState['undoStack'][number] => ({
  phase: state.phase,
  hands: {
    player: [...state.hands.player],
    ai_right: [...state.hands.ai_right],
    ai_left: [...state.hands.ai_left],
  },
  bottomCards: [...state.bottomCards],
  currentTurn: state.currentTurn,
  highestBid: state.highestBid,
  highestBidder: state.highestBidder,
  landlordSeat: state.landlordSeat,
  tablePlay: state.tablePlay,
  passStreak: state.passStreak,
  seatDisplays: {
    player: { ...state.seatDisplays.player },
    ai_right: { ...state.seatDisplays.ai_right },
    ai_left: { ...state.seatDisplays.ai_left },
  },
  playedCountByRank: { ...state.playedCountByRank },
  cardCountBudgetLeft: state.cardCountBudgetLeft,
  recentHistory: [...state.recentHistory],
})

const pushHistory = (
  list: DoudizhuState['recentHistory'],
  entry: DoudizhuState['recentHistory'][number]
) => [...list, entry].slice(-8)

export const applyDoudizhuMove = (
  state: DoudizhuState,
  seat: DoudizhuSeatId,
  move: DoudizhuMove,
  speech = '',
  locale: Locale = 'zh-CN',
  recordPlayerUndo = false
): { nextState: DoudizhuState } | { error: string } => {
  if (state.phase === 'finished') {
    return { error: locale === 'zh-CN' ? '本局已结束' : 'Round already finished' }
  }
  if (state.currentTurn !== seat) {
    return { error: locale === 'zh-CN' ? '未轮到当前席位行动' : 'Not this seat turn' }
  }

  const nextUndo =
    recordPlayerUndo && seat === 'player'
      ? [...state.undoStack.slice(-5), cloneUndoSnapshot(state)]
      : state.undoStack

  if (state.phase === 'bidding') {
    if (move.type !== 'bid') {
      return { error: locale === 'zh-CN' ? '当前为叫分阶段' : 'Currently bidding phase' }
    }
    if (move.score !== 0 && move.score <= state.highestBid) {
      return {
        error:
          locale === 'zh-CN'
            ? `叫分必须高于当前最高分 ${state.highestBid} 分，或选择不叫`
            : `Bid must exceed ${state.highestBid} or pass`,
      }
    }

    const nextHighest = move.score > state.highestBid ? move.score : state.highestBid
    const nextBidder = move.score > state.highestBid ? seat : state.highestBidder
    const nextCount = state.bidTurnCount + 1
    const bidLabel =
      move.score === 0
        ? locale === 'zh-CN'
          ? '不叫'
          : 'Pass'
        : locale === 'zh-CN'
          ? `叫 ${move.score} 分`
          : `Bid ${move.score}`

    const nextDisplays = {
      ...state.seatDisplays,
      [seat]: {
        cards: [],
        pass: move.score === 0,
        bidLabel,
        speech: speech || bidLabel,
      },
    }
    const nextHistory = pushHistory(state.recentHistory, {
      seat,
      phase: 'bidding',
      text: `${getSeatLabel(seat, locale)}: ${bidLabel}`,
      bidScore: move.score,
    })

    // 叫到 3 分或三人全部叫完一轮
    if (move.score === 3 || nextCount >= 3) {
      if (nextHighest === 0 || !nextBidder) {
        // 三家都不叫：流局重发一轮
        const redeal = createInitialDoudizhuState(nextSeat(state.firstBidder))
        redeal.undoStack = []
        redeal.recentHistory = [
          {
            seat,
            phase: 'bidding',
            text: locale === 'zh-CN' ? '三家均不叫，已重新发牌' : 'All passed—redealt.',
          },
        ]
        return { nextState: redeal }
      }

      const landlordHands = {
        ...state.hands,
        [nextBidder]: sortHandDesc([...state.hands[nextBidder], ...state.bottomCards]),
      }
      return {
        nextState: {
          ...state,
          phase: 'playing',
          hands: landlordHands,
          currentTurn: nextBidder,
          bidTurnCount: nextCount,
          highestBid: nextHighest,
          highestBidder: nextBidder,
          landlordSeat: nextBidder,
          tablePlay: null,
          passStreak: 0,
          seatDisplays: {
            ...nextDisplays,
            player: { cards: [], pass: false, speech: '' },
            ai_right: { cards: [], pass: false, speech: '' },
            ai_left: { cards: [], pass: false, speech: '' },
          },
          recentHistory: nextHistory,
          undoStack: nextUndo,
        },
      }
    }

    return {
      nextState: {
        ...state,
        currentTurn: nextSeat(seat),
        bidTurnCount: nextCount,
        highestBid: nextHighest,
        highestBidder: nextBidder,
        seatDisplays: nextDisplays,
        recentHistory: nextHistory,
        undoStack: nextUndo,
      },
    }
  }

  // 出牌阶段
  const isLeading = state.tablePlay === null || state.tablePlay.seat === seat

  if (move.type === 'pass') {
    if (isLeading) {
      return {
        error:
          locale === 'zh-CN'
            ? '轮到你先手领出，必须出牌，不能选择不要'
            : 'You have the lead and must play cards',
      }
    }
    const nextPassStreak = state.passStreak + 1
    const resetTable = nextPassStreak >= 2
    const nextTurn = resetTable && state.tablePlay ? state.tablePlay.seat : nextSeat(seat)
    const passText = locale === 'zh-CN' ? '不要' : 'Pass'
    const nextDisplays = {
      ...state.seatDisplays,
      [seat]: { cards: [], pass: true, speech: speech || passText },
    }
    if (resetTable) {
      // 新一轮领出清理之前两家的桌面出牌
      for (const s of SEAT_ORDER) {
        if (s !== seat) {
          nextDisplays[s] = { ...nextDisplays[s], cards: [], pass: false }
        }
      }
    }
    return {
      nextState: {
        ...state,
        currentTurn: nextTurn,
        tablePlay: resetTable ? null : state.tablePlay,
        passStreak: resetTable ? 0 : nextPassStreak,
        seatDisplays: nextDisplays,
        recentHistory: pushHistory(state.recentHistory, {
          seat,
          phase: 'playing',
          text: `${getSeatLabel(seat, locale)}: ${passText}`,
          pass: true,
        }),
        undoStack: nextUndo,
      },
    }
  }

  if (move.type !== 'play') {
    return { error: locale === 'zh-CN' ? '当前为出牌阶段' : 'Currently playing phase' }
  }

  const ownHand = state.hands[seat]
  const pickedCards: Card[] = []
  const usedIds = new Set<string>()
  for (const id of move.cardIds) {
    if (usedIds.has(id)) {
      return { error: locale === 'zh-CN' ? '不能重复使用同一张牌' : 'Duplicate card selected' }
    }
    const found = ownHand.find((c) => c.id === id)
    if (!found) {
      return {
        error:
          locale === 'zh-CN' ? `手牌中不存在牌 ${id}` : `Card ${id} does not exist in current hand`,
      }
    }
    usedIds.add(id)
    pickedCards.push(found)
  }

  const combo = detectCombo(pickedCards)
  if (!combo) {
    return { error: locale === 'zh-CN' ? '所选牌型不合法' : 'Invalid card combination' }
  }
  const activeTarget = isLeading ? null : (state.tablePlay?.combo ?? null)
  if (!canBeatCombo(combo, activeTarget)) {
    return {
      error:
        locale === 'zh-CN'
          ? '所出牌型未能大过桌面上的待压牌'
          : 'Selected combo does not beat current table play',
    }
  }

  const remainingHand = ownHand.filter((c) => !usedIds.has(c.id))
  const nextPlayedByRank = { ...state.playedCountByRank }
  for (const c of pickedCards) {
    nextPlayedByRank[c.rank] = (nextPlayedByRank[c.rank] ?? 0) + 1
  }

  const cardsText = sortHandDesc(pickedCards)
    .map((c) => formatCardToken(c, locale))
    .join(' ')

  const nextDisplays = {
    ...state.seatDisplays,
    [seat]: {
      cards: sortHandDesc(pickedCards),
      pass: false,
      speech: speech || describeComboName(combo.kind, locale),
    },
  }
  if (isLeading) {
    for (const s of SEAT_ORDER) {
      if (s !== seat) {
        nextDisplays[s] = { ...nextDisplays[s], cards: [], pass: false }
      }
    }
  }

  const won = remainingHand.length === 0
  const winnerTeam: DoudizhuState['winnerTeam'] = won
    ? seat === state.landlordSeat
      ? 'landlord'
      : 'peasants'
    : null

  return {
    nextState: {
      ...state,
      phase: won ? 'finished' : 'playing',
      hands: {
        ...state.hands,
        [seat]: remainingHand,
      },
      currentTurn: won ? seat : nextSeat(seat),
      tablePlay: { seat, combo },
      passStreak: 0,
      seatDisplays: nextDisplays,
      playedCountByRank: nextPlayedByRank,
      recentHistory: pushHistory(state.recentHistory, {
        seat,
        phase: 'playing',
        text: `${getSeatLabel(seat, locale)}: ${cardsText}`,
        cards: sortHandDesc(pickedCards),
        comboKind: combo.kind,
      }),
      winnerTeam,
      undoStack: nextUndo,
    },
  }
}

/**
 * 严格信息隔离算牌计算器：仅由总牌堆减去「已打出明牌 + 该 AI 自身手牌」，返回外头未知残牌点数分布。
 */
export const computeCardCountReport = (
  state: DoudizhuState,
  seat: DoudizhuSeatId,
  locale: Locale
): string => {
  const ownByRank = countRanks(state.hands[seat])
  const entries: string[] = []
  for (let rank = 17; rank >= 3; rank -= 1) {
    const total = TOTAL_DECK_COUNT_BY_RANK[rank] ?? 0
    const played = state.playedCountByRank[rank] ?? 0
    const own = ownByRank.get(rank) ?? 0
    const unseen = Math.max(0, total - played - own)
    if (unseen > 0) {
      entries.push(`${rankToLabel(rank, locale)}(${unseen})`)
    }
  }
  return locale === 'zh-CN'
    ? `外头未知残牌分布（仅公开信息减法）：${entries.join('、')}`
    : `Unseen cards outside your hand: ${entries.join(', ')}`
}

/** 把模型返回的文本令牌（兼容 "♠A"、"A♠"、"黑桃A"、"2"、"大王"、"小王"、"BJ"、"10" 等）精准映射回手牌 ID */
export const resolveCardTokensFromHand = (
  hand: readonly Card[],
  rawTokens: unknown[]
): { cardIds: string[] } | { error: string } => {
  const available = [...hand]
  const chosenIds: string[] = []

  const extractSuit = (s: string): { suit?: CardSuit; rest: string } => {
    const suitPrefixes: Array<[string, CardSuit]> = [
      ['黑桃', 'S'],
      ['红桃', 'H'],
      ['红心', 'H'],
      ['梅花', 'C'],
      ['草花', 'C'],
      ['方块', 'D'],
      ['方片', 'D'],
      ['♠', 'S'],
      ['♥', 'H'],
      ['♣', 'C'],
      ['♦', 'D'],
      ['S', 'S'],
      ['H', 'H'],
      ['C', 'C'],
      ['D', 'D'],
    ]
    for (const [token, suit] of suitPrefixes) {
      if (s.startsWith(token)) {
        return { suit, rest: s.slice(token.length).trim() }
      }
      if (s.endsWith(token)) {
        return { suit, rest: s.slice(0, s.length - token.length).trim() }
      }
    }
    return { rest: s }
  }

  const normalizeToken = (raw: string): { rank: number; suit?: CardSuit } | null => {
    const clean = raw.trim().toUpperCase().replace(/\s+/g, ' ')
    if (!clean) {
      return null
    }
    if (
      clean === 'BJ' ||
      clean === 'BIG JOKER' ||
      clean === '大王' ||
      clean === 'RED JOKER' ||
      clean === '17J'
    ) {
      return { rank: 17, suit: 'J' }
    }
    if (
      clean === 'SJ' ||
      clean === 'SMALL JOKER' ||
      clean === '小王' ||
      clean === 'BLACK JOKER' ||
      clean === '16J'
    ) {
      return { rank: 16, suit: 'J' }
    }

    const { suit, rest } = extractSuit(clean)
    const body = rest.replace(/^10$/, '10').trim()

    let rank = 0
    if (body === 'J' || body === '11') {
      rank = 11
    } else if (body === 'Q' || body === '12') {
      rank = 12
    } else if (body === 'K' || body === '13') {
      rank = 13
    } else if (body === 'A' || body === '14' || body === '1') {
      rank = 14
    } else if (body === '2' || body === '15') {
      rank = 15
    } else {
      const n = Number(body)
      if (Number.isInteger(n) && n >= 3 && n <= 10) {
        rank = n
      }
    }
    if (!rank) {
      return null
    }
    return { rank, suit }
  }

  for (const item of rawTokens) {
    if (typeof item !== 'string' && typeof item !== 'number') {
      return { error: `Invalid card token: ${String(item)}` }
    }
    const parsed = normalizeToken(String(item))
    if (!parsed) {
      return { error: `Unrecognized card token: ${String(item)}` }
    }
    const matchIndex = available.findIndex(
      (c) => c.rank === parsed.rank && (!parsed.suit || c.suit === parsed.suit)
    )
    const fallbackIndex =
      matchIndex === -1 ? available.findIndex((c) => c.rank === parsed.rank) : matchIndex
    if (fallbackIndex === -1) {
      return { error: `Card not in hand: ${String(item)}` }
    }
    const [picked] = available.splice(fallbackIndex, 1)
    chosenIds.push(picked.id)
  }

  return { cardIds: chosenIds }
}
