import { useEffect, useState } from 'react'

export type PetMood =
  | 'idle'
  | 'runRight'
  | 'runLeft'
  | 'wave'
  | 'laugh'
  | 'sad'
  | 'speak'
  | 'think'
  | 'wait'

const DEFAULT_COLS = 8
const DEFAULT_ROWS = 9

const ANIMATIONS: Record<PetMood, { row: number; frames: number; fps: number }> = {
  idle: { row: 0, frames: 6, fps: 5 },
  runRight: { row: 1, frames: 8, fps: 10 },
  runLeft: { row: 2, frames: 8, fps: 10 },
  wave: { row: 3, frames: 4, fps: 6 },
  laugh: { row: 4, frames: 5, fps: 7 },
  sad: { row: 5, frames: 8, fps: 7 },
  speak: { row: 6, frames: 6, fps: 7 },
  think: { row: 7, frames: 6, fps: 7 },
  wait: { row: 8, frames: 6, fps: 6 },
}

/**
 * 通用桌宠渲染器：
 * - 默认按 8×9 精灵网格（单格 192×208）逐帧播放，兼容经典/Chiikawa/宠物自选库与本地上传包；
 * - 若用户上传的是单张静图（cols=1, rows=1），自动居中缩放展示。
 */
export const PetSprite = ({
  spriteUrl,
  mood,
  width = 76,
  cols = DEFAULT_COLS,
  rows = DEFAULT_ROWS,
  animate = true,
  className,
}: {
  spriteUrl: string
  mood: PetMood
  width?: number
  cols?: number
  rows?: number
  animate?: boolean
  className?: string
}) => {
  const safeCols = Math.max(1, cols)
  const safeRows = Math.max(1, rows)
  const isSheet = safeCols > 1 || safeRows > 1
  const anim = ANIMATIONS[mood]
  const rowIndex = Math.min(safeRows - 1, anim.row)
  const frameCount = Math.min(safeCols, anim.frames)
  const [frame, setFrame] = useState(0)

  useEffect(() => {
    setFrame(0)
    if (!animate || !isSheet || frameCount <= 1) {
      return
    }
    const intervalMs = Math.max(80, Math.round(1000 / anim.fps))
    const timer = window.setInterval(() => {
      setFrame((prev) => (prev + 1) % frameCount)
    }, intervalMs)
    return () => window.clearInterval(timer)
  }, [anim.fps, animate, frameCount, isSheet, mood, spriteUrl])

  const height = Math.round((width * 208) / 192)

  if (!isSheet) {
    return (
      <div
        className={className}
        aria-hidden="true"
        style={{
          width: `${width}px`,
          height: `${height}px`,
          backgroundImage: `url(${spriteUrl})`,
          backgroundRepeat: 'no-repeat',
          backgroundSize: 'contain',
          backgroundPosition: 'center',
          borderRadius: '10px',
        }}
      />
    )
  }

  const posX = safeCols > 1 ? (frame / (safeCols - 1)) * 100 : 0
  const posY = safeRows > 1 ? (rowIndex / (safeRows - 1)) * 100 : 0

  return (
    <div
      className={className}
      aria-hidden="true"
      style={{
        width: `${width}px`,
        height: `${height}px`,
        backgroundImage: `url(${spriteUrl})`,
        backgroundRepeat: 'no-repeat',
        backgroundSize: `${safeCols * 100}% ${safeRows * 100}%`,
        backgroundPosition: `${posX}% ${posY}%`,
      }}
    />
  )
}
