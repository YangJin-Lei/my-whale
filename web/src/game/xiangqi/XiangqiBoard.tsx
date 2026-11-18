import clsx from 'clsx'
import { useEffect, useMemo, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import type { BoardComponentProps } from '../types.js'
import {
  getLegalMovesForSquare,
  PIECE_LABELS,
  posToUcci,
  type XiangqiMove,
  type XiangqiPos,
  type XiangqiState,
} from './engine.js'
import styles from './Xiangqi.module.css'

const COL_CENTERS = Array.from({ length: 9 }, (_, i) => ((i + 0.5) / 9) * 100)
const ROW_CENTERS = Array.from({ length: 10 }, (_, i) => ((i + 0.5) / 10) * 100)

export const XiangqiBoard = ({
  state,
  disabled,
  onPlayerMove,
}: BoardComponentProps<XiangqiState, XiangqiMove>) => {
  const t = useTranslate()
  const [selected, setSelected] = useState<XiangqiPos | null>(null)
  const canInteract = !disabled && state.status === 'playing' && state.turn === 'player'
  const lastMove = state.history[state.history.length - 1]

  // 棋局状态变化（落子/悔棋/重开）时清空选中态
  useEffect(() => {
    setSelected(null)
  }, [state.history.length, state.status, state.turn])

  const legalTargets = useMemo(() => {
    if (!canInteract || !selected) {
      return new Set<string>()
    }
    const moves = getLegalMovesForSquare(state.board, 'player', selected.row, selected.col)
    return new Set(moves.map((pos) => `${pos.row},${pos.col}`))
  }, [canInteract, selected, state.board])

  const handleCellClick = (row: number, col: number) => {
    if (!canInteract) {
      return
    }
    const key = `${row},${col}`
    if (selected && legalTargets.has(key)) {
      onPlayerMove({ from: selected, to: { row, col } })
      setSelected(null)
      return
    }
    const piece = state.board[row][col]
    if (piece && piece.side === 'player') {
      if (selected && selected.row === row && selected.col === col) {
        setSelected(null)
      } else {
        setSelected({ row, col })
      }
      return
    }
    setSelected(null)
  }

  return (
    <div className={styles.stage}>
      <div className={styles.boardSlab} role="grid" aria-label="Xiangqi board">
        <svg
          className={styles.svgLines}
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {/* 10 条横线 */}
          {ROW_CENTERS.map((y, idx) => (
            <line
              key={`r-${idx}`}
              x1={COL_CENTERS[0]}
              y1={y}
              x2={COL_CENTERS[8]}
              y2={y}
              stroke="rgba(78, 46, 18, 0.72)"
              strokeWidth="0.38"
            />
          ))}
          {/* 左右两条通长边线 */}
          <line
            x1={COL_CENTERS[0]}
            y1={ROW_CENTERS[0]}
            x2={COL_CENTERS[0]}
            y2={ROW_CENTERS[9]}
            stroke="rgba(78, 46, 18, 0.78)"
            strokeWidth="0.45"
          />
          <line
            x1={COL_CENTERS[8]}
            y1={ROW_CENTERS[0]}
            x2={COL_CENTERS[8]}
            y2={ROW_CENTERS[9]}
            stroke="rgba(78, 46, 18, 0.78)"
            strokeWidth="0.45"
          />
          {/* 中间竖线在楚河汉界处断开 */}
          {COL_CENTERS.slice(1, 8).map((x, idx) => (
            <g key={`c-${idx}`}>
              <line
                x1={x}
                y1={ROW_CENTERS[0]}
                x2={x}
                y2={ROW_CENTERS[4]}
                stroke="rgba(78, 46, 18, 0.72)"
                strokeWidth="0.38"
              />
              <line
                x1={x}
                y1={ROW_CENTERS[5]}
                x2={x}
                y2={ROW_CENTERS[9]}
                stroke="rgba(78, 46, 18, 0.72)"
                strokeWidth="0.38"
              />
            </g>
          ))}
          {/* 黑方九宫斜线 */}
          <line
            x1={COL_CENTERS[3]}
            y1={ROW_CENTERS[0]}
            x2={COL_CENTERS[5]}
            y2={ROW_CENTERS[2]}
            stroke="rgba(78, 46, 18, 0.68)"
            strokeWidth="0.35"
          />
          <line
            x1={COL_CENTERS[5]}
            y1={ROW_CENTERS[0]}
            x2={COL_CENTERS[3]}
            y2={ROW_CENTERS[2]}
            stroke="rgba(78, 46, 18, 0.68)"
            strokeWidth="0.35"
          />
          {/* 红方九宫斜线 */}
          <line
            x1={COL_CENTERS[3]}
            y1={ROW_CENTERS[7]}
            x2={COL_CENTERS[5]}
            y2={ROW_CENTERS[9]}
            stroke="rgba(78, 46, 18, 0.68)"
            strokeWidth="0.35"
          />
          <line
            x1={COL_CENTERS[5]}
            y1={ROW_CENTERS[7]}
            x2={COL_CENTERS[3]}
            y2={ROW_CENTERS[9]}
            stroke="rgba(78, 46, 18, 0.68)"
            strokeWidth="0.35"
          />
        </svg>

        <div className={styles.riverText} aria-hidden="true">
          <span>{t('gameXiangqiRiverLeft')}</span>
          <span>{t('gameXiangqiRiverRight')}</span>
        </div>

        <div className={styles.grid}>
          {state.board.map((rowCells, row) =>
            rowCells.map((cell, col) => {
              const key = `${row},${col}`
              const isSelected = selected?.row === row && selected?.col === col
              const isLegalTarget = legalTargets.has(key)
              const isLastFrom = lastMove?.from.row === row && lastMove?.from.col === col
              const isLastTo = lastMove?.to.row === row && lastMove?.to.col === col
              const clickable =
                canInteract && ((cell !== null && cell.side === 'player') || isLegalTarget)

              return (
                <button
                  key={key}
                  type="button"
                  disabled={!clickable}
                  aria-label={
                    cell
                      ? `${PIECE_LABELS[cell.side][cell.type]} ${posToUcci({ row, col })}`
                      : posToUcci({ row, col })
                  }
                  className={styles.cell}
                  onClick={() => handleCellClick(row, col)}
                >
                  {isLastFrom && !cell ? <span className={styles.originRing} /> : null}
                  {cell ? (
                    <span
                      className={clsx(
                        styles.piece,
                        cell.side === 'player' ? styles.pieceRed : styles.pieceBlack,
                        isSelected && styles.pieceSelected,
                        isLastTo && styles.pieceLast
                      )}
                    >
                      {PIECE_LABELS[cell.side][cell.type]}
                    </span>
                  ) : null}
                  {isLegalTarget ? (
                    cell ? (
                      <span className={styles.captureRing} />
                    ) : (
                      <span className={styles.legalDot} />
                    )
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
