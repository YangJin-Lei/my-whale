import clsx from 'clsx'
import { useRef, useState } from 'react'
import type { BoardComponentProps } from '../types.js'
import { coordToLabel, GOMOKU_SIZE, type GomokuCoord, type GomokuState } from './engine.js'
import styles from './Gomoku.module.css'

const COL_HEADERS = 'ABCDEFGHIJKLMNO'.split('')
const ROW_HEADERS = Array.from({ length: GOMOKU_SIZE }, (_, i) => String(i + 1))
const LOUPE_OFFSETS = [-2, -1, 0, 1, 2] as const
const LOUPE_SIZE = 112

const isStarPoint = (row: number, col: number) =>
  (row === 3 || row === 7 || row === 11) && (col === 3 || col === 7 || col === 11)

type DragPreview = {
  pointerId: number
  isTouch: boolean
  startX: number
  startY: number
  clientX: number
  clientY: number
  coord: GomokuCoord | null
  active: boolean
}

export const GomokuBoard = ({
  state,
  disabled,
  onPlayerMove,
}: BoardComponentProps<GomokuState, GomokuCoord>) => {
  const lastMove = state.history[state.history.length - 1]
  const winSet = new Set(state.winLine.map((p) => `${p.row},${p.col}`))
  const canPlace = !disabled && state.status === 'playing' && state.turn === 'player'

  const stageRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragPreview | null>(null)
  const suppressClickRef = useRef(false)
  const [preview, setPreview] = useState<DragPreview | null>(null)

  const resolveCoord = (clientX: number, clientY: number): GomokuCoord | null => {
    const grid = gridRef.current
    if (!grid) {
      return null
    }
    const rect = grid.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) {
      return null
    }
    const margin = 12
    if (
      clientX < rect.left - margin ||
      clientX > rect.right + margin ||
      clientY < rect.top - margin ||
      clientY > rect.bottom + margin
    ) {
      return null
    }
    const relX = (clientX - rect.left) / rect.width
    const relY = (clientY - rect.top) / rect.height
    const col = Math.max(0, Math.min(GOMOKU_SIZE - 1, Math.floor(relX * GOMOKU_SIZE)))
    const row = Math.max(0, Math.min(GOMOKU_SIZE - 1, Math.floor(relY * GOMOKU_SIZE)))
    return { row, col }
  }

  const updateDrag = (next: DragPreview | null) => {
    dragRef.current = next
    setPreview(next && next.active ? next : null)
  }

  const getLoupePos = (item: DragPreview): { left: number; top: number } => {
    const stageRect = stageRef.current?.getBoundingClientRect()
    const stageW = stageRect?.width ?? 360
    const localX = stageRect ? item.clientX - stageRect.left : 180
    const localY = stageRect ? item.clientY - stageRect.top : 180
    const col = item.coord?.col ?? 7
    const preferX =
      col >= 11 ? localX - LOUPE_SIZE - 14 : col <= 3 ? localX + 14 : localX - LOUPE_SIZE / 2
    const left = Math.max(4, Math.min(stageW - LOUPE_SIZE - 4, preferX))
    const top = localY < LOUPE_SIZE + 28 ? localY + 26 : localY - LOUPE_SIZE - 22
    return { left, top }
  }

  const loupeTarget = preview?.active ? preview.coord : null
  const loupePos = preview ? getLoupePos(preview) : null
  const loupeCellOccupied = loupeTarget
    ? state.board[loupeTarget.row][loupeTarget.col] !== 0
    : false

  return (
    <div ref={stageRef} className={styles.stage}>
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
        <div
          ref={gridRef}
          className={clsx(styles.grid, canPlace && styles.gridInteractive)}
          onPointerDown={(event) => {
            if (!canPlace || (event.pointerType === 'mouse' && event.button !== 0)) {
              return
            }
            const coord = resolveCoord(event.clientX, event.clientY)
            const isTouch = event.pointerType === 'touch' || event.pointerType === 'pen'
            if (isTouch) {
              try {
                event.currentTarget.setPointerCapture(event.pointerId)
              } catch {
                // 忽略不支持捕获的指针
              }
            }
            updateDrag({
              pointerId: event.pointerId,
              isTouch,
              startX: event.clientX,
              startY: event.clientY,
              clientX: event.clientX,
              clientY: event.clientY,
              coord,
              active: isTouch,
            })
          }}
          onPointerMove={(event) => {
            const current = dragRef.current
            if (!current || current.pointerId !== event.pointerId) {
              return
            }
            const movedDist = Math.hypot(
              event.clientX - current.startX,
              event.clientY - current.startY
            )
            const active = current.active || movedDist > 6
            if (active && !current.active) {
              try {
                event.currentTarget.setPointerCapture(event.pointerId)
              } catch {
                // 忽略不支持捕获的指针
              }
            }
            updateDrag({
              ...current,
              clientX: event.clientX,
              clientY: event.clientY,
              coord: resolveCoord(event.clientX, event.clientY),
              active,
            })
          }}
          onPointerUp={(event) => {
            const current = dragRef.current
            if (!current || current.pointerId !== event.pointerId) {
              return
            }
            const coord = resolveCoord(event.clientX, event.clientY)
            const shouldPlace = current.active && coord && state.board[coord.row][coord.col] === 0
            updateDrag(null)
            if (shouldPlace && coord && canPlace) {
              suppressClickRef.current = true
              window.setTimeout(() => {
                suppressClickRef.current = false
              }, 80)
              onPlayerMove(coord)
            } else if (current.active) {
              suppressClickRef.current = true
              window.setTimeout(() => {
                suppressClickRef.current = false
              }, 80)
            }
          }}
          onPointerCancel={() => {
            updateDrag(null)
          }}
        >
          {state.board.map((rowCells, row) =>
            rowCells.map((cell, col) => {
              const isLast = lastMove?.row === row && lastMove?.col === col
              const isWin = winSet.has(`${row},${col}`)
              const isPreviewed =
                loupeTarget !== null && loupeTarget.row === row && loupeTarget.col === col
              const occupied = cell !== 0
              const label = coordToLabel({ row, col })
              return (
                <button
                  key={label}
                  type="button"
                  aria-disabled={!canPlace || occupied}
                  aria-label={label}
                  className={clsx(
                    styles.cell,
                    row === 0 && styles.edgeTop,
                    row === GOMOKU_SIZE - 1 && styles.edgeBottom,
                    col === 0 && styles.edgeLeft,
                    col === GOMOKU_SIZE - 1 && styles.edgeRight,
                    (!canPlace || occupied) && styles.cellDisabled,
                    isPreviewed && !occupied && styles.cellPreview
                  )}
                  onClick={() => {
                    if (suppressClickRef.current) {
                      suppressClickRef.current = false
                      return
                    }
                    if (!canPlace || occupied) {
                      return
                    }
                    onPlayerMove({ row, col })
                  }}
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

      {loupeTarget && loupePos ? (
        <div
          className={styles.magnifier}
          style={{ left: `${loupePos.left}px`, top: `${loupePos.top}px` }}
          aria-hidden="true"
        >
          <div className={styles.magnifierGrid}>
            {LOUPE_OFFSETS.map((dr) =>
              LOUPE_OFFSETS.map((dc) => {
                const r = loupeTarget.row + dr
                const c = loupeTarget.col + dc
                const inBounds = r >= 0 && r < GOMOKU_SIZE && c >= 0 && c < GOMOKU_SIZE
                const cell = inBounds ? state.board[r][c] : -1
                const isCenter = dr === 0 && dc === 0
                return (
                  <div
                    key={`${dr},${dc}`}
                    className={clsx(
                      styles.magnifierCell,
                      !inBounds && styles.magnifierOut,
                      inBounds && r === 0 && styles.edgeTop,
                      inBounds && r === GOMOKU_SIZE - 1 && styles.edgeBottom,
                      inBounds && c === 0 && styles.edgeLeft,
                      inBounds && c === GOMOKU_SIZE - 1 && styles.edgeRight,
                      isCenter && styles.magnifierCenter
                    )}
                  >
                    {cell === 1 || cell === 2 ? (
                      <span
                        className={clsx(
                          styles.stone,
                          cell === 1 ? styles.stoneBlack : styles.stoneWhite
                        )}
                      />
                    ) : isCenter ? (
                      <span
                        className={clsx(
                          styles.magnifierTargetStone,
                          loupeCellOccupied && styles.magnifierTargetBlocked
                        )}
                      />
                    ) : inBounds && isStarPoint(r, c) ? (
                      <span className={styles.starDot} />
                    ) : null}
                  </div>
                )
              })
            )}
          </div>
          <span className={styles.magnifierCoord}>{coordToLabel(loupeTarget)}</span>
        </div>
      ) : null}
    </div>
  )
}
