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

const SPRITE_COLS = 8
const SPRITE_ROWS = 9

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
 * 通用 8×9 精灵图桌宠渲染器（兼容奶蛙与 Chiikawa 全系列）。
 */
export const PetSprite = ({
  spriteUrl,
  mood,
  width = 76,
  animate = true,
  className,
}: {
  spriteUrl: string
  mood: PetMood
  width?: number
  animate?: boolean
  className?: string
}) => {
  const anim = ANIMATIONS[mood]
  const [frame, setFrame] = useState(0)

  useEffect(() => {
    setFrame(0)
    if (!animate) {
      return
    }
    const intervalMs = Math.max(80, Math.round(1000 / anim.fps))
    const timer = window.setInterval(() => {
      setFrame((prev) => (prev + 1) % anim.frames)
    }, intervalMs)
    return () => window.clearInterval(timer)
  }, [anim.fps, anim.frames, animate, mood, spriteUrl])

  const height = Math.round((width * 208) / 192)
  const posX = (frame / (SPRITE_COLS - 1)) * 100
  const posY = (anim.row / (SPRITE_ROWS - 1)) * 100

  return (
    <div
      className={className}
      aria-hidden="true"
      style={{
        width: `${width}px`,
        height: `${height}px`,
        backgroundImage: `url(${spriteUrl})`,
        backgroundRepeat: 'no-repeat',
        backgroundSize: `${SPRITE_COLS * 100}% ${SPRITE_ROWS * 100}%`,
        backgroundPosition: `${posX}% ${posY}%`,
      }}
    />
  )
}
