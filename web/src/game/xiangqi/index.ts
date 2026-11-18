import type { GamePlugin } from '../types.js'
import { XiangqiBoard } from './XiangqiBoard.js'
import { type XiangqiMove, xiangqiRules, type XiangqiState } from './engine.js'

export const xiangqiGame: GamePlugin<XiangqiState, XiangqiMove> = {
  ...xiangqiRules,
  BoardComponent: XiangqiBoard,
}
