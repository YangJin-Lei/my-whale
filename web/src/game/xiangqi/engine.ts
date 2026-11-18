import type { Locale } from '../../services/settings.js'
import type {
  AiMovePromptPayload,
  GameMoveValidation,
  GameOpponent,
  GamePlugin,
  GameSide,
  GameStatus,
} from '../types.js'
import { XiangqiBoard } from './XiangqiBoard.js'

export const XIANGQI_ROWS = 10
export const XIANGQI_COLS = 9
const UCCI_COLS = 'abcdefghi'

export type XiangqiPieceType = 'K' | 'A' | 'E' | 'H' | 'R' | 'C' | 'P'

export type XiangqiPiece = {
  side: GameSide // 'player' = 红方(先手), 'ai' = 黑方(后手)
  type: XiangqiPieceType
}

export type XiangqiCell = XiangqiPiece | null

export type XiangqiPos = { row: number; col: number }

export type XiangqiMove = {
  from: XiangqiPos
  to: XiangqiPos
}

export type XiangqiHistoryItem = XiangqiMove & {
  side: GameSide
  piece: XiangqiPiece
  captured: XiangqiPiece | null
  ucci: string
}

export type XiangqiState = {
  board: XiangqiCell[][]
  history: XiangqiHistoryItem[]
  turn: GameSide
  status: GameStatus
  inCheck: GameSide | null
}

export const PIECE_LABELS: Record<GameSide, Record<XiangqiPieceType, string>> = {
  player: { K: '帥', A: '仕', E: '相', H: '傌', R: '俥', C: '炮', P: '兵' },
  ai: { K: '將', A: '士', E: '象', H: '馬', R: '車', C: '砲', P: '卒' },
}

const ASCII_CODES: Record<GameSide, Record<XiangqiPieceType, string>> = {
  player: { K: 'K', A: 'A', E: 'B', H: 'N', R: 'R', C: 'C', P: 'P' },
  ai: { K: 'k', A: 'a', E: 'b', H: 'n', R: 'r', C: 'c', P: 'p' },
}

export const posToUcci = ({ row, col }: XiangqiPos): string => `${UCCI_COLS[col]}${9 - row}`

export const moveToUcci = ({ from, to }: XiangqiMove): string =>
  `${posToUcci(from)}${posToUcci(to)}`

const inBounds = (r: number, c: number) => r >= 0 && r < XIANGQI_ROWS && c >= 0 && c < XIANGQI_COLS

const inPalace = (side: GameSide, r: number, c: number) => {
  if (c < 3 || c > 5) {
    return false
  }
  return side === 'player' ? r >= 7 && r <= 9 : r >= 0 && r <= 2
}

const ownHalf = (side: GameSide, r: number) => (side === 'player' ? r >= 5 : r <= 4)

const p = (side: GameSide, type: XiangqiPieceType): XiangqiPiece => ({ side, type })

export const createInitialXiangqiBoard = (): XiangqiCell[][] => [
  [
    p('ai', 'R'),
    p('ai', 'H'),
    p('ai', 'E'),
    p('ai', 'A'),
    p('ai', 'K'),
    p('ai', 'A'),
    p('ai', 'E'),
    p('ai', 'H'),
    p('ai', 'R'),
  ],
  Array.from({ length: XIANGQI_COLS }, () => null),
  [null, p('ai', 'C'), null, null, null, null, null, p('ai', 'C'), null],
  [p('ai', 'P'), null, p('ai', 'P'), null, p('ai', 'P'), null, p('ai', 'P'), null, p('ai', 'P')],
  Array.from({ length: XIANGQI_COLS }, () => null),
  Array.from({ length: XIANGQI_COLS }, () => null),
  [
    p('player', 'P'),
    null,
    p('player', 'P'),
    null,
    p('player', 'P'),
    null,
    p('player', 'P'),
    null,
    p('player', 'P'),
  ],
  [null, p('player', 'C'), null, null, null, null, null, p('player', 'C'), null],
  Array.from({ length: XIANGQI_COLS }, () => null),
  [
    p('player', 'R'),
    p('player', 'H'),
    p('player', 'E'),
    p('player', 'A'),
    p('player', 'K'),
    p('player', 'A'),
    p('player', 'E'),
    p('player', 'H'),
    p('player', 'R'),
  ],
]

const cloneBoard = (board: XiangqiCell[][]): XiangqiCell[][] => board.map((row) => [...row])

const findKing = (board: XiangqiCell[][], side: GameSide): XiangqiPos | null => {
  for (let r = 0; r < XIANGQI_ROWS; r++) {
    for (let c = 0; c < XIANGQI_COLS; c++) {
      const piece = board[r][c]
      if (piece && piece.side === side && piece.type === 'K') {
        return { row: r, col: c }
      }
    }
  }
  return null
}

const areKingsFacing = (board: XiangqiCell[][]): boolean => {
  const redKing = findKing(board, 'player')
  const blackKing = findKing(board, 'ai')
  if (!redKing || !blackKing || redKing.col !== blackKing.col) {
    return false
  }
  const col = redKing.col
  const minR = Math.min(redKing.row, blackKing.row) + 1
  const maxR = Math.max(redKing.row, blackKing.row)
  for (let r = minR; r < maxR; r++) {
    if (board[r][col] !== null) {
      return false
    }
  }
  return true
}

const getPseudoMovesForPiece = (
  board: XiangqiCell[][],
  row: number,
  col: number,
  piece: XiangqiPiece
): XiangqiPos[] => {
  const targets: XiangqiPos[] = []
  const pushIfValid = (nr: number, nc: number) => {
    if (!inBounds(nr, nc)) {
      return
    }
    const target = board[nr][nc]
    if (!target || target.side !== piece.side) {
      targets.push({ row: nr, col: nc })
    }
  }

  switch (piece.type) {
    case 'K': {
      const dirs = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]
      for (const [dr, dc] of dirs) {
        const nr = row + dr
        const nc = col + dc
        if (inPalace(piece.side, nr, nc)) {
          pushIfValid(nr, nc)
        }
      }
      break
    }
    case 'A': {
      const dirs = [
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ]
      for (const [dr, dc] of dirs) {
        const nr = row + dr
        const nc = col + dc
        if (inPalace(piece.side, nr, nc)) {
          pushIfValid(nr, nc)
        }
      }
      break
    }
    case 'E': {
      const dirs = [
        [2, 2],
        [2, -2],
        [-2, 2],
        [-2, -2],
      ]
      for (const [dr, dc] of dirs) {
        const nr = row + dr
        const nc = col + dc
        const eyeR = row + dr / 2
        const eyeC = col + dc / 2
        if (inBounds(nr, nc) && ownHalf(piece.side, nr) && board[eyeR][eyeC] === null) {
          pushIfValid(nr, nc)
        }
      }
      break
    }
    case 'H': {
      const steps: readonly [number, number, number, number][] = [
        [-2, -1, -1, 0],
        [-2, 1, -1, 0],
        [2, -1, 1, 0],
        [2, 1, 1, 0],
        [-1, -2, 0, -1],
        [1, -2, 0, -1],
        [-1, 2, 0, 1],
        [1, 2, 0, 1],
      ]
      for (const [dr, dc, lr, lc] of steps) {
        const legR = row + lr
        const legC = col + lc
        if (inBounds(legR, legC) && board[legR][legC] === null) {
          pushIfValid(row + dr, col + dc)
        }
      }
      break
    }
    case 'R': {
      const dirs = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]
      for (const [dr, dc] of dirs) {
        let nr = row + dr
        let nc = col + dc
        while (inBounds(nr, nc)) {
          const cell = board[nr][nc]
          if (!cell) {
            targets.push({ row: nr, col: nc })
          } else {
            if (cell.side !== piece.side) {
              targets.push({ row: nr, col: nc })
            }
            break
          }
          nr += dr
          nc += dc
        }
      }
      break
    }
    case 'C': {
      const dirs = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]
      for (const [dr, dc] of dirs) {
        let nr = row + dr
        let nc = col + dc
        let jumped = false
        while (inBounds(nr, nc)) {
          const cell = board[nr][nc]
          if (!jumped) {
            if (!cell) {
              targets.push({ row: nr, col: nc })
            } else {
              jumped = true
            }
          } else if (cell) {
            if (cell.side !== piece.side) {
              targets.push({ row: nr, col: nc })
            }
            break
          }
          nr += dr
          nc += dc
        }
      }
      break
    }
    case 'P': {
      const forward = piece.side === 'player' ? -1 : 1
      pushIfValid(row + forward, col)
      const crossedRiver = !ownHalf(piece.side, row)
      if (crossedRiver) {
        pushIfValid(row, col - 1)
        pushIfValid(row, col + 1)
      }
      break
    }
  }
  return targets
}

const isSideInCheck = (board: XiangqiCell[][], side: GameSide): boolean => {
  const king = findKing(board, side)
  if (!king) {
    return true
  }
  if (areKingsFacing(board)) {
    return true
  }
  const attacker: GameSide = side === 'player' ? 'ai' : 'player'
  for (let r = 0; r < XIANGQI_ROWS; r++) {
    for (let c = 0; c < XIANGQI_COLS; c++) {
      const piece = board[r][c]
      if (!piece || piece.side !== attacker) {
        continue
      }
      const hits = getPseudoMovesForPiece(board, r, c, piece)
      if (hits.some((pos) => pos.row === king.row && pos.col === king.col)) {
        return true
      }
    }
  }
  return false
}

const applyMoveOnBoard = (board: XiangqiCell[][], move: XiangqiMove): XiangqiCell[][] => {
  const next = cloneBoard(board)
  const piece = next[move.from.row][move.from.col]
  next[move.from.row][move.from.col] = null
  next[move.to.row][move.to.col] = piece
  return next
}

export const getLegalMovesForSquare = (
  board: XiangqiCell[][],
  side: GameSide,
  row: number,
  col: number
): XiangqiPos[] => {
  const piece = board[row][col]
  if (!piece || piece.side !== side) {
    return []
  }
  const pseudo = getPseudoMovesForPiece(board, row, col, piece)
  return pseudo.filter((to) => {
    const simulated = applyMoveOnBoard(board, { from: { row, col }, to })
    return !isSideInCheck(simulated, side)
  })
}

export const getAllLegalMoves = (board: XiangqiCell[][], side: GameSide): XiangqiMove[] => {
  const all: XiangqiMove[] = []
  for (let r = 0; r < XIANGQI_ROWS; r++) {
    for (let c = 0; c < XIANGQI_COLS; c++) {
      const piece = board[r][c]
      if (!piece || piece.side !== side) {
        continue
      }
      const targets = getLegalMovesForSquare(board, side, r, c)
      for (const to of targets) {
        all.push({ from: { row: r, col: c }, to })
      }
    }
  }
  return all
}

const commitMove = (state: XiangqiState, move: XiangqiMove, side: GameSide): XiangqiState => {
  const moving = state.board[move.from.row][move.from.col]
  if (!moving) {
    return state
  }
  const captured = state.board[move.to.row][move.to.col]
  const nextBoard = applyMoveOnBoard(state.board, move)
  const opponent: GameSide = side === 'player' ? 'ai' : 'player'
  const opponentLegal = getAllLegalMoves(nextBoard, opponent)
  const opponentInCheck = isSideInCheck(nextBoard, opponent)

  let status: GameStatus = 'playing'
  if (captured?.type === 'K' || opponentLegal.length === 0) {
    status = side === 'player' ? 'player_win' : 'ai_win'
  }

  return {
    board: nextBoard,
    history: [
      ...state.history,
      {
        ...move,
        side,
        piece: moving,
        captured,
        ucci: moveToUcci(move),
      },
    ],
    turn: opponent,
    status,
    inCheck: status === 'playing' && opponentInCheck ? opponent : null,
  }
}

const parseRawXiangqiMove = (raw: unknown): XiangqiMove | null => {
  if (typeof raw === 'string') {
    const cleaned = raw
      .trim()
      .toLowerCase()
      .replace(/[^a-i0-9]/g, '')
    const match = /^([a-i])([0-9])([a-i])([0-9])$/.exec(cleaned)
    if (match) {
      return {
        from: { row: 9 - Number.parseInt(match[2], 10), col: UCCI_COLS.indexOf(match[1]) },
        to: { row: 9 - Number.parseInt(match[4], 10), col: UCCI_COLS.indexOf(match[3]) },
      }
    }
    return null
  }
  if (typeof raw === 'object' && raw !== null) {
    const obj = raw as { from?: unknown; to?: unknown }
    if (typeof obj.from === 'string' && typeof obj.to === 'string') {
      return parseRawXiangqiMove(`${obj.from}${obj.to}`)
    }
  }
  return null
}

const formatXiangqiBoardAscii = (board: XiangqiCell[][]): string => {
  const rows = board.map((rowCells, r) => {
    const rank = 9 - r
    const cells = rowCells.map((cell) => (cell ? ASCII_CODES[cell.side][cell.type] : '.')).join(' ')
    const riverNote = r === 4 ? '\n  ---- 楚河  汉界 ----' : ''
    return `${rank}  ${cells}${riverNote}`
  })
  return [...rows, '   a b c d e f g h i'].join('\n')
}

const describeMovePiece = (board: XiangqiCell[][], move: XiangqiMove): string => {
  const piece = board[move.from.row][move.from.col]
  const label = piece ? PIECE_LABELS[piece.side][piece.type] : ''
  const target = board[move.to.row][move.to.col]
  const captureHint = target ? `吃${PIECE_LABELS[target.side][target.type]}` : ''
  return `${moveToUcci(move)}(${label}${captureHint})`
}

const buildPrompt = (
  state: XiangqiState,
  opponent: GameOpponent,
  locale: Locale
): AiMovePromptPayload => {
  const legalMoves = getAllLegalMoves(state.board, 'ai')
  const legalUcci = legalMoves.map(moveToUcci)
  const annotatedLegal = legalMoves.map((m) => describeMovePiece(state.board, m))
  const recent = state.history
    .slice(-10)
    .map(
      (h) => `${h.side === 'player' ? '红' : '黑'}:${h.ucci}(${PIECE_LABELS[h.side][h.piece.type]})`
    )
    .join(' -> ')

  const systemPrompt =
    locale === 'zh-CN'
      ? [
          opponent.systemPrompt,
          '你正在和用户下标准中国象棋。用户执红先手（小写之外的大写字母 K/A/B/N/R/C/P：帥仕相傌俥炮兵，位于 0-4 行下方），你执黑后手（小写字母 k/a/b/n/r/c/p：將士象馬車砲卒，位于 5-9 行上方）。',
          '坐标采用标准 UCCI 四字符格式（如 h7e7、b9c7、g6g5），列为 a-i（左到右），行为 0-9（下到上）。',
          '请从真实棋理（开局出子、马炮配合、抢占要道、解将、捉子与防杀）思考并独立选择一步最优合法着法。',
          '必须只输出一个 JSON 对象：',
          '{"move":"四字符UCCI着法如h7e7","thoughtSummary":"15-35字当前局面思考总结","speech":"一句贴合人设的短台词(最多30字)"}',
        ].join('\n')
      : [
          opponent.systemPrompt,
          'You are playing standard Chinese Chess (Xiangqi). User plays Red (uppercase K/A/B/N/R/C/P, rows 0-4 bottom), you play Black (lowercase k/a/b/n/r/c/p, rows 5-9 top).',
          'Use 4-char UCCI coordinates (columns a-i left-to-right, ranks 0-9 bottom-to-top), e.g., h7e7 or b9c7.',
          'Think tactically (checks, forks, pins, piece safety, tempo) and pick the strongest legal move.',
          'Reply ONLY with JSON:',
          '{"move":"4-char UCCI move like h7e7","thoughtSummary":"concise 1-sentence chess thought","speech":"short in-character remark"}',
        ].join('\n')

  const checkNotice =
    state.inCheck === 'ai'
      ? locale === 'zh-CN'
        ? '注意：你当前正在被红方将军，必须应将！'
        : 'Warning: You are currently in CHECK and must resolve it!'
      : ''

  const userPrompt =
    locale === 'zh-CN'
      ? [
          `第 ${state.history.length + 1} 回合，轮到你（黑方小写）走棋。`,
          checkNotice,
          recent ? `近期着法：${recent}` : '',
          '当前棋盘（大写红方，小写黑方）：',
          formatXiangqiBoardAscii(state.board),
          `全部合法着法参考（共 ${annotatedLegal.length} 个）：${annotatedLegal.join(', ')}`,
          '请从上述合法着法中做出最佳选择，并返回 JSON（move 字段填写 4 字符 UCCI，例如 "h7e7"）。',
        ]
          .filter(Boolean)
          .join('\n\n')
      : [
          `Ply #${state.history.length + 1}. Your turn as Black (lowercase).`,
          checkNotice,
          recent ? `Recent moves: ${recent}` : '',
          'Board (Red uppercase bottom, Black lowercase top):',
          formatXiangqiBoardAscii(state.board),
          `All legal moves (${annotatedLegal.length}): ${annotatedLegal.join(', ')}`,
          'Pick the best legal UCCI move and return JSON.',
        ]
          .filter(Boolean)
          .join('\n\n')

  return {
    systemPrompt,
    userPrompt,
    legalExamples: legalUcci.slice(0, 10),
  }
}

export const xiangqiGame: GamePlugin<XiangqiState, XiangqiMove> = {
  id: 'xiangqi',
  name: { 'zh-CN': '中国象棋', 'en-US': 'Chinese Chess' },
  subtitle: {
    'zh-CN': '标准规则完整裁判，大模型执黑与你楚河汉界对弈',
    'en-US': 'Standard Xiangqi rules referee against DeepSeek AI',
  },
  badge: { 'zh-CN': '先手执红', 'en-US': 'You play Red' },
  firstTurn: 'player',
  createInitialState: () => ({
    board: createInitialXiangqiBoard(),
    history: [],
    turn: 'player',
    status: 'playing',
    inCheck: null,
  }),
  getTurn: (state) => state.turn,
  getStatus: (state) => state.status,
  getStatusNote: (state, locale) => {
    if (state.status !== 'playing' || !state.inCheck) {
      return null
    }
    if (locale === 'zh-CN') {
      return state.inCheck === 'player' ? '红方被将军！' : '黑方被将军！'
    }
    return state.inCheck === 'player' ? 'Red is in check!' : 'Black is in check!'
  },
  canUndo: (state) => state.history.length > 0,
  undoRound: (state) => {
    if (state.history.length === 0) {
      return state
    }
    const last = state.history[state.history.length - 1]
    const popCount = last.side === 'ai' && state.history.length >= 2 ? 2 : 1
    const kept = state.history.slice(0, state.history.length - popCount)
    let rebuilt: XiangqiState = {
      board: createInitialXiangqiBoard(),
      history: [],
      turn: 'player',
      status: 'playing',
      inCheck: null,
    }
    for (const item of kept) {
      rebuilt = commitMove(rebuilt, { from: item.from, to: item.to }, item.side)
    }
    return rebuilt
  },
  applyPlayerMove: (state, move, locale) => {
    if (state.status !== 'playing' || state.turn !== 'player') {
      return { error: locale === 'zh-CN' ? '当前未轮到红方走棋' : 'Not your turn' }
    }
    const legal = getLegalMovesForSquare(state.board, 'player', move.from.row, move.from.col)
    const ok = legal.some((t) => t.row === move.to.row && t.col === move.to.col)
    if (!ok) {
      return { error: locale === 'zh-CN' ? '该走法不符合象棋规则' : 'Illegal Xiangqi move' }
    }
    return { nextState: commitMove(state, move, 'player') }
  },
  applyAiMove: (state, move) => ({
    nextState: commitMove(state, move, 'ai'),
  }),
  buildAiPrompt: buildPrompt,
  parseAndValidateAiMove: (state, rawMove, locale): GameMoveValidation<XiangqiMove> => {
    const parsed = parseRawXiangqiMove(rawMove)
    if (!parsed) {
      return {
        valid: false,
        reason:
          locale === 'zh-CN'
            ? `无法解析着法「${String(rawMove)}」，请返回 4 字符 UCCI 坐标如 h7e7`
            : `Cannot parse move "${String(rawMove)}"; return 4-char UCCI like h7e7`,
      }
    }
    const piece = state.board[parsed.from.row]?.[parsed.from.col]
    if (!piece || piece.side !== 'ai') {
      return {
        valid: false,
        reason:
          locale === 'zh-CN'
            ? `起点 ${posToUcci(parsed.from)} 没有黑方棋子`
            : `No Black piece at ${posToUcci(parsed.from)}`,
      }
    }
    const legal = getLegalMovesForSquare(state.board, 'ai', parsed.from.row, parsed.from.col)
    const allowed = legal.some((t) => t.row === parsed.to.row && t.col === parsed.to.col)
    if (!allowed) {
      const pieceName = PIECE_LABELS.ai[piece.type]
      return {
        valid: false,
        reason:
          locale === 'zh-CN'
            ? `${moveToUcci(parsed)}（${pieceName}）违反象棋行棋或应将规则（例如别马腿、塞象眼、未解将或送将）`
            : `${moveToUcci(parsed)} violates Xiangqi movement or king-safety rules`,
      }
    }
    return { valid: true, move: parsed }
  },
  pickFallbackMove: (state) => {
    const all = getAllLegalMoves(state.board, 'ai')
    if (all.length === 0) {
      return null
    }
    return all[Math.floor(Math.random() * all.length)]
  },
  BoardComponent: XiangqiBoard,
}
