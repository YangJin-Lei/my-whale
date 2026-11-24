import { doudizhuGame } from './doudizhu/index.js'
import { drawGuessGame } from './drawguess/index.js'
import { gomokuGame } from './gomoku/index.js'
import { mahjongGame } from './mahjong/index.js'
import { tankGame } from './tank/index.js'
import type { GameId, GamePlugin } from './types.js'
import { werewolfGame } from './werewolf/index.js'
import { xiangqiGame } from './xiangqi/index.js'

export type RegisteredGame = GamePlugin<unknown, unknown>

const asRegistered = <TState, TMove>(plugin: GamePlugin<TState, TMove>): RegisteredGame =>
  plugin as unknown as RegisteredGame

/**
 * 小游戏注册表：内置五子棋、中国象棋、斗地主、麻将、坦克动荡、你画我猜、狼人杀。
 */
export const GAME_REGISTRY: readonly RegisteredGame[] = [
  asRegistered(gomokuGame),
  asRegistered(xiangqiGame),
  asRegistered(doudizhuGame),
  asRegistered(mahjongGame),
  asRegistered(tankGame),
  asRegistered(drawGuessGame),
  asRegistered(werewolfGame),
]

export const findRegisteredGame = (id: GameId | null): RegisteredGame | undefined =>
  id ? GAME_REGISTRY.find((game) => game.id === id) : undefined
