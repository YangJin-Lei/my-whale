import { describe, expect, it } from 'vitest'
import { findAStarPath, TankAiController } from '../tank/ai.js'
import {
  bfsDistances,
  BULLET_SPEED,
  cellCenter,
  createInitialTankWorld,
  generateTankMaze,
  MAZE_COLS,
  MAZE_ROWS,
  stepBullet,
} from '../tank/engine.js'
import type { BulletEntity } from '../tank/types.js'

describe('tank engine & AI', () => {
  it('generates a 100%-connected random maze with separated spawns', () => {
    const { grid, playerSpawn, aiSpawn } = generateTankMaze(MAZE_COLS, MAZE_ROWS)
    const dists = bfsDistances(grid, playerSpawn.col, playerSpawn.row)
    for (let r = 0; r < MAZE_ROWS; r += 1) {
      for (let c = 0; c < MAZE_COLS; c += 1) {
        expect(dists[r][c]).toBeGreaterThanOrEqual(0)
      }
    }
    expect(dists[aiSpawn.row][aiSpawn.col]).toBeGreaterThanOrEqual(5)
  })

  it('reflects bullets cleanly off maze walls without tunneling', () => {
    const world = createInitialTankWorld()
    // Fire bullet right at top boundary y=0
    const b0 = {
      id: 99,
      owner: 'player' as const,
      x: 120,
      y: 12,
      vx: 60,
      vy: -BULLET_SPEED,
      age: 0.3,
      maxAge: 6,
      bounces: 0,
      maxBounces: 6,
      trail: [{ x: 120, y: 12 }],
    }
    let current: BulletEntity = b0
    let bounced = false
    for (let i = 0; i < 6; i += 1) {
      const next = stepBullet(current, 0.016, world.walls)
      expect(next).not.toBeNull()
      if (next) {
        if (next.vy > 0 && next.bounces > 0) {
          bounced = true
        }
        current = next
      }
    }
    expect(bounced).toBe(true)
    expect(current.y).toBeGreaterThan(0)
  })

  it('finds connected A* path and prefers safer low-danger routes', () => {
    const { grid } = generateTankMaze(MAZE_COLS, MAZE_ROWS)
    const path = findAStarPath(grid, 0, 0, MAZE_COLS - 1, MAZE_ROWS - 1)
    expect(path.length).toBeGreaterThan(1)
    expect(path[0]).toEqual({ col: 0, row: 0 })
    expect(path[path.length - 1]).toEqual({ col: MAZE_COLS - 1, row: MAZE_ROWS - 1 })

    // Verify each A* step crosses no wall
    for (let i = 0; i + 1 < path.length; i += 1) {
      const a = path[i]
      const b = path[i + 1]
      expect(Math.abs(a.col - b.col) + Math.abs(a.row - b.row)).toBe(1)
      if (b.col === a.col + 1) {
        expect(grid[a.row][a.col].right).toBe(false)
      } else if (b.col === a.col - 1) {
        expect(grid[a.row][a.col].left).toBe(false)
      } else if (b.row === a.row + 1) {
        expect(grid[a.row][a.col].bottom).toBe(false)
      } else {
        expect(grid[a.row][a.col].top).toBe(false)
      }
    }

    // Open-room detour around high-danger center cell
    const openGrid = Array.from({ length: 3 }, () =>
      Array.from({ length: 3 }, () => ({ top: false, right: false, bottom: false, left: false }))
    )
    const danger = [
      [0, 0, 0],
      [0, 20, 0],
      [0, 0, 0],
    ]
    const safePath = findAStarPath(openGrid, 0, 1, 2, 1, danger)
    expect(safePath.some((p) => p.col === 1 && p.row === 1)).toBe(false)
  })

  it('detects incoming bullets and switches AI immediately into evade mode', () => {
    const world = createInitialTankWorld()
    const pos = cellCenter(5, 3)
    world.ai.x = pos.x
    world.ai.y = pos.y
    world.bullets = [
      {
        id: 1,
        owner: 'player',
        x: pos.x - 45,
        y: pos.y,
        vx: BULLET_SPEED,
        vy: 0,
        age: 0.3,
        maxAge: 6,
        bounces: 0,
        maxBounces: 6,
        trail: [],
      },
    ]

    const ctrl = new TankAiController()
    const res = ctrl.decide(world, 'hard')
    expect(res.debug.mode).toBe('evade')
    expect(res.debug.threats.length).toBeGreaterThanOrEqual(1)
    expect(Math.hypot(res.input.moveX, res.input.moveY)).toBeGreaterThan(0.5)
  })
})
