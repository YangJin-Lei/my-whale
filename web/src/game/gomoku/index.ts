import type { GamePlugin } from '../types.js'
import { GomokuBoard } from './GomokuBoard.js'
import { type GomokuCoord, gomokuRules, type GomokuState } from './engine.js'

export const gomokuGame: GamePlugin<GomokuState, GomokuCoord> = {
  ...gomokuRules,
  BoardComponent: GomokuBoard,
}
