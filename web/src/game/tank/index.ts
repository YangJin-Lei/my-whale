import { createId } from '../../utils/id.js'
import type { GameOpponent, GamePlugin, GameSide, GameStatus } from '../types.js'
import { TankBoard } from './TankBoard.js'
import type { TankMatchState } from './types.js'

export const createInitialTankMatchState = (): TankMatchState => ({
  sessionToken: createId(),
  round: 1,
  playerScore: 0,
  aiScore: 0,
  targetWins: 5,
  difficulty: 'hard',
  controlMode: 'directional',
  status: 'playing',
  lastRoundNote: '',
})

export const tankGame: GamePlugin<TankMatchState, TankMatchState> = {
  id: 'tank_battle',
  name: { 'zh-CN': '坦克动荡', 'en-US': 'Tank Trouble' },
  subtitle: {
    'zh-CN': '随机迷宫跳弹对决，AI 实时 A* 寻路 + 躲避子弹 + 反弹预判（不耗 API）',
    'en-US': 'Random maze ricochet duel with real-time A* AI & bullet evasion (no API cost)',
  },
  badge: { 'zh-CN': '本地高速 AI', 'en-US': '60fps Local AI' },
  firstTurn: 'player',
  realtimeLocalAi: true,

  createInitialState: createInitialTankMatchState,

  getTurn: (): GameSide => 'player',

  getStatus: (state): GameStatus => state.status,

  getStatusNote: (state, locale) => {
    if (state.status !== 'playing') {
      return locale === 'zh-CN'
        ? `最终比分 你 ${state.playerScore} : AI ${state.aiScore}`
        : `Final score You ${state.playerScore} : AI ${state.aiScore}`
    }
    return state.lastRoundNote || null
  },

  canUndo: () => false,
  undoRound: (state) => state,

  applyPlayerMove: (_state, move) => ({ nextState: move }),
  applyAiMove: (_state, move) => ({ nextState: move }),

  buildAiPrompt: (_state, opponent: GameOpponent) => ({
    systemPrompt: opponent.systemPrompt,
    userPrompt: '',
  }),

  parseAndValidateAiMove: (_state, _rawMove, locale) => ({
    valid: false,
    reason: locale === 'zh-CN' ? '由本地实时物理与 A* 算法驱动' : 'Driven by real-time local AI',
  }),

  pickFallbackMove: () => null,

  BoardComponent: TankBoard,
}
