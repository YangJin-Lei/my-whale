import { doudizhuGame } from './doudizhu/index.js'
import { gomokuGame } from './gomoku/index.js'
import type { GameId, GamePlugin } from './types.js'
import { xiangqiGame } from './xiangqi/index.js'

export type RegisteredGame = GamePlugin<unknown, unknown>

const asRegistered = <TState, TMove>(plugin: GamePlugin<TState, TMove>): RegisteredGame =>
  plugin as unknown as RegisteredGame

/**
 * 小游戏注册表：内置五子棋、中国象棋与斗地主，后续按同接口追加麻将等玩法。
 */
export const GAME_REGISTRY: readonly RegisteredGame[] = [
  asRegistered(gomokuGame),
  asRegistered(xiangqiGame),
  asRegistered(doudizhuGame),
]

export const findRegisteredGame = (id: GameId | null): RegisteredGame | undefined =>
  id ? GAME_REGISTRY.find((game) => game.id === id) : undefined
