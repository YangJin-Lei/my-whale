import type { GameOpponent, GamePlugin, GameSide, GameStatus } from '../types.js'
import { createInitialWerewolfState } from './engine.js'
import type { WerewolfState } from './types.js'
import { WerewolfBoard } from './WerewolfBoard.js'

export const werewolfGame: GamePlugin<WerewolfState, WerewolfState> = {
  id: 'werewolf',
  name: { 'zh-CN': '狼人杀', 'en-US': 'Werewolf' },
  subtitle: {
    'zh-CN': '多桌宠全明星局（默认 6 人，支持 9/12 人局），严格视角隔离',
    'en-US': 'Multi-pet Werewolf (6 / 9 / 12 players) with strict role isolation',
  },
  badge: { 'zh-CN': '6/9/12 人局', 'en-US': '6/9/12P' },
  firstTurn: 'player',
  hideGenericOpponentHeader: true,

  createInitialState: () => createInitialWerewolfState(6),

  getTurn: (): GameSide => 'player',

  getStatus: (state): GameStatus => {
    if (state.phase !== 'finished' || !state.winner) {
      return 'playing'
    }
    const humanIsWolf = state.seats[0]?.role === 'wolf'
    if (state.winner === 'wolf') {
      return humanIsWolf ? 'player_win' : 'ai_win'
    }
    return humanIsWolf ? 'ai_win' : 'player_win'
  },

  getStatusNote: (state, locale) => {
    if (state.phase !== 'finished' || !state.winner) {
      return null
    }
    if (locale === 'zh-CN') {
      return state.winner === 'good'
        ? '游戏结束：好人阵营获胜！底牌已全部公开。'
        : '游戏结束：狼人阵营获胜！底牌已全部公开。'
    }
    return state.winner === 'good' ? 'Game Over: Villagers Win!' : 'Game Over: Werewolves Win!'
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
    reason: locale === 'zh-CN' ? '由多席位狼人杀法官驱动' : 'Driven by Werewolf moderator',
  }),

  pickFallbackMove: () => null,

  BoardComponent: WerewolfBoard,
}
