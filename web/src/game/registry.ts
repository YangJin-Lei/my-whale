import { gomokuGame } from './gomoku/index.js'
import type { GameId, GamePlugin } from './types.js'
import { xiangqiGame } from './xiangqi/index.js'

export type RegisteredGame = GamePlugin<unknown, unknown>

const asRegistered = <TState, TMove>(plugin: GamePlugin<TState, TMove>): RegisteredGame =>
  plugin as unknown as RegisteredGame

/**
 * 小游戏注册表：后续新增棋牌游戏（如斗地主 doudizhu）只需在此追加注册即可。
 */
export const GAME_REGISTRY: readonly RegisteredGame[] = [
  asRegistered(gomokuGame),
  asRegistered(xiangqiGame),
]

export const findRegisteredGame = (id: GameId | null): RegisteredGame | undefined =>
  id ? GAME_REGISTRY.find((game) => game.id === id) : undefined
