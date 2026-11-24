import { describe, expect, it } from 'vitest'
import {
  applyDoudizhuMove,
  createInitialDoudizhuState,
  detectCombo,
  findBeatCandidates,
  undoDoudizhuRound,
} from '../doudizhu/engine.js'
import type { Card } from '../doudizhu/types.js'
import { isGuessMatch } from '../drawguess/helpers.js'
import { formatGameScoreLabel } from '../history.js'

const mkCards = (specs: Array<[number, 'S' | 'H' | 'C' | 'D' | 'J']>): Card[] =>
  specs.map(([rank, suit], idx) => ({ id: `${rank}${suit}_${idx}`, rank, suit }))

describe('doudizhu & existing minigame fixes', () => {
  it('blocks double-joker wings in four_two_single', () => {
    const fourWithJokers = mkCards([
      [9, 'S'],
      [9, 'H'],
      [9, 'C'],
      [9, 'D'],
      [16, 'J'],
      [17, 'J'],
    ])
    expect(detectCombo(fourWithJokers)).toBeNull()

    const validFourTwo = mkCards([
      [9, 'S'],
      [9, 'H'],
      [9, 'C'],
      [9, 'D'],
      [4, 'S'],
      [16, 'J'],
    ])
    expect(detectCombo(validFourTwo)?.kind).toBe('four_two_single')
  })

  it('finds valid beat candidates for airplanes and 4-with-2 combos', () => {
    const hand = mkCards([
      [4, 'S'],
      [4, 'H'],
      [4, 'C'],
      [5, 'S'],
      [5, 'H'],
      [5, 'C'],
      [8, 'S'],
      [8, 'H'],
      [9, 'S'],
      [9, 'H'],
      [12, 'S'],
      [12, 'H'],
      [12, 'C'],
      [12, 'D'],
    ])

    const targetPlane = detectCombo(
      mkCards([
        [3, 'S'],
        [3, 'H'],
        [3, 'C'],
        [4, 'S'],
        [4, 'H'],
        [4, 'C'],
      ])
    )
    expect(findBeatCandidates(hand, targetPlane).length).toBeGreaterThan(0)

    const targetPlaneSingle = detectCombo(
      mkCards([
        [3, 'S'],
        [3, 'H'],
        [3, 'C'],
        [4, 'S'],
        [4, 'H'],
        [4, 'C'],
        [6, 'S'],
        [7, 'S'],
      ])
    )
    expect(findBeatCandidates(hand, targetPlaneSingle).length).toBeGreaterThan(0)

    const targetPlanePair = detectCombo(
      mkCards([
        [3, 'S'],
        [3, 'H'],
        [3, 'C'],
        [4, 'S'],
        [4, 'H'],
        [4, 'C'],
        [6, 'S'],
        [6, 'H'],
        [7, 'S'],
        [7, 'H'],
      ])
    )
    expect(findBeatCandidates(hand, targetPlanePair).length).toBeGreaterThan(0)

    const targetFourTwoPair = detectCombo(
      mkCards([
        [10, 'S'],
        [10, 'H'],
        [10, 'C'],
        [10, 'D'],
        [3, 'S'],
        [3, 'H'],
        [6, 'S'],
        [6, 'H'],
      ])
    )
    expect(findBeatCandidates(hand, targetFourTwoPair).length).toBeGreaterThan(0)
  })

  it('restores bidTurnCount cleanly on undo during bidding & formats 3-seat history score', () => {
    const init = createInitialDoudizhuState('player')
    expect(formatGameScoreLabel('doudizhu', init, 'playing', 'zh-CN')).toBe(
      '进行中 · 剩牌 17:17:17'
    )

    const bidRes = applyDoudizhuMove(init, 'player', { type: 'bid', score: 1 }, '', 'zh-CN', true)
    expect('nextState' in bidRes).toBe(true)
    if (!('nextState' in bidRes)) {
      return
    }
    expect(bidRes.nextState.bidTurnCount).toBe(1)

    const undone = undoDoudizhuRound(bidRes.nextState)
    expect(undone.bidTurnCount).toBe(0)
    expect(undone.highestBid).toBe(0)
    expect(undone.currentTurn).toBe('player')
  })

  it('prevents partial single-char false positives in DrawGuess isGuessMatch', () => {
    expect(isGuessMatch('蛇', '画蛇添足')).toBe(false)
    expect(isGuessMatch('我猜是画蛇添足！', '画蛇添足')).toBe(true)
    expect(isGuessMatch('画蛇添足', '画蛇添足')).toBe(true)
  })
})
