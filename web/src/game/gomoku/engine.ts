import type { Locale } from '../../services/settings.js'
import type {
  AiMovePromptPayload,
  GameMoveValidation,
  GameOpponent,
  GamePlugin,
  GameSide,
  GameStatus,
} from '../types.js'

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

const collectStones = (board: GomokuCell[][], stone: 1 | 2): string[] => {
  const list: string[] = []
  for (let r = 0; r < GOMOKU_SIZE; r++) {
    for (let c = 0; c < GOMOKU_SIZE; c++) {
      if (board[r][c] === stone) {
        list.push(coordToLabel({ row: r, col: c }))
      }
    }
  }
  return list
}

const describeContiguousRuns = (board: GomokuCell[][], stone: 1 | 2, locale: Locale): string[] => {
  const runs: string[] = []
  const seen = new Set<string>()
  const inGrid = (r: number, c: number) => r >= 0 && r < GOMOKU_SIZE && c >= 0 && c < GOMOKU_SIZE

  for (let r = 0; r < GOMOKU_SIZE; r++) {
    for (let c = 0; c < GOMOKU_SIZE; c++) {
      if (board[r][c] !== stone) {
        continue
      }
      for (let axisIdx = 0; axisIdx < AXES.length; axisIdx++) {
        const [dr, dc] = AXES[axisIdx]
        const pr = r - dr
        const pc = c - dc
        if (inGrid(pr, pc) && board[pr][pc] === stone) {
          continue
        }
        const cells: GomokuCoord[] = [{ row: r, col: c }]
        let nr = r + dr
        let nc = c + dc
        while (inGrid(nr, nc) && board[nr][nc] === stone) {
          cells.push({ row: nr, col: nc })
          nr += dr
          nc += dc
        }
        if (cells.length >= 2) {
          const sig = `${axisIdx}:${cells.map(coordToLabel).join('-')}`
          if (!seen.has(sig)) {
            seen.add(sig)
            const openEnds: string[] = []
            if (inGrid(pr, pc) && board[pr][pc] === 0) {
              openEnds.push(coordToLabel({ row: pr, col: pc }))
            }
            if (inGrid(nr, nc) && board[nr][nc] === 0) {
              openEnds.push(coordToLabel({ row: nr, col: nc }))
            }
            if (openEnds.length > 0 || cells.length >= 4) {
              const chain = cells.map(coordToLabel).join('-')
              runs.push(
                locale === 'zh-CN'
                  ? `${cells.length}连 ${chain}（两端空位: ${openEnds.length ? openEnds.join(', ') : '均被堵'}）`
                  : `${cells.length}-in-row ${chain} (open ends: ${openEnds.length ? openEnds.join(', ') : 'blocked'})`
              )
            }
          }
        }
      }
    }
  }
  return runs
}

const describeJumpPatterns = (board: GomokuCell[][], stone: 1 | 2, locale: Locale): string[] => {
  const gaps: string[] = []
  const seen = new Set<string>()
  const inGrid = (r: number, c: number) => r >= 0 && r < GOMOKU_SIZE && c >= 0 && c < GOMOKU_SIZE

  for (let r = 0; r < GOMOKU_SIZE; r++) {
    for (let c = 0; c < GOMOKU_SIZE; c++) {
      if (board[r][c] !== 0) {
        continue
      }
      for (let axisIdx = 0; axisIdx < AXES.length; axisIdx++) {
        const [dr, dc] = AXES[axisIdx]
        let leftCount = 0
        let lr = r - dr
        let lc = c - dc
        while (inGrid(lr, lc) && board[lr][lc] === stone) {
          leftCount += 1
          lr -= dr
          lc -= dc
        }
        let rightCount = 0
        let rr = r + dr
        let rc = c + dc
        while (inGrid(rr, rc) && board[rr][rc] === stone) {
          rightCount += 1
          rr += dr
          rc += dc
        }
        if (leftCount >= 1 && rightCount >= 1 && leftCount + rightCount >= 3) {
          const gapLabel = coordToLabel({ row: r, col: c })
          const sig = `${axisIdx}:${gapLabel}`
          if (!seen.has(sig)) {
            seen.add(sig)
            const total = leftCount + rightCount
            gaps.push(
              locale === 'zh-CN'
                ? `中间断点 ${gapLabel} 可直接连通左右共 ${total} 子`
                : `gap ${gapLabel} connects ${total} collinear stones`
            )
          }
        }
      }
    }
  }
  return gaps
}

const buildPrompt = (
  state: GomokuState,
  opponent: GameOpponent,
  locale: Locale
): AiMovePromptPayload => {
  const nearby = getNearbyEmptyCoords(state.board)
  const blackStones = collectStones(state.board, 1)
  const whiteStones = collectStones(state.board, 2)
  const blackRuns = describeContiguousRuns(state.board, 1, locale)
  const whiteRuns = describeContiguousRuns(state.board, 2, locale)
  const blackGaps = describeJumpPatterns(state.board, 1, locale)
  const whiteGaps = describeJumpPatterns(state.board, 2, locale)

  const recentMoves = state.history
    .slice(-10)
    .map((m) => `${m.side === 'player' ? 'B' : 'W'}:${coordToLabel(m)}`)
    .join(' -> ')

  const factBlocks =
    locale === 'zh-CN'
      ? [
          `黑棋(玩家 B)全部已落子(${blackStones.length})：${blackStones.join(', ') || '无'}`,
          `白棋(你 W)全部已落子(${whiteStones.length})：${whiteStones.join(', ') || '无'}`,
          blackRuns.length ? `黑方当前连线几何事实：${blackRuns.join('；')}` : '',
          blackGaps.length ? `黑方跳连断点几何事实：${blackGaps.join('；')}` : '',
          whiteRuns.length ? `白方当前连线几何事实：${whiteRuns.join('；')}` : '',
          whiteGaps.length ? `白方跳连断点几何事实：${whiteGaps.join('；')}` : '',
        ]
          .filter(Boolean)
          .join('\n')
      : [
          `Black (player B) stones (${blackStones.length}): ${blackStones.join(', ') || 'none'}`,
          `White (AI W) stones (${whiteStones.length}): ${whiteStones.join(', ') || 'none'}`,
          blackRuns.length ? `Black contiguous lines: ${blackRuns.join('; ')}` : '',
          blackGaps.length ? `Black collinear gaps: ${blackGaps.join('; ')}` : '',
          whiteRuns.length ? `White contiguous lines: ${whiteRuns.join('; ')}` : '',
          whiteGaps.length ? `White collinear gaps: ${whiteGaps.join('; ')}` : '',
        ]
          .filter(Boolean)
          .join('\n')

  const systemPrompt =
    locale === 'zh-CN'
      ? [
          opponent.systemPrompt,
          '你正在和用户下标准 15×15 五子棋（无禁手规则）。用户执黑先手 (B)，你执白后手 (W)。',
          '列坐标为 A-O（从左到右对应 0-14），行坐标为 1-15（从上到下对应 0-14），天元是 H8。',
          '下棋优先级：先看自己能否一步成5胜；再看对方是否有4连或跳4必须立刻封堵（尤其注意两端空位是否活四）；再看对方活三/跳三与己方攻守兼备的选点。请结合精确坐标与几何事实仔细推演，不要臆测坐标位置。',
          '必须只输出一个 JSON 对象，不要附加 markdown 代码块之外的任何解释：',
          '{"move":"坐标如I8","thoughtSummary":"15-35字当前局面想法总结","speech":"一句贴合你人设的简短对弈台词(最多30字)"}',
        ].join('\n')
      : [
          opponent.systemPrompt,
          'You are playing standard 15x15 Gomoku against the user. User plays Black (B), you play White (W).',
          'Columns are A-O (left to right), rows are 1-15 (top to bottom), center is H8.',
          'Priority: (1) win in 1 move if 4-in-row exists, (2) block opponent 4-in-row / jump-4 immediately, (3) handle open-threes and double threats. Verify every coordinate against the stone list and line facts.',
          'Reply ONLY with a JSON object:',
          '{"move":"coord like I8","thoughtSummary":"concise 1-sentence tactical summary","speech":"short in-character line under 20 words"}',
        ].join('\n')

  const userPrompt =
    locale === 'zh-CN'
      ? [
          `第 ${state.history.length + 1} 手，轮到你（白方 W）落子。`,
          recentMoves ? `最近落子：${recentMoves}` : '棋盘尚空。',
          '客观棋盘坐标与连线事实：',
          factBlocks,
          '当前棋盘矩阵：',
          formatBoardAscii(state.board),
          `战区附近空位参考：${nearby.slice(0, 28).join(', ')}`,
          '请选择一个尚未落子(.)的合法坐标，并以 JSON 输出。',
        ].join('\n\n')
      : [
          `Move #${state.history.length + 1}. Your turn as White (W).`,
          recentMoves ? `Recent moves: ${recentMoves}` : 'Board is empty.',
          'Exact board coordinates & line facts:',
          factBlocks,
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

export const gomokuRules: Omit<GamePlugin<GomokuState, GomokuCoord>, 'BoardComponent'> = {
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
}
