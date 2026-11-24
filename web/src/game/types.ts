import type { ComponentType } from 'react'
import type { PetVoicePack } from '../pet/catalog.js'
import type { TtsVoice } from '../services/api/speech.js'
import type { Locale } from '../services/settings.js'

/** 扩展标识 */
export type GameId = string

export type GameSide = 'player' | 'ai'

export type GameStatus = 'playing' | 'player_win' | 'ai_win' | 'draw'

/**
 * 坐在棋/牌桌上的 AI 角色抽象。
 * 支持桌面宠物（含专属语音包扩展位）、默认 Logo、会话人设或自定义角色。
 */
export type GameOpponent = {
  id: string
  /** 显示名称 */
  name: string
  /** 空或未设置时回退到应用 Logo */
  avatar?: string
  /** 若关联了桌宠，直接渲染动态精灵图 */
  petSpriteUrl?: string
  petCols?: number
  petRows?: number
  /** 优先使用的 TTS 音色（后续可无缝切入桌宠专属语音包） */
  preferredVoice?: TtsVoice
  voicePack?: PetVoicePack
  /** true 时强制使用应用 Logo 作为头像 */
  useAppLogo?: boolean
  /** 简短人设标签 */
  tagline: string
  /** 注入给大模型的性格与说话风格描述 */
  systemPrompt: string
  /** 开局问候语 */
  greeting: string
  /** 是否允许用户在对弈面板中自定义 */
  customizable?: boolean
}

export type AiMovePromptPayload = {
  /** 游戏规则与角色设定的系统提示词 */
  systemPrompt: string
  /** 当前完整棋/牌局状态、最近着法与明确格式说明 */
  userPrompt: string
  /**
   * 只增不改的稳定前缀（如完整落子记录）。
   * 放在用户消息最前面，让相邻回合的请求共享尽可能长的字节前缀。
   */
  stablePrefix?: string
  /** 可选：供大模型参考或纠偏的合法着法示例 */
  legalExamples?: string[]
}

export type AiTurnDecision<TMove> = {
  move: TMove
  /** 大模型对当前局势的简短思考总结（折叠面板内展示） */
  thoughtSummary: string
  /** 原始思考过程（启用深度思考时的推理文本，折叠查看） */
  thinkingTrace?: string
  /** 拟真对战短台词（气泡主显 & 开启语音时朗读） */
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
  turnSecondsLeft?: number | null
  aiThinking?: boolean
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
  /** 棋/牌局先手方 */
  firstTurn: GameSide
  /** 多人桌（如斗地主）直接在桌面渲染多席位桌宠与气泡，隐藏顶部单对手横条 */
  hideGenericOpponentHeader?: boolean
  /** 实时动作小游戏（如坦克动荡）：由本地 60fps AI 驱动，隐藏思考/悔棋/缓存按钮且免 API Key */
  realtimeLocalAi?: boolean
  /** 单手限时秒数（如斗地主 60 秒） */
  turnTimeoutSec?: number
  createInitialState: () => TState
  getTurn: (state: TState) => GameSide
  getStatus: (state: TState) => GameStatus
  getStatusNote?: (state: TState, locale: Locale) => string | null
  canUndo: (state: TState) => boolean
  /** 悔棋一回合 */
  undoRound: (state: TState) => TState
  applyPlayerMove: (
    state: TState,
    move: TMove,
    locale: Locale
  ) => { nextState: TState } | { error: string }
  applyAiMove: (
    state: TState,
    move: TMove,
    speech?: string,
    locale?: Locale
  ) => { nextState: TState }
  /** 多 AI 座席游戏按当前轮次返回对应桌宠角色与音色 */
  resolveActiveOpponent?: (state: TState, fallback: GameOpponent, locale: Locale) => GameOpponent
  /** 牌型专属口语增强与结果台词 */
  formatMoveSpeech?: (stateBefore: TState, move: TMove, rawSpeech: string, locale: Locale) => string
  /** 超时自动处理（跟牌超时不要 / 领出兜底） */
  handleTimeout?: (
    state: TState,
    side: GameSide,
    locale: Locale
  ) => { nextState: TState; speech?: string } | null
  /** 中途控制指令（如斗地主算牌额度控制） */
  processAiControlAction?: (
    state: TState,
    rawJson: Record<string, unknown>,
    locale: Locale
  ) => { handled: true; nextState: TState; refereeMessage: string } | { handled: false }
  buildAiPrompt: (state: TState, opponent: GameOpponent, locale: Locale) => AiMovePromptPayload
  parseAndValidateAiMove: (
    state: TState,
    rawMove: unknown,
    locale: Locale
  ) => GameMoveValidation<TMove>
  pickFallbackMove: (state: TState) => TMove | null
  BoardComponent: ComponentType<BoardComponentProps<TState, TMove>>
}
