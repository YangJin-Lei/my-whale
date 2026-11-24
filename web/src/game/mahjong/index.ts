import type { Locale } from '../../services/settings.js'
import type { GameOpponent, GamePlugin, GameSide, GameStatus } from '../types.js'
import {
  applyMahjongMove,
  createInitialMahjongState,
  getDiscardPhaseOptions,
  getDiscardTingMap,
  getTingWaits,
  MAHJONG_SEAT_ORDER,
  parseTileCodeToken,
  pickSmartMahjongMove,
  resolveTileTokenFromHand,
  tileCodeToLabel,
  tileCodeToShortCode,
  undoMahjongRound,
} from './engine.js'
import { MahjongBoard } from './MahjongBoard.js'
import { resolveMahjongSeatOpponent } from './seats.js'
import {
  getMahjongSeatLabel,
  type MahjongMove,
  type MahjongSeatId,
  type MahjongState,
} from './types.js'

const getActiveActor = (state: MahjongState): MahjongSeatId =>
  state.phase === 'claim_window'
    ? (state.pendingClaims[0]?.seat ?? state.currentTurn)
    : state.currentTurn

const formatMeldSummary = (melds: MahjongState['melds'][MahjongSeatId], locale: Locale): string => {
  if (melds.length === 0) {
    return locale === 'zh-CN' ? '无副露' : 'none'
  }
  return melds
    .map((m) => {
      const tag =
        m.kind === 'chi' ? '吃' : m.kind === 'pong' ? '碰' : m.kind === 'angang' ? '暗杠' : '明杠'
      const tiles = m.tiles.map((t) => tileCodeToShortCode(t.code)).join('')
      return `${tag}[${tiles}]`
    })
    .join(' ')
}

export const mahjongGame: GamePlugin<MahjongState, MahjongMove> = {
  id: 'mahjong',
  name: { 'zh-CN': '麻将', 'en-US': 'Mahjong' },
  subtitle: {
    'zh-CN': '四人桌宠搓麻，吃碰杠胡、听牌提示与严格摸打裁判',
    'en-US': '4-seat pet Mahjong with Chow, Pung, Kong, Tenpai hints & Hu',
  },
  badge: { 'zh-CN': '四人搓麻', 'en-US': '4-Player' },
  firstTurn: 'player',
  hideGenericOpponentHeader: true,
  turnTimeoutSec: 60,

  createInitialState: createInitialMahjongState,

  getTurn: (state): GameSide => (getActiveActor(state) === 'player' ? 'player' : 'ai'),

  getStatus: (state): GameStatus => {
    if (state.phase !== 'finished') {
      return 'playing'
    }
    if (!state.winResult) {
      return 'draw'
    }
    return state.winResult.winnerSeat === 'player' ? 'player_win' : 'ai_win'
  },

  getStatusNote: (state, locale) => {
    if (state.phase !== 'finished') {
      return null
    }
    if (!state.winResult) {
      return locale === 'zh-CN' ? '牌山已空，荒庄和局！' : 'Wall exhausted—Draw!'
    }
    const label = getMahjongSeatLabel(state.winResult.winnerSeat, locale)
    return locale === 'zh-CN'
      ? `${label} 胡牌（${state.winResult.fanNames.join('·')} ${state.winResult.totalFan}番）`
      : `${label} wins (${state.winResult.totalFan} Fan)!`
  },

  canUndo: (state) => state.undoStack.length > 0 && state.phase !== 'finished',

  undoRound: undoMahjongRound,

  resolveActiveOpponent: (state, _fallback, locale): GameOpponent => {
    const actor = getActiveActor(state)
    const seat = actor === 'player' ? 'ai_right' : actor
    return resolveMahjongSeatOpponent(seat, locale)
  },

  applyPlayerMove: (state, move, locale) =>
    applyMahjongMove(state, 'player', move, '', locale, true),

  applyAiMove: (state, move, speech = '', locale = 'zh-CN') => {
    const actor = getActiveActor(state)
    const res = applyMahjongMove(state, actor, move, speech, locale, false)
    if ('error' in res) {
      return { nextState: state }
    }
    return res
  },

  handleTimeout: (state, _side, locale) => {
    if (state.phase === 'finished') {
      return null
    }
    const actor = getActiveActor(state)
    if (state.phase === 'claim_window') {
      const hasHu = state.pendingClaims[0]?.options.some((o) => o.type === 'hu')
      const move: MahjongMove = hasHu ? { type: 'hu' } : { type: 'pass' }
      const speech = hasHu
        ? locale === 'zh-CN'
          ? '胡！'
          : 'Hu!'
        : locale === 'zh-CN'
          ? '超时自动过。'
          : 'Timed out—pass.'
      const res = applyMahjongMove(state, actor, move, speech, locale, false)
      return 'nextState' in res ? { nextState: res.nextState, speech } : null
    }

    const fallback = pickSmartMahjongMove(state)
    if (!fallback) {
      return null
    }
    const speech = locale === 'zh-CN' ? '超时自动摸打。' : 'Timed out—auto discard.'
    const res = applyMahjongMove(state, actor, fallback, speech, locale, false)
    return 'nextState' in res ? { nextState: res.nextState, speech } : null
  },

  buildAiPrompt: (state, opponent, locale) => {
    const seat = getActiveActor(state)
    const ownHand = state.hands[seat]
    const handCodes = ownHand.map((t) => tileCodeToShortCode(t.code)).join(' ')
    const handZh = ownHand.map((t) => tileCodeToLabel(t.code, 'zh-CN')).join(' ')

    const publicSeats = MAHJONG_SEAT_ORDER.map((s) => {
      const melds = formatMeldSummary(state.melds[s], locale)
      const discards = state.discards[s].map((t) => tileCodeToShortCode(t.code)).join(' ')
      return `${getMahjongSeatLabel(s, locale)}(余${state.hands[s].length}张) 副露:${melds} | 牌河:${discards || '空'}`
    }).join('\n')

    const recentText = state.recentLogs.slice(-8).join('\n') || '（暂无）'

    if (state.phase === 'claim_window') {
      const claim = state.pendingClaims[0]
      const targetTile = state.lastDiscard?.tile
      const targetLabel = targetTile
        ? `${tileCodeToLabel(targetTile.code, 'zh-CN')}(${tileCodeToShortCode(targetTile.code)})`
        : '?'
      const optStrings: string[] = ['"pass"']
      if (claim) {
        for (const opt of claim.options) {
          if (opt.type === 'hu') {
            optStrings.unshift('"hu"')
          } else if (opt.type === 'gang') {
            optStrings.push('"gang"')
          } else if (opt.type === 'pong') {
            optStrings.push('"pong"')
          } else if (opt.type === 'chi') {
            optStrings.push(
              `"chi:${tileCodeToShortCode(opt.useCodes[0])},${tileCodeToShortCode(opt.useCodes[1])}"`
            )
          }
        }
      }

      const systemPrompt =
        locale === 'zh-CN'
          ? `你正在四人麻将桌上扮演「${opponent.name}」（${opponent.systemPrompt}），座位是 ${getMahjongSeatLabel(seat, locale)}。\n牌代码格式：万=1m~9m、条=1s~9s、筒=1p~9p、东南西北=E/S/W/N、中发白=Z/F/B。\n严禁在 speech 里泄露你手牌或听牌内容！只输出纯 JSON：{"move":"<可选项之一>", "thoughtSummary":"简短理由", "speech":"拟真口语短台词"}`
          : `You are ${opponent.name} playing 4-player Mahjong at ${getMahjongSeatLabel(seat, locale)}. Return ONLY JSON: {"move": <option>, "thoughtSummary":"...", "speech":"..."}. Never leak hidden hand tiles in speech.`

      const userPrompt = `待响应打出的牌：${targetLabel}\n你的暗牌(${ownHand.length}张)：${handCodes}（${handZh}）\n牌山剩余：${state.wall.length} 张\n四家公开桌面：\n${publicSeats}\n最近记录：\n${recentText}\n合法选项：${optStrings.join(' | ')}`

      return {
        systemPrompt,
        userPrompt,
        legalExamples: optStrings.map((s) => s.replace(/"/g, '')),
      }
    }

    const opts = getDiscardPhaseOptions(state, seat)
    const tingMap = getDiscardTingMap(ownHand, state.melds[seat].length)
    const tingHints: string[] = []
    for (const [code, waits] of tingMap.entries()) {
      tingHints.push(
        `打${tileCodeToShortCode(code)}听[${waits.map((w) => tileCodeToShortCode(w)).join(',')}]`
      )
    }
    const directTing = getTingWaits(ownHand, state.melds[seat].length)
    const extraActions: string[] = []
    if (opts.canHu) {
      extraActions.push('"hu"')
    }
    for (const c of opts.angangCodes) {
      extraActions.push(`"angang:${tileCodeToShortCode(c)}"`)
    }
    for (const c of opts.bugangCodes) {
      extraActions.push(`"bugang:${tileCodeToShortCode(c)}"`)
    }

    const uniqueHandCodes = Array.from(new Set(ownHand.map((t) => tileCodeToShortCode(t.code))))
    const legalMovesList = [
      ...extraActions.map((s) => s.replace(/"/g, '')),
      ...uniqueHandCodes.map((c) => `discard:${c}`),
    ]

    const systemPrompt =
      locale === 'zh-CN'
        ? `你正在四人麻将桌上扮演「${opponent.name}」（${opponent.systemPrompt}），座位是 ${getMahjongSeatLabel(seat, locale)}。\n牌代码：万=1m~9m、条=1s~9s、筒=1p~9p、东南西北=E/S/W/N、中发白=Z/F/B。\n策略优先级：能自摸胡牌必选 "hu"；其次保留搭子/听牌最多张数；防守时避开别家危险生张。\n绝密红线：speech 台词绝不能剧透手里的暗牌或听什么牌！\n只输出纯 JSON：{"move":"discard:5m"或"hu"或"angang:3p", "thoughtSummary":"15-35字搭子拆解分析", "speech":"自然口语台词（不含牌代码）"}`
        : `You are ${opponent.name} playing Mahjong at ${getMahjongSeatLabel(seat, locale)}. Codes: 1m-9m, 1s-9s, 1p-9p, E/S/W/N/Z/F/B. Return ONLY JSON: {"move":"discard:5m"|"hu"|"angang:3p", "thoughtSummary":"...", "speech":"..."}. Never leak hidden hand/waits in speech.`

    const userPrompt = [
      `你的暗牌(${ownHand.length}张)：${handCodes}（${handZh}）`,
      state.lastDrawnId
        ? `刚刚摸入：${tileCodeToShortCode(ownHand.find((t) => t.id === state.lastDrawnId)?.code ?? 0)}`
        : '',
      tingHints.length > 0 ? `当前可听牌选打：${tingHints.slice(0, 6).join('；')}` : '',
      directTing.length > 0 ? `已听牌待胡：${directTing.map(tileCodeToShortCode).join(',')}` : '',
      `牌山剩余：${state.wall.length} 张`,
      `四家公开桌面：\n${publicSeats}`,
      `最近记录：\n${recentText}`,
      `合法操作：${extraActions.length > 0 ? `${extraActions.join('、')} 或 ` : ''}从手牌打出一张 discard:<代码>（例如 discard:${uniqueHandCodes[uniqueHandCodes.length - 1] ?? '5m'}）`,
    ]
      .filter(Boolean)
      .join('\n\n')

    return {
      systemPrompt,
      userPrompt,
      legalExamples: legalMovesList.slice(0, 12),
    }
  },

  parseAndValidateAiMove: (state, rawMove, locale) => {
    const actor = getActiveActor(state)
    const str =
      typeof rawMove === 'string'
        ? rawMove.trim()
        : typeof rawMove === 'object' && rawMove !== null
          ? String(
              (rawMove as { move?: unknown; action?: unknown; tile?: unknown }).move ??
                (rawMove as { action?: unknown }).action ??
                (rawMove as { tile?: unknown }).tile ??
                ''
            ).trim()
          : ''

    if (!str) {
      return {
        valid: false,
        reason: locale === 'zh-CN' ? '请返回合法的麻将操作指令' : 'Empty Mahjong move',
      }
    }

    const lower = str.toLowerCase()
    let candidate: MahjongMove | null = null

    if (lower === 'hu' || str === '胡' || str === '自摸') {
      candidate = { type: 'hu' }
    } else if (lower === 'pass' || str === '过') {
      candidate = { type: 'pass' }
    } else if (lower === 'pong' || lower === 'peng' || str === '碰') {
      candidate = { type: 'pong' }
    } else if (lower === 'gang' || lower === 'kong' || str === '杠' || str === '明杠') {
      candidate = { type: 'gang' }
    } else if (lower.startsWith('chi:') || str.startsWith('吃:')) {
      const body = str.slice(str.indexOf(':') + 1)
      const parts = body
        .split(/[\s,，/]+/)
        .map((s) => parseTileCodeToken(s))
        .filter((x): x is number => x !== null)
      if (parts.length === 2) {
        candidate = { type: 'chi', useCodes: [parts[0], parts[1]] }
      }
    } else if (lower.startsWith('angang:')) {
      const code = parseTileCodeToken(str.slice(str.indexOf(':') + 1))
      if (code !== null) {
        candidate = { type: 'angang', code }
      }
    } else if (lower.startsWith('bugang:')) {
      const code = parseTileCodeToken(str.slice(str.indexOf(':') + 1))
      if (code !== null) {
        candidate = { type: 'bugang', code }
      }
    } else {
      const token = lower.startsWith('discard:') ? str.slice(str.indexOf(':') + 1) : str
      const tile = resolveTileTokenFromHand(state.hands[actor], token)
      if (tile) {
        candidate = { type: 'discard', tileId: tile.id }
      }
    }

    if (!candidate) {
      return {
        valid: false,
        reason:
          locale === 'zh-CN'
            ? `无法解析麻将指令「${str}」，示例：discard:5m / hu / pong / pass`
            : `Cannot parse Mahjong move "${str}"`,
      }
    }

    const test = applyMahjongMove(state, actor, candidate, '', locale, false)
    if ('error' in test) {
      return { valid: false, reason: test.error }
    }
    return { valid: true, move: candidate }
  },

  pickFallbackMove: pickSmartMahjongMove,

  BoardComponent: MahjongBoard,
}
