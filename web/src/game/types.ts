import type { ComponentType } from 'react'
import type { Locale } from '../services/settings.js'

/** 扩展标识：后续新增游戏（如 doudizhu）直接在此注册即可 */
export type GameId = string

export type GameSide = 'player' | 'ai'

export type GameStatus = 'playing' | 'player_win' | 'ai_win' | 'draw'

/**
 * 坐在棋盘对面的 AI 角色抽象。
 * 默认使用应用 Logo；支持从会话人设同步或由用户/开发者自定义扩展。
 */
export type GameOpponent = {
  id: string
  /** 显示名称 */
  name: string
  /** 空或未设置时回退到应用 Logo */
  avatar?: string
  /** true 时强制使用应用 Logo 作为头像 */
  useAppLogo?: boolean
  /** 简短人设标签 */
  tagline: string
  /** 注入给大模型的性格与说话风格描述 */
  systemPrompt: string
  /** 开局问候语（显示在棋盘对面气泡里） */
  greeting: string
  /** 是否允许用户在对弈面板中自定义 */
  customizable?: boolean
}

export type AiMovePromptPayload = {
  /** 游戏规则与角色设定的系统提示词 */
  systemPrompt: string
  /** 当前完整棋局状态、最近着法与明确可接受坐标格式说明 */
  userPrompt: string
  /** 可选：供大模型参考或纠偏的合法着法示例 */
  legalExamples?: string[]
}

export type AiTurnDecision<TMove> = {
  move: TMove
  /** 大模型对当前局势的简短思考总结（气泡内展示） */
  thoughtSummary: string
  /** 拟真对战短台词（开启语音时会朗读） */
  speech: string
  /** 是否触发了兜底着法 */
  usedFallback?: boolean
}

export type GameMoveValidation<TMove> =
  | { valid: true; move: TMove }
  | { valid: false; reason: string }

export type BoardComponentProps<TState, TMove> = {
  state: TState
  disabled: boolean
  onPlayerMove: (move: TMove) => void
}

/**
 * 可插拔小游戏引擎接口。
 * 约束原则：代码仅充当【规则裁判】与【状态维护者】，所有 AI 决策均由 DeepSeek 大模型生成。
 */
export type GamePlugin<TState = unknown, TMove = unknown> = {
  id: GameId
  name: Record<Locale, string>
  subtitle: Record<Locale, string>
  badge: Record<Locale, string>
  /** 棋盘先手方 */
  firstTurn: GameSide
  createInitialState: () => TState
  getTurn: (state: TState) => GameSide
  getStatus: (state: TState) => GameStatus
  getStatusNote?: (state: TState, locale: Locale) => string | null
  canUndo: (state: TState) => boolean
  /** 悔棋一回合（撤销 AI 与玩家最近各一步，或当前刚走的步数） */
  undoRound: (state: TState) => TState
  applyPlayerMove: (
    state: TState,
    move: TMove,
    locale: Locale
  ) => { nextState: TState } | { error: string }
  applyAiMove: (state: TState, move: TMove) => { nextState: TState }
  buildAiPrompt: (state: TState, opponent: GameOpponent, locale: Locale) => AiMovePromptPayload
  parseAndValidateAiMove: (
    state: TState,
    rawMove: unknown,
    locale: Locale
  ) => GameMoveValidation<TMove>
  pickFallbackMove: (state: TState) => TMove | null
  BoardComponent: ComponentType<BoardComponentProps<TState, TMove>>
}
