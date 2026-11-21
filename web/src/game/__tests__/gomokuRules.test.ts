import { describe, expect, it } from 'vitest'
import { gomokuRules, type GomokuState } from '../gomoku/engine.js'

const createState = (): GomokuState => gomokuRules.createInitialState()

const play = (state: GomokuState, row: number, col: number): GomokuState => {
  const result = gomokuRules.applyPlayerMove(state, { row, col }, 'zh-CN')
  if (!('nextState' in result)) {
    throw new Error(result.error)
  }
  return result.nextState
}

const reply = (state: GomokuState, row: number, col: number): GomokuState =>
  gomokuRules.applyAiMove(state, { row, col }).nextState

describe('gomoku rules', () => {
  it('detects a five-in-a-row and records the winning line', () => {
    let state = createState()
    for (let col = 0; col < 5; col += 1) {
      state = play(state, 7, col)
      if (col < 4) {
        state = reply(state, 0, col)
      }
    }

    expect(state.status).toBe('player_win')
    expect(state.winLine).toHaveLength(5)
    expect(state.history.at(-1)).toMatchObject({ row: 7, col: 4, side: 'player' })
  })

  it('rejects occupied and out-of-bounds player moves', () => {
    const afterPlayer = play(createState(), 7, 7)
    const playerTurn: GomokuState = { ...afterPlayer, turn: 'player' }

    const occupied = gomokuRules.applyPlayerMove(playerTurn, { row: 7, col: 7 }, 'zh-CN')
    const outside = gomokuRules.applyPlayerMove(playerTurn, { row: -1, col: 0 }, 'zh-CN')

    expect('error' in occupied).toBe(true)
    expect('error' in outside).toBe(true)
    expect(createState().board[7][7]).toBe(0)
  })

  it('undoes the last player and AI pair together', () => {
    const played = reply(play(createState(), 7, 7), 0, 0)
    const undone = gomokuRules.undoRound(played)

    expect(undone.history).toEqual([])
    expect(undone.turn).toBe('player')
    expect(undone.board[7][7]).toBe(0)
    expect(undone.board[0][0]).toBe(0)
  })

  it('parses AI coordinates and rejects occupancy', () => {
    expect(gomokuRules.parseAndValidateAiMove(createState(), 'H8', 'zh-CN')).toEqual({
      valid: true,
      move: { row: 7, col: 7 },
    })
    expect(gomokuRules.parseAndValidateAiMove(createState(), 'Z99', 'zh-CN').valid).toBe(false)

    const occupiedState = play(createState(), 7, 7)
    expect(gomokuRules.parseAndValidateAiMove(occupiedState, 'H8', 'zh-CN').valid).toBe(false)
  })
})
