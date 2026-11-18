import type { Locale } from '../../services/settings.js'
import type {
  AiMovePromptPayload,
  GameMoveValidation,
  GameOpponent,
  GamePlugin,
  GameSide,
  GameStatus,
} from '../types.js'
import { GomokuBoard } from './GomokuBoard.js'

export const GOMOKU_SIZE = 15
const COLS = 'ABCDEFGHIJKLMNO'

/** 0 = 空, 1 = 玩家(黑), 2 = AI(白) */
export type GomokuCell = 0 | 1 | 2

export type GomokuCoord = {
  row: number
  col: number
}

export type GomokuHistoryItem = GomokuCoord & {
  side: GameSide
}

export type GomokuState = {
  board: GomokuCell[][]
  history: GomokuHistoryItem[]
  turn: GameSide
  status: GameStatus
  winLine: GomokuCoord[]
}

export const coordToLabel = ({ row, col }: GomokuCoord): string => `${COLS[col]}${row + 1}`

const createEmptyBoard = (): GomokuCell[][] =>
  Array.from({ length: GOMOKU_SIZE }, () =>
    Array.from({ length: GOMOKU_SIZE }, () => 0 as GomokuCell)
  )

const cloneBoard = (board: GomokuCell[][]): GomokuCell[][] => board.map((r) => [...r])

const AXES: readonly [number, number][] = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
]

const findWinLine = (
  board: GomokuCell[][],
  row: number,
  col: number,
  stone: 1 | 2
): GomokuCoord[] => {
  for (const [dr, dc] of AXES) {
    const line: GomokuCoord[] = [{ row, col }]
    for (const step of [1, -1]) {
      let nr = row + dr * step
      let nc = col + dc * step
      while (
        nr >= 0 &&
        nr < GOMOKU_SIZE &&
        nc >= 0 &&
        nc < GOMOKU_SIZE &&
        board[nr][nc] === stone
      ) {
        if (step > 0) {
          line.push({ row: nr, col: nc })
        } else {
          line.unshift({ row: nr, col: nc })
        }
        nr += dr * step
        nc += dc * step
      }
    }
    if (line.length >= 5) {
      return line
    }
  }
  return []
}

const applyStone = (state: GomokuState, move: GomokuCoord, side: GameSide): GomokuState => {
  const nextBoard = cloneBoard(state.board)
  const stone: 1 | 2 = side === 'player' ? 1 : 2
  nextBoard[move.row][move.col] = stone
  const nextHistory = [...state.history, { ...move, side }]
  const winLine = findWinLine(nextBoard, move.row, move.col, stone)

  let status: GameStatus = 'playing'
  if (winLine.length >= 5) {
    status = side === 'player' ? 'player_win' : 'ai_win'
  } else if (nextHistory.length >= GOMOKU_SIZE * GOMOKU_SIZE) {
    status = 'draw'
  }

  return {
    board: nextBoard,
    history: nextHistory,
    turn: side === 'player' ? 'ai' : 'player',
    status,
    winLine,
  }
}

const getNearbyEmptyCoords = (board: GomokuCell[][]): string[] => {
  const occupied: GomokuCoord[] = []
  for (let r = 0; r < GOMOKU_SIZE; r++) {
    for (let c = 0; c < GOMOKU_SIZE; c++) {
      if (board[r][c] !== 0) {
        occupied.push({ row: r, col: c })
      }
    }
  }
  if (occupied.length === 0) {
    return ['H8']
  }
  const nearby: string[] = []
  for (let r = 0; r < GOMOKU_SIZE; r++) {
    for (let c = 0; c < GOMOKU_SIZE; c++) {
      if (board[r][c] !== 0) {
        continue
      }
      const close = occupied.some((p) => Math.abs(p.row - r) <= 2 && Math.abs(p.col - c) <= 2)
      if (close) {
        nearby.push(coordToLabel({ row: r, col: c }))
      }
    }
  }
  return nearby
}

const formatBoardAscii = (board: GomokuCell[][]): string => {
  const header = `    ${COLS.split('').join(' ')}`
  const rows = board.map((rowCells, r) => {
    const label = String(r + 1).padStart(2, ' ')
    const cells = rowCells.map((cell) => (cell === 1 ? 'B' : cell === 2 ? 'W' : '.')).join(' ')
    return `${label}  ${cells}`
  })
  return [header, ...rows].join('\n')
}

const parseRawCoord = (raw: unknown): GomokuCoord | null => {
  if (typeof raw === 'string') {
    const trimmed = raw.trim().toUpperCase()
    const match = /^([A-O])\s*[-,:]?\s*(\d{1,2})$/.exec(trimmed)
    if (match) {
      const col = COLS.indexOf(match[1])
      const row = Number.parseInt(match[2], 10) - 1
      return { row, col }
    }
    const pair = /^(\d{1,2})\s*,\s*(\d{1,2})$/.exec(trimmed)
    if (pair) {
      return {
        row: Number.parseInt(pair[1], 10),
        col: Number.parseInt(pair[2], 10),
      }
    }
    return null
  }
  if (Array.isArray(raw) && raw.length === 2) {
    const r = Number(raw[0])
    const c = Number(raw[1])
    if (Number.isInteger(r) && Number.isInteger(c)) {
      return { row: r, col: c }
    }
    return null
  }
  if (typeof raw === 'object' && raw !== null) {
    const obj = raw as { row?: unknown; col?: unknown }
    if (typeof obj.row === 'number' && typeof obj.col === 'number') {
      return { row: obj.row, col: obj.col }
    }
  }
  return null
}

const buildPrompt = (
  state: GomokuState,
  opponent: GameOpponent,
  locale: Locale
): AiMovePromptPayload => {
  const nearby = getNearbyEmptyCoords(state.board)
  const recentMoves = state.history
    .slice(-10)
    .map((m) => `${m.side === 'player' ? 'B' : 'W'}:${coordToLabel(m)}`)
    .join(' -> ')

  const systemPrompt =
    locale === 'zh-CN'
      ? [
          opponent.systemPrompt,
          '你正在和用户下标准 15×15 五子棋（无禁手规则）。用户执黑先手 (B)，你执白后手 (W)。',
          '列坐标为 A-O（从左到右对应 0-14），行坐标为 1-15（从上到下对应 0-14），天元是 H8。',
          '认真分析连二、活三、冲四、跳三与必须防守的威胁点，选出最强的一手。',
          '必须只输出一个 JSON 对象，不要附加 markdown 代码块之外的任何解释：',
          '{"move":"坐标如I8","thoughtSummary":"15-35字当前局面想法总结","speech":"一句贴合你人设的简短对弈台词(最多30字)"}',
        ].join('\n')
      : [
          opponent.systemPrompt,
          'You are playing standard 15x15 Gomoku against the user. User plays Black (B), you play White (W).',
          'Columns are A-O (left to right), rows are 1-15 (top to bottom), center is H8.',
          'Read threats carefully (open-three, four, double threats) and pick the strongest empty coordinate.',
          'Reply ONLY with a JSON object:',
          '{"move":"coord like I8","thoughtSummary":"concise 1-sentence tactical summary","speech":"short in-character line under 20 words"}',
        ].join('\n')

  const userPrompt =
    locale === 'zh-CN'
      ? [
          `第 ${state.history.length + 1} 手，轮到你（白方 W）落子。`,
          recentMoves ? `最近落子：${recentMoves}` : '棋盘尚空。',
          '当前棋盘：',
          formatBoardAscii(state.board),
          `战区附近空位参考：${nearby.slice(0, 28).join(', ')}`,
          '请选择一个尚未落子(.)的合法坐标，并以 JSON 输出。',
        ].join('\n\n')
      : [
          `Move #${state.history.length + 1}. Your turn as White (W).`,
          recentMoves ? `Recent moves: ${recentMoves}` : 'Board is empty.',
          'Current board:',
          formatBoardAscii(state.board),
          `Nearby empty intersections: ${nearby.slice(0, 28).join(', ')}`,
          'Pick a legal empty (.) coordinate and return JSON.',
        ].join('\n\n')

  return {
    systemPrompt,
    userPrompt,
    legalExamples: nearby.slice(0, 12),
  }
}

export const gomokuGame: GamePlugin<GomokuState, GomokuCoord> = {
  id: 'gomoku',
  name: { 'zh-CN': '五子棋', 'en-US': 'Gomoku' },
  subtitle: {
    'zh-CN': '15×15 标准五子连珠，大模型执白与你对弈',
    'en-US': '15×15 Five-in-a-Row against DeepSeek AI',
  },
  badge: { 'zh-CN': '先手执黑', 'en-US': 'You play Black' },
  firstTurn: 'player',
  createInitialState: () => ({
    board: createEmptyBoard(),
    history: [],
    turn: 'player',
    status: 'playing',
    winLine: [],
  }),
  getTurn: (state) => state.turn,
  getStatus: (state) => state.status,
  canUndo: (state) => state.history.length > 0,
  undoRound: (state) => {
    if (state.history.length === 0) {
      return state
    }
    const last = state.history[state.history.length - 1]
    const popCount = last.side === 'ai' && state.history.length >= 2 ? 2 : 1
    const kept = state.history.slice(0, state.history.length - popCount)
    let rebuilt: GomokuState = {
      board: createEmptyBoard(),
      history: [],
      turn: 'player',
      status: 'playing',
      winLine: [],
    }
    for (const item of kept) {
      rebuilt = applyStone(rebuilt, { row: item.row, col: item.col }, item.side)
    }
    return rebuilt
  },
  applyPlayerMove: (state, move, locale) => {
    if (state.status !== 'playing' || state.turn !== 'player') {
      return { error: locale === 'zh-CN' ? '当前不能落子' : 'Cannot move right now' }
    }
    if (
      move.row < 0 ||
      move.row >= GOMOKU_SIZE ||
      move.col < 0 ||
      move.col >= GOMOKU_SIZE ||
      state.board[move.row][move.col] !== 0
    ) {
      return { error: locale === 'zh-CN' ? '该位置已有棋子' : 'Intersection already occupied' }
    }
    return { nextState: applyStone(state, move, 'player') }
  },
  applyAiMove: (state, move) => ({
    nextState: applyStone(state, move, 'ai'),
  }),
  buildAiPrompt: buildPrompt,
  parseAndValidateAiMove: (state, rawMove, locale): GameMoveValidation<GomokuCoord> => {
    const coord = parseRawCoord(rawMove)
    if (!coord) {
      return {
        valid: false,
        reason:
          locale === 'zh-CN'
            ? `无法解析坐标「${String(rawMove)}」，请使用如 H8 的格式`
            : `Cannot parse coordinate "${String(rawMove)}"; use format like H8`,
      }
    }
    if (
      !Number.isInteger(coord.row) ||
      !Number.isInteger(coord.col) ||
      coord.row < 0 ||
      coord.row >= GOMOKU_SIZE ||
      coord.col < 0 ||
      coord.col >= GOMOKU_SIZE
    ) {
      return {
        valid: false,
        reason:
          locale === 'zh-CN'
            ? `坐标越界，列必须是 A-O，行必须是 1-15`
            : `Out of bounds; column must be A-O and row 1-15`,
      }
    }
    if (state.board[coord.row][coord.col] !== 0) {
      return {
        valid: false,
        reason:
          locale === 'zh-CN'
            ? `${coordToLabel(coord)} 已经有棋子了`
            : `${coordToLabel(coord)} is already occupied`,
      }
    }
    return { valid: true, move: coord }
  },
  pickFallbackMove: (state) => {
    const nearby = getNearbyEmptyCoords(state.board)
    for (const label of nearby) {
      const coord = parseRawCoord(label)
      if (coord && state.board[coord.row][coord.col] === 0) {
        return coord
      }
    }
    for (let r = 0; r < GOMOKU_SIZE; r++) {
      for (let c = 0; c < GOMOKU_SIZE; c++) {
        if (state.board[r][c] === 0) {
          return { row: r, col: c }
        }
      }
    }
    return null
  },
  BoardComponent: GomokuBoard,
}
