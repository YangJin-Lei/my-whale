import { describe, expect, it } from 'vitest'
import {
  applyMahjongMove,
  canHu,
  createInitialMahjongState,
  createShuffledMahjongDeck,
  getDiscardTingMap,
  getTingWaits,
  undoMahjongRound,
} from '../mahjong/engine.js'
import type { MahjongTile } from '../mahjong/types.js'

const tiles = (codes: number[]): MahjongTile[] =>
  codes.map((code, idx) => ({ id: `t_${idx}_${code}`, code }))

describe('mahjong engine', () => {
  it('builds a standard 136-tile deck (34 kinds x 4 copies)', () => {
    const deck = createShuffledMahjongDeck()
    expect(deck).toHaveLength(136)
    const counts = new Map<number, number>()
    for (const t of deck) {
      counts.set(t.code, (counts.get(t.code) ?? 0) + 1)
    }
    expect(counts.size).toBe(34)
    expect([...counts.values()].every((c) => c === 4)).toBe(true)
  })

  it('recognizes standard winning hands, open-meld wins, seven pairs, and rejects invalid hands', () => {
    // 1m2m3m 4s5s6s 7p8p9p EEE ZZ
    const standardWin = tiles([0, 1, 2, 12, 13, 14, 24, 25, 26, 27, 27, 27, 31, 31])
    expect(canHu(standardWin, 0)).toBe(true)

    // 1 open meld + 3 closed melds + 1 pair = 11 closed tiles
    const openMeldWin = tiles([0, 1, 2, 12, 13, 14, 24, 25, 26, 31, 31])
    expect(canHu(openMeldWin, 1)).toBe(true)

    // 七对 (7 pairs)
    const sevenPairs = tiles([0, 0, 2, 2, 9, 9, 11, 11, 18, 18, 27, 27, 31, 31])
    expect(canHu(sevenPairs, 0)).toBe(true)

    // 非胡牌散牌
    const notWin = tiles([0, 2, 4, 6, 8, 9, 11, 13, 15, 17, 18, 27, 28, 31])
    expect(canHu(notWin, 0)).toBe(false)
  })

  it('computes exact Tenpai waits and discard-to-Ting mappings', () => {
    // 1m2m3m 4m5m6m 7m8m9m 2p3p4p + 5p (13 tiles waiting on 2p=19 or 5p=22)
    const readyHand = tiles([0, 1, 2, 3, 4, 5, 6, 7, 8, 19, 20, 21, 22])
    expect(getTingWaits(readyHand, 0)).toEqual([19, 22])

    // 14 tiles: 13 above + extra East (27) -> discarding East yields waits [19, 22]
    const fourteen = [...readyHand, { id: 'extra_e', code: 27 }]
    const tingMap = getDiscardTingMap(fourteen, 0)
    expect(tingMap.get(27)).toEqual([19, 22])
  })

  it('handles claim windows, pong/pass progression, empty-wall draw, and undo', () => {
    const initial = createInitialMahjongState()
    expect(initial.hands.player).toHaveLength(14)
    expect(initial.wall).toHaveLength(83)

    // Construct controlled claim window where ai_right can pong 1m(code 0)
    const controlled = createInitialMahjongState()
    const discardTile: MahjongTile = { id: 'p_disc_0', code: 0 }
    controlled.hands.player = [
      discardTile,
      ...tiles([9, 10, 11, 12, 13, 14, 15, 16, 17, 27, 28, 29, 30]),
    ]
    controlled.hands.ai_right = tiles([0, 0, 2, 3, 4, 18, 19, 20, 21, 22, 23, 28, 29])
    controlled.hands.ai_across = tiles([1, 2, 3, 4, 5, 6, 7, 8, 18, 19, 20, 24, 25])
    controlled.hands.ai_left = tiles([3, 4, 5, 6, 7, 8, 9, 10, 11, 15, 16, 17, 32])

    const afterPlayerDiscard = applyMahjongMove(
      controlled,
      'player',
      { type: 'discard', tileId: discardTile.id },
      '',
      'zh-CN',
      true
    )
    expect('nextState' in afterPlayerDiscard).toBe(true)
    if (!('nextState' in afterPlayerDiscard)) {
      return
    }
    const s1 = afterPlayerDiscard.nextState
    expect(s1.phase).toBe('claim_window')
    expect(s1.pendingClaims[0]?.seat).toBe('ai_right')
    expect(s1.pendingClaims[0]?.options.some((o) => o.type === 'pong')).toBe(true)

    // Undo brings player cleanly back to before discarding
    const undone = undoMahjongRound(s1)
    expect(undone.phase).toBe('playing_discard')
    expect(undone.hands.player).toHaveLength(14)

    // If claim queue passes with empty wall, ends in draw
    const emptyWallState = { ...s1, wall: [] }
    const passAll = applyMahjongMove(
      emptyWallState,
      'ai_right',
      { type: 'pass' },
      '',
      'zh-CN',
      false
    )
    expect('nextState' in passAll).toBe(true)
    if ('nextState' in passAll) {
      expect(passAll.nextState.phase).toBe('finished')
      expect(passAll.nextState.winResult).toBeNull()
    }
  })
})
