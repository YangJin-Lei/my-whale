import clsx from 'clsx'
import type { BoardComponentProps } from '../types.js'
import { coordToLabel, GOMOKU_SIZE, type GomokuCoord, type GomokuState } from './engine.js'
import styles from './Gomoku.module.css'

const COL_HEADERS = 'ABCDEFGHIJKLMNO'.split('')
const ROW_HEADERS = Array.from({ length: GOMOKU_SIZE }, (_, i) => String(i + 1))

const isStarPoint = (row: number, col: number) =>
  (row === 3 || row === 7 || row === 11) && (col === 3 || col === 7 || col === 11)

export const GomokuBoard = ({
  state,
  disabled,
  onPlayerMove,
}: BoardComponentProps<GomokuState, GomokuCoord>) => {
  const lastMove = state.history[state.history.length - 1]
  const winSet = new Set(state.winLine.map((p) => `${p.row},${p.col}`))
  const canPlace = !disabled && state.status === 'playing' && state.turn === 'player'

  return (
    <div className={styles.stage}>
      <div className={styles.boardSlab} role="grid" aria-label="Gomoku board">
        <div className={styles.colLabels} aria-hidden="true">
          {COL_HEADERS.map((col) => (
            <span key={col}>{col}</span>
          ))}
        </div>
        <div className={styles.rowLabels} aria-hidden="true">
          {ROW_HEADERS.map((row) => (
            <span key={row}>{row}</span>
          ))}
        </div>
        <div className={styles.grid}>
          {state.board.map((rowCells, row) =>
            rowCells.map((cell, col) => {
              const isLast = lastMove?.row === row && lastMove?.col === col
              const isWin = winSet.has(`${row},${col}`)
              const occupied = cell !== 0
              const label = coordToLabel({ row, col })
              return (
                <button
                  key={label}
                  type="button"
                  disabled={!canPlace || occupied}
                  aria-label={label}
                  className={clsx(
                    styles.cell,
                    row === 0 && styles.edgeTop,
                    row === GOMOKU_SIZE - 1 && styles.edgeBottom,
                    col === 0 && styles.edgeLeft,
                    col === GOMOKU_SIZE - 1 && styles.edgeRight
                  )}
                  onClick={() => onPlayerMove({ row, col })}
                >
                  {occupied ? (
                    <span
                      className={clsx(
                        styles.stone,
                        cell === 1 ? styles.stoneBlack : styles.stoneWhite,
                        isLast && styles.lastMarker,
                        isWin && styles.winMarker
                      )}
                    />
                  ) : isStarPoint(row, col) ? (
                    <span className={styles.starDot} />
                  ) : canPlace ? (
                    <span className={styles.hoverGhost} />
                  ) : null}
                </button>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
