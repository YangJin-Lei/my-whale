import type { GameOpponent, GamePlugin, GameSide, GameStatus } from '../types.js'
import { DrawGuessBoard } from './DrawGuessBoard.js'
export { isGuessMatch, sanitizeDrawingHtml } from './helpers.js'

export type DrawGuessDrawer = 'player' | 'ai'

export type DrawGuessHistoryItem = {
  round: number
  drawer: DrawGuessDrawer
  answer: string
  guess: string
  correct: boolean
}

export type DrawGuessState = {
  round: number
  drawer: DrawGuessDrawer
  playerScore: number
  aiScore: number
  /** AI 出题回合由大模型生成的 HTML 画面与隐藏标准答案 */
  aiPuzzle: {
    html: string
    answer: string
    hint: string
  } | null
  lastReveal: DrawGuessHistoryItem | null
}

export type DrawGuessMove = DrawGuessState

export const IDIOM_PRESETS: readonly string[] = [
  '画蛇添足',
  '掩耳盗铃',
  '亡羊补牢',
  '刻舟求剑',
  '守株待兔',
  '对牛弹琴',
  '井底之蛙',
  '狐假虎威',
  '望梅止渴',
  '盲人摸象',
  '画龙点睛',
  '胸有成竹',
  '水落石出',
  '风和日丽',
  '草船借箭',
  '三顾茅庐',
  '破釜沉舟',
  '指鹿为马',
  '鹤立鸡群',
  '叶公好龙',
  '杯弓蛇影',
  '滥竽充数',
  '塞翁失马',
  '拔苗助长',
  '自相矛盾',
  '惊弓之鸟',
  '鱼目混珠',
  '雪中送炭',
  '锦上添花',
  '画饼充饥',
  '飞蛾扑火',
  '螳臂当车',
  '愚公移山',
  '精卫填海',
  '夸父逐日',
  '嫦娥奔月',
  '牛郎织女',
  '打草惊蛇',
  '一箭双雕',
  '百步穿杨',
  '大闹天宫',
  '坐井观天',
  '龟兔赛跑',
  '猴子捞月',
  '乌鸦喝水',
  '孔融让梨',
  '司马光砸缸',
  '悬梁刺股',
]

export const createInitialDrawGuessState = (): DrawGuessState => ({
  round: 1,
  drawer: 'player',
  playerScore: 0,
  aiScore: 0,
  aiPuzzle: null,
  lastReveal: null,
})

export const drawGuessGame: GamePlugin<DrawGuessState, DrawGuessMove> = {
  id: 'draw_guess',
  name: { 'zh-CN': '你画我猜', 'en-US': 'Draw & Guess' },
  subtitle: {
    'zh-CN': '支持手绘与 HTML 程序画图，DeepSeek 识图猜成语、胜方轮换出题',
    'en-US': 'Sketch or code HTML drawings—DeepSeek vision guesses & draws HTML puzzles',
  },
  badge: { 'zh-CN': '识图 + HTML', 'en-US': 'Vision + HTML' },
  firstTurn: 'player',

  createInitialState: createInitialDrawGuessState,

  getTurn: (): GameSide => 'player',

  getStatus: (): GameStatus => 'playing',

  getStatusNote: (state, locale) => {
    if (!state.lastReveal) {
      return null
    }
    const { drawer, answer, guess, correct } = state.lastReveal
    if (locale === 'zh-CN') {
      const guesser = drawer === 'player' ? 'AI' : '你'
      return correct
        ? `${guesser} 猜对了！答案正是「${answer}」，由胜方画下一题`
        : `${guesser} 猜成了「${guess || '（未作答）'}」，正确答案是「${answer}」`
    }
    const guesserEn = drawer === 'player' ? 'AI' : 'You'
    return correct
      ? `${guesserEn} got it: "${answer}"! Winner draws next.`
      : `${guesserEn} guessed "${guess}", answer was "${answer}".`
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
    reason: locale === 'zh-CN' ? '由画板多模态逻辑处理' : 'Handled by canvas multimodal flow',
  }),

  pickFallbackMove: () => null,

  BoardComponent: DrawGuessBoard,
}
