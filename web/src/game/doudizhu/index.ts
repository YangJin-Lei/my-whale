import type { Locale } from '../../services/settings.js'
import type { GameOpponent, GamePlugin, GameSide, GameStatus } from '../types.js'
import { DoudizhuBoard } from './DoudizhuBoard.js'
import {
  applyDoudizhuMove,
  computeCardCountReport,
  createInitialDoudizhuState,
  describeComboName,
  detectCombo,
  findBeatCandidates,
  formatCardToken,
  resolveCardTokensFromHand,
} from './engine.js'
import { resolveDoudizhuSeatOpponent } from './seats.js'
import type { DoudizhuMove, DoudizhuSeatId, DoudizhuState } from './types.js'

const getActiveSeat = (state: DoudizhuState): DoudizhuSeatId => state.currentTurn

const getSeatRoleTag = (state: DoudizhuState, seat: DoudizhuSeatId, locale: Locale): string => {
  if (!state.landlordSeat) {
    return locale === 'zh-CN' ? '叫分中' : 'Bidding'
  }
  if (state.landlordSeat === seat) {
    return locale === 'zh-CN' ? '地主' : 'Landlord'
  }
  return locale === 'zh-CN' ? '农民' : 'Peasant'
}

const describeSeatForAi = (
  viewer: DoudizhuSeatId,
  target: DoudizhuSeatId,
  locale: Locale
): string => {
  if (target === viewer) {
    return locale === 'zh-CN' ? '你自己' : 'Yourself'
  }
  if (target === 'player') {
    return locale === 'zh-CN' ? '人类玩家' : 'Human Player'
  }
  return locale === 'zh-CN'
    ? target === 'ai_right'
      ? '右家电脑'
      : '左家电脑'
    : target === 'ai_right'
      ? 'Right Bot'
      : 'Left Bot'
}

export const doudizhuGame: GamePlugin<DoudizhuState, DoudizhuMove> = {
  id: 'doudizhu',
  name: { 'zh-CN': '斗地主', 'en-US': 'Dou Dizhu' },
  subtitle: {
    'zh-CN': '三人对坐桌宠牌局，叫分抢地主、算牌限 5 次、限时 60 秒',
    'en-US': '3-seat pet card table with bidding, 5-count limit & 60s timer',
  },
  badge: { 'zh-CN': '三人博弈', 'en-US': '3-Player' },
  firstTurn: 'player',
  hideGenericOpponentHeader: true,
  turnTimeoutSec: 60,

  createInitialState: () => createInitialDoudizhuState('player'),

  getTurn: (state): GameSide => (state.currentTurn === 'player' ? 'player' : 'ai'),

  getStatus: (state): GameStatus => {
    if (state.phase !== 'finished' || !state.winnerTeam) {
      return 'playing'
    }
    const playerIsLandlord = state.landlordSeat === 'player'
    if (state.winnerTeam === 'landlord') {
      return playerIsLandlord ? 'player_win' : 'ai_win'
    }
    return playerIsLandlord ? 'ai_win' : 'player_win'
  },

  getStatusNote: (state, locale) => {
    if (state.phase === 'finished' && state.winnerTeam) {
      if (locale === 'zh-CN') {
        return state.winnerTeam === 'landlord' ? '地主率先出完，地主获胜！' : '农民联手获胜！'
      }
      return state.winnerTeam === 'landlord' ? 'Landlord wins!' : 'Peasants win!'
    }
    return null
  },

  canUndo: (state) => state.undoStack.length > 0 && state.phase !== 'finished',

  undoRound: (state) => {
    const snap = state.undoStack[state.undoStack.length - 1]
    if (!snap) {
      return state
    }
    return {
      ...state,
      phase: snap.phase,
      hands: snap.hands,
      bottomCards: snap.bottomCards,
      currentTurn: snap.currentTurn,
      highestBid: snap.highestBid,
      highestBidder: snap.highestBidder,
      landlordSeat: snap.landlordSeat,
      tablePlay: snap.tablePlay,
      passStreak: snap.passStreak,
      seatDisplays: snap.seatDisplays,
      playedCountByRank: snap.playedCountByRank,
      cardCountBudgetLeft: snap.cardCountBudgetLeft,
      recentHistory: snap.recentHistory,
      winnerTeam: null,
      undoStack: state.undoStack.slice(0, -1),
    }
  },

  resolveActiveOpponent: (state, _fallback, locale): GameOpponent => {
    const seat = state.currentTurn === 'ai_left' ? 'ai_left' : 'ai_right'
    return resolveDoudizhuSeatOpponent(seat, locale)
  },

  applyPlayerMove: (state, move, locale) =>
    applyDoudizhuMove(state, 'player', move, '', locale, true),

  applyAiMove: (state, move, speech = '', locale = 'zh-CN') => {
    const seat = getActiveSeat(state)
    const formattedSpeech = doudizhuGame.formatMoveSpeech
      ? doudizhuGame.formatMoveSpeech(state, move, speech, locale)
      : speech
    const result = applyDoudizhuMove(state, seat, move, formattedSpeech, locale, false)
    if ('error' in result) {
      return { nextState: state }
    }
    return result
  },

  formatMoveSpeech: (stateBefore, move, rawSpeech, locale) => {
    if (move.type === 'bid') {
      if (rawSpeech) {
        return rawSpeech
      }
      if (locale === 'zh-CN') {
        return move.score === 0 ? '牌一般，不叫。' : `我叫 ${move.score} 分！`
      }
      return move.score === 0 ? 'Pass.' : `Bid ${move.score}!`
    }

    if (move.type === 'pass') {
      return rawSpeech || (locale === 'zh-CN' ? '要不起，过！' : 'Pass!')
    }

    const seat = stateBefore.currentTurn
    const picked = stateBefore.hands[seat].filter((c) => move.cardIds.includes(c.id))
    const combo = detectCombo(picked)
    const leftCount = stateBefore.hands[seat].length - picked.length

    if (combo?.kind === 'rocket' && !/王炸|火箭|rocket/i.test(rawSpeech)) {
      return locale === 'zh-CN' ? '王炸！谁要？' : 'Rocket! Who can beat that?'
    }
    if (combo?.kind === 'bomb' && !/炸/.test(rawSpeech)) {
      return locale === 'zh-CN' ? '四个头炸了，谁还管得上？' : 'Bomb! Beat this!'
    }

    let line = rawSpeech || (combo ? describeComboName(combo.kind, locale) : '')
    if (leftCount === 1 && !/剩一|最后一张|last card/i.test(line)) {
      line = locale === 'zh-CN' ? `${line} 最后一张！` : `${line} Last card!`
    } else if (leftCount === 2 && !/两张|two cards/i.test(line)) {
      line = locale === 'zh-CN' ? `${line} 就剩两张咯！` : `${line} Two left!`
    }
    return line.trim()
  },

  handleTimeout: (state, side, locale) => {
    if (state.phase === 'finished') {
      return null
    }
    const seat: DoudizhuSeatId =
      side === 'player' ? 'player' : state.currentTurn === 'player' ? 'ai_right' : state.currentTurn
    if (state.currentTurn !== seat) {
      return null
    }

    if (state.phase === 'bidding') {
      const speech = locale === 'zh-CN' ? '超时了，这手不叫！' : 'Timed out, pass.'
      const res = applyDoudizhuMove(state, seat, { type: 'bid', score: 0 }, speech, locale, false)
      return 'nextState' in res ? { nextState: res.nextState, speech } : null
    }

    const isLeading = state.tablePlay === null || state.tablePlay.seat === seat
    if (!isLeading) {
      const speech = locale === 'zh-CN' ? '想太久了，这手不要，过！' : 'Timed out—pass!'
      const res = applyDoudizhuMove(state, seat, { type: 'pass' }, speech, locale, false)
      return 'nextState' in res ? { nextState: res.nextState, speech } : null
    }

    const ownHand = state.hands[seat]
    const smallest = ownHand[ownHand.length - 1]
    if (!smallest) {
      return null
    }
    const speech = locale === 'zh-CN' ? '超时自动出最小牌。' : 'Timed out—auto play.'
    const res = applyDoudizhuMove(
      state,
      seat,
      { type: 'play', cardIds: [smallest.id] },
      speech,
      locale,
      false
    )
    return 'nextState' in res ? { nextState: res.nextState, speech } : null
  },

  processAiControlAction: (state, rawJson, locale) => {
    const wantsCount =
      rawJson.action === 'count_cards' ||
      rawJson.move === 'count_cards' ||
      rawJson.needCountCards === true

    if (!wantsCount || state.phase !== 'playing') {
      return { handled: false }
    }

    if (state.cardCountBudgetLeft <= 0) {
      return {
        handled: true,
        nextState: state,
        refereeMessage:
          locale === 'zh-CN'
            ? '本局 AI 算牌次数已全部用尽（0/5）。请你直接根据当前手牌与近期出牌记录给出最终出牌决策 JSON。'
            : 'Card-counting budget exhausted (0/5). Decide your move directly from visible play history and return move JSON.',
      }
    }

    const nextState: DoudizhuState = {
      ...state,
      cardCountBudgetLeft: state.cardCountBudgetLeft - 1,
    }
    const report = computeCardCountReport(nextState, nextState.currentTurn, locale)
    return {
      handled: true,
      nextState,
      refereeMessage:
        locale === 'zh-CN'
          ? `【算牌成功，本局剩余算牌次数：${nextState.cardCountBudgetLeft}/5】${report}。现在请立刻返回你的出牌 JSON（{"move":..., "thoughtSummary":"...", "speech":"..."}）。`
          : `[Count cards ok, budget left: ${nextState.cardCountBudgetLeft}/5] ${report}. Now return your move JSON immediately.`,
    }
  },

  buildAiPrompt: (state, opponent, locale) => {
    const seat = getActiveSeat(state)
    const ownHand = state.hands[seat]
    const handStr = ownHand.map((c) => formatCardToken(c, locale)).join(' ')
    const seatCounts = (['player', 'ai_right', 'ai_left'] as const)
      .map(
        (s) =>
          `${describeSeatForAi(seat, s, locale)}(${getSeatRoleTag(state, s, locale)}): ${state.hands[s].length}张`
      )
      .join(' | ')

    const recentText =
      state.recentHistory.length > 0
        ? state.recentHistory.map((h) => h.text).join('\n')
        : locale === 'zh-CN'
          ? '（暂无）'
          : '(none)'

    if (state.phase === 'bidding') {
      const legalBids = [0, 1, 2, 3].filter((s) => s === 0 || s > state.highestBid)
      const systemPrompt =
        locale === 'zh-CN'
          ? `你正在三人斗地主牌桌上扮演「${opponent.name}」（${opponent.systemPrompt}）。现在是叫地主阶段，你不知道另外两家的暗牌。\n请严格只输出一个 JSON 对象：{"move": <整数 0/1/2/3，0代表不叫>, "thoughtSummary":"简短评估", "speech":"真人叫牌台词（不加Emoji、不提JSON）"}。`
          : `You are ${opponent.name} (${opponent.systemPrompt}) in a 3-player Dou Dizhu bidding round. Return ONLY JSON: {"move": 0|1|2|3, "thoughtSummary":"...", "speech":"..."}.`

      const userPrompt =
        locale === 'zh-CN'
          ? `你的手牌（17张）：${handStr}\n当前最高叫分：${state.highestBid} 分\n合法叫分选项：${legalBids.join(', ')}\n近期记录：\n${recentText}`
          : `Your hand (17): ${handStr}\nCurrent highest bid: ${state.highestBid}\nLegal bids: ${legalBids.join(', ')}\nRecent:\n${recentText}`

      return {
        systemPrompt,
        userPrompt,
        legalExamples: legalBids.map(String),
      }
    }

    const isLandlord = state.landlordSeat === seat
    const isLeading = state.tablePlay === null || state.tablePlay.seat === seat
    const bottomText = state.bottomCards.map((c) => formatCardToken(c, locale)).join(' ')
    const tableStr =
      !isLeading && state.tablePlay
        ? `${describeSeatForAi(seat, state.tablePlay.seat, locale)}（${getSeatRoleTag(
            state,
            state.tablePlay.seat,
            locale
          )}）打出 ${describeComboName(
            state.tablePlay.combo.kind,
            locale
          )} [${state.tablePlay.combo.cards.map((c) => formatCardToken(c, locale)).join(' ')}]`
        : locale === 'zh-CN'
          ? '无（轮到你自己先手领出，必须出牌，不得不要）'
          : 'None (your lead—must play cards, cannot pass)'

    const landlordLabel = describeSeatForAi(seat, state.landlordSeat ?? 'player', locale)
    const relationHint = isLandlord
      ? locale === 'zh-CN'
        ? '你的身份是【地主】，独战两位农民，争取最快走完手牌。'
        : 'You are Landlord vs 2 Peasants.'
      : locale === 'zh-CN'
        ? `你的身份是【农民】，地主是「${landlordLabel}」。只有另一位【农民】才是你的队友；地主出了牌要积极顶牌或抢牌权，不要白白放地主走完！`
        : `You are Peasant; Landlord is ${landlordLabel}. Beat Landlord plays aggressively when possible, and only pass to let your Peasant teammate run.`

    const candidates = findBeatCandidates(
      ownHand,
      isLeading ? null : (state.tablePlay?.combo ?? null)
    )
    const examples = candidates
      .slice(0, 8)
      .map((grp) => JSON.stringify(grp.map((c) => formatCardToken(c, locale))))

    const candidatesHint =
      examples.length > 0
        ? locale === 'zh-CN'
          ? `\n可直接出牌参考（按此数组格式填写 move）：${examples.join(' 、 ')}`
          : `\nLegal play options (use array in move): ${examples.join(' , ')}`
        : locale === 'zh-CN'
          ? '\n当前手牌没有大过桌面的常规牌型，请选择 {"move":"pass",...}。'
          : '\nNo beating plays available—choose {"move":"pass",...}.'

    const countHint =
      state.cardCountBudgetLeft > 0
        ? locale === 'zh-CN'
          ? `\n（可选：本局全桌 AI 算牌还剩 ${state.cardCountBudgetLeft}/5 次，如确需统计外头残牌可返回 {"action":"count_cards"}；建议多数常规回合直接出牌。）`
          : `\n(Optional card count: ${state.cardCountBudgetLeft}/5 left via {"action":"count_cards"}, or play directly.)`
        : locale === 'zh-CN'
          ? '\n（本局算牌次数已用完 0/5，请直接决策）'
          : '\n(Card-count budget 0/5 exhausted)'

    const systemPrompt =
      locale === 'zh-CN'
        ? `你正在三人斗地主牌桌上扮演「${opponent.name}」（${opponent.systemPrompt}）。\n${relationHint}\n出牌规则与保密红线：
1. 若要出牌，JSON 中 move 必须写成牌数组，例如 {"move":["♠A","♥A"], "thoughtSummary":"...", "speech":"..."}；
2. 只有决定不出（不要）时，才写 {"move":"pass", ...}；
3. 严禁出现 speech 里喊着要出牌/压牌，但 move 却写了 "pass" 的矛盾情况；
4. 绝密底牌红线：speech 台词是当场说给所有对手和队友听的，绝对禁止在 speech 里剧透自己手里还没打出的具体大牌/底牌（绝不能说“我手里还有小王/大王/三个2/炸弹留着压轴”等泄底内容）！`
        : `You are ${opponent.name} (${opponent.systemPrompt}) playing Dou Dizhu. ${relationHint}\nReturn ONLY JSON: {"move":["♠A"], "thoughtSummary":"...", "speech":"..."} or {"move":"pass", "thoughtSummary":"...", "speech":"..."}. Never say you are playing cards in speech while setting move to "pass". STRICT RULE: NEVER reveal your unplayed cards (jokers, 2s, bombs, etc.) in speech.`

    const userPrompt =
      locale === 'zh-CN'
        ? `你的手牌（${ownHand.length}张）：${handStr}\n公开底牌：${bottomText}\n三家身份与余牌：${seatCounts}\n当前桌面待压牌：${tableStr}${candidatesHint}\n近期出牌：\n${recentText}${countHint}`
        : `Your hand (${ownHand.length}): ${handStr}\nKitty: ${bottomText}\nSeats: ${seatCounts}\nTable: ${tableStr}${candidatesHint}\nRecent:\n${recentText}${countHint}`

    return {
      systemPrompt,
      userPrompt,
      legalExamples: isLeading ? examples : [...examples, '"pass"'],
    }
  },

  parseAndValidateAiMove: (state, rawMove, locale) => {
    const seat = getActiveSeat(state)
    if (state.phase === 'bidding') {
      const score = Number(rawMove)
      if (!Number.isInteger(score) || score < 0 || score > 3) {
        return {
          valid: false,
          reason:
            locale === 'zh-CN'
              ? '叫分阶段 move 必须是整数 0、1、2 或 3'
              : 'Bid must be integer 0, 1, 2, or 3',
        }
      }
      const typed = score as 0 | 1 | 2 | 3
      if (typed !== 0 && typed <= state.highestBid) {
        return {
          valid: false,
          reason:
            locale === 'zh-CN'
              ? `必须大于当前最高分 ${state.highestBid} 或返回 0 不叫`
              : `Bid must exceed ${state.highestBid} or return 0`,
        }
      }
      return { valid: true, move: { type: 'bid', score: typed } }
    }

    const isLeading = state.tablePlay === null || state.tablePlay.seat === seat
    if (
      rawMove === 'pass' ||
      rawMove === 'PASS' ||
      rawMove === '不要' ||
      rawMove === '过' ||
      (Array.isArray(rawMove) && rawMove.length === 0)
    ) {
      if (isLeading) {
        return {
          valid: false,
          reason:
            locale === 'zh-CN'
              ? '当前轮到你先手领出，必须出牌，不能选择 pass'
              : 'You have lead and cannot pass',
        }
      }
      return { valid: true, move: { type: 'pass' } }
    }

    let tokens: unknown[] | null = null
    if (Array.isArray(rawMove)) {
      tokens = rawMove
    } else if (typeof rawMove === 'string') {
      tokens = rawMove
        .split(/[\s,，、]+/)
        .map((s) => s.trim())
        .filter(Boolean)
    } else if (
      typeof rawMove === 'object' &&
      rawMove !== null &&
      Array.isArray((rawMove as { cards?: unknown }).cards)
    ) {
      tokens = (rawMove as { cards: unknown[] }).cards
    }

    if (!tokens || tokens.length === 0) {
      return {
        valid: false,
        reason:
          locale === 'zh-CN'
            ? '出牌阶段 move 必须是牌数组（例如 ["♠A"]）或 "pass"'
            : 'Play move must be a card token array or "pass"',
      }
    }

    const resolved = resolveCardTokensFromHand(state.hands[seat], tokens)
    if ('error' in resolved) {
      return { valid: false, reason: resolved.error }
    }

    const picked = state.hands[seat].filter((c) => resolved.cardIds.includes(c.id))
    const combo = detectCombo(picked)
    if (!combo) {
      return {
        valid: false,
        reason:
          locale === 'zh-CN'
            ? '所选牌组合不符合斗地主合法牌型'
            : 'Selected cards do not form a legal combo',
      }
    }

    const target = isLeading ? null : (state.tablePlay?.combo ?? null)
    const testResult = applyDoudizhuMove(
      state,
      seat,
      { type: 'play', cardIds: resolved.cardIds },
      '',
      locale
    )
    if ('error' in testResult) {
      return { valid: false, reason: testResult.error }
    }
    void target
    return { valid: true, move: { type: 'play', cardIds: resolved.cardIds } }
  },

  pickFallbackMove: (state) => {
    const seat = getActiveSeat(state)
    if (state.phase === 'bidding') {
      return { type: 'bid', score: 0 }
    }
    const isLeading = state.tablePlay === null || state.tablePlay.seat === seat
    if (!isLeading) {
      return { type: 'pass' }
    }
    const hand = state.hands[seat]
    const smallest = hand[hand.length - 1]
    return smallest ? { type: 'play', cardIds: [smallest.id] } : null
  },

  BoardComponent: DoudizhuBoard,
}
