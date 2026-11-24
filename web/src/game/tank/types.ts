import type { GameStatus } from '../types.js'

export type TankDifficulty = 'normal' | 'hard' | 'master'

export type TankControlMode = 'directional' | 'classic'

export type MazeCell = {
  top: boolean
  right: boolean
  bottom: boolean
  left: boolean
}

export type WallSegment = {
  x1: number
  y1: number
  x2: number
  y2: number
  horizontal: boolean
}

export type TankSide = 'player' | 'ai'

export type TankEntity = {
  id: TankSide
  x: number
  y: number
  angle: number
  vx: number
  vy: number
  alive: boolean
  cooldown: number
  shield: boolean
  tripleShot: number
  speedBoostTimer: number
  muzzleFlash: number
}

export type BulletEntity = {
  id: number
  owner: TankSide
  x: number
  y: number
  vx: number
  vy: number
  age: number
  maxAge: number
  bounces: number
  maxBounces: number
  trail: Array<{ x: number; y: number }>
}

export type PowerUpKind = 'shield' | 'triple' | 'speed'

export type PowerUpEntity = {
  id: number
  kind: PowerUpKind
  x: number
  y: number
  col: number
  row: number
}

export type TankParticle = {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  maxLife: number
  color: string
  size: number
}

export type TankWorldState = {
  cols: number
  rows: number
  cellSize: number
  width: number
  height: number
  grid: MazeCell[][]
  walls: WallSegment[]
  player: TankEntity
  ai: TankEntity
  bullets: BulletEntity[]
  powerUps: PowerUpEntity[]
  particles: TankParticle[]
  nextEntityId: number
  elapsed: number
  powerUpTimer: number
}

export type TankInput = {
  moveX: number
  moveY: number
  fire: boolean
  desiredAngle?: number | null
}

export type AiDebugInfo = {
  mode: 'evade' | 'attack' | 'pursue' | 'pickup'
  path: Array<{ x: number; y: number }>
  threats: Array<{ x: number; y: number }>
  aimRay: Array<{ x: number; y: number }> | null
}

export type TankMatchState = {
  sessionToken: string
  round: number
  playerScore: number
  aiScore: number
  targetWins: number
  difficulty: TankDifficulty
  controlMode: TankControlMode
  status: GameStatus
  lastRoundNote: string
}
