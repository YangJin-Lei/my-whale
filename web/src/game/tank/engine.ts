import type {
  BulletEntity,
  MazeCell,
  PowerUpKind,
  TankControlMode,
  TankEntity,
  TankInput,
  TankParticle,
  TankSide,
  TankWorldState,
  WallSegment,
} from './types.js'

export const MAZE_COLS = 11
export const MAZE_ROWS = 8
export const CELL_SIZE = 56
export const WORLD_W = MAZE_COLS * CELL_SIZE
export const WORLD_H = MAZE_ROWS * CELL_SIZE

export const TANK_RADIUS = 13.5
export const BULLET_RADIUS = 3.5
export const WALL_THICKNESS = 5
export const WALL_HALF = WALL_THICKNESS / 2
export const TANK_SPEED = 148
export const TANK_TURN_SPEED = 4.6
export const BULLET_SPEED = 290
export const BULLET_MAX_AGE = 6.5
export const BULLET_MAX_BOUNCES = 8
export const MAX_BULLETS_PER_TANK = 5
export const FIRE_COOLDOWN = 0.28
export const SELF_HIT_GRACE = 0.22

export const cellCenter = (col: number, row: number, cellSize = CELL_SIZE) => ({
  x: (col + 0.5) * cellSize,
  y: (row + 0.5) * cellSize,
})

export const posToCell = (x: number, y: number, cols = MAZE_COLS, rows = MAZE_ROWS) => ({
  col: Math.max(0, Math.min(cols - 1, Math.floor(x / CELL_SIZE))),
  row: Math.max(0, Math.min(rows - 1, Math.floor(y / CELL_SIZE))),
})

export const normalizeAngle = (angle: number): number => {
  let a = angle
  while (a > Math.PI) {
    a -= Math.PI * 2
  }
  while (a < -Math.PI) {
    a += Math.PI * 2
  }
  return a
}

export const extractWallsFromGrid = (
  grid: ReadonlyArray<ReadonlyArray<MazeCell>>,
  cellSize = CELL_SIZE
): WallSegment[] => {
  const rows = grid.length
  const cols = grid[0]?.length ?? 0
  const walls: WallSegment[] = []

  // 横向墙：顶部边界 + 每格底墙（避免重复内部共享边）
  for (let c = 0; c < cols; c += 1) {
    walls.push({
      x1: c * cellSize,
      y1: 0,
      x2: (c + 1) * cellSize,
      y2: 0,
      horizontal: true,
    })
  }
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      if (grid[r][c].bottom) {
        const y = (r + 1) * cellSize
        walls.push({
          x1: c * cellSize,
          y1: y,
          x2: (c + 1) * cellSize,
          y2: y,
          horizontal: true,
        })
      }
    }
  }

  // 纵向墙：左侧边界 + 每格右墙
  for (let r = 0; r < rows; r += 1) {
    walls.push({
      x1: 0,
      y1: r * cellSize,
      x2: 0,
      y2: (r + 1) * cellSize,
      horizontal: false,
    })
  }
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      if (grid[r][c].right) {
        const x = (c + 1) * cellSize
        walls.push({
          x1: x,
          y1: r * cellSize,
          x2: x,
          y2: (r + 1) * cellSize,
          horizontal: false,
        })
      }
    }
  }

  return walls
}

export const bfsDistances = (
  grid: ReadonlyArray<ReadonlyArray<MazeCell>>,
  startCol: number,
  startRow: number
): number[][] => {
  const rows = grid.length
  const cols = grid[0]?.length ?? 0
  const dist = Array.from({ length: rows }, () => Array.from({ length: cols }, () => -1))
  const queue: Array<[number, number]> = [[startCol, startRow]]
  dist[startRow][startCol] = 0

  for (let head = 0; head < queue.length; head += 1) {
    const [c, r] = queue[head]
    const d = dist[r][c]
    const cell = grid[r][c]

    if (!cell.top && r > 0 && dist[r - 1][c] === -1) {
      dist[r - 1][c] = d + 1
      queue.push([c, r - 1])
    }
    if (!cell.right && c + 1 < cols && dist[r][c + 1] === -1) {
      dist[r][c + 1] = d + 1
      queue.push([c + 1, r])
    }
    if (!cell.bottom && r + 1 < rows && dist[r + 1][c] === -1) {
      dist[r + 1][c] = d + 1
      queue.push([c, r + 1])
    }
    if (!cell.left && c > 0 && dist[r][c - 1] === -1) {
      dist[r][c - 1] = d + 1
      queue.push([c - 1, r])
    }
  }
  return dist
}

/** 生成 100% 连通且带多条绕行回路（~28% 去墙编织）的随机坦克迷宫 */
export const generateTankMaze = (
  cols = MAZE_COLS,
  rows = MAZE_ROWS
): {
  grid: MazeCell[][]
  walls: WallSegment[]
  playerSpawn: { col: number; row: number }
  aiSpawn: { col: number; row: number }
} => {
  const grid: MazeCell[][] = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ({
      top: true,
      right: true,
      bottom: true,
      left: true,
    }))
  )
  const visited = Array.from({ length: rows }, () => Array.from({ length: cols }, () => false))

  const startR = Math.floor(Math.random() * rows)
  const startC = Math.floor(Math.random() * cols)
  const stack: Array<[number, number]> = [[startC, startR]]
  visited[startR][startC] = true

  while (stack.length > 0) {
    const [c, r] = stack[stack.length - 1]
    const neighbors: Array<{ nc: number; nr: number; dir: 'top' | 'right' | 'bottom' | 'left' }> =
      []

    if (r > 0 && !visited[r - 1][c]) {
      neighbors.push({ nc: c, nr: r - 1, dir: 'top' })
    }
    if (c + 1 < cols && !visited[r][c + 1]) {
      neighbors.push({ nc: c + 1, nr: r, dir: 'right' })
    }
    if (r + 1 < rows && !visited[r + 1][c]) {
      neighbors.push({ nc: c, nr: r + 1, dir: 'bottom' })
    }
    if (c > 0 && !visited[r][c - 1]) {
      neighbors.push({ nc: c - 1, nr: r, dir: 'left' })
    }

    if (neighbors.length === 0) {
      stack.pop()
      continue
    }

    const pick = neighbors[Math.floor(Math.random() * neighbors.length)]
    if (pick.dir === 'top') {
      grid[r][c].top = false
      grid[pick.nr][pick.nc].bottom = false
    } else if (pick.dir === 'right') {
      grid[r][c].right = false
      grid[pick.nr][pick.nc].left = false
    } else if (pick.dir === 'bottom') {
      grid[r][c].bottom = false
      grid[pick.nr][pick.nc].top = false
    } else {
      grid[r][c].left = false
      grid[pick.nr][pick.nc].right = false
    }
    visited[pick.nr][pick.nc] = true
    stack.push([pick.nc, pick.nr])
  }

  // 随机拆除约 28% 的内墙形成经典坦克动荡式循环巷道与跳弹通道
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      if (c + 1 < cols && grid[r][c].right && Math.random() < 0.28) {
        grid[r][c].right = false
        grid[r][c + 1].left = false
      }
      if (r + 1 < rows && grid[r][c].bottom && Math.random() < 0.28) {
        grid[r][c].bottom = false
        grid[r + 1][c].top = false
      }
    }
  }

  const playerSpawn = { col: 1, row: Math.floor(rows / 2) }
  const distGrid = bfsDistances(grid, playerSpawn.col, playerSpawn.row)
  let aiSpawn = { col: cols - 2, row: Math.floor(rows / 2) }
  let bestDist = -1
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      if (distGrid[r][c] > bestDist) {
        bestDist = distGrid[r][c]
        aiSpawn = { col: c, row: r }
      }
    }
  }

  return {
    grid,
    walls: extractWallsFromGrid(grid, CELL_SIZE),
    playerSpawn,
    aiSpawn,
  }
}

export const createInitialTankWorld = (): TankWorldState => {
  const { grid, walls, playerSpawn, aiSpawn } = generateTankMaze(MAZE_COLS, MAZE_ROWS)
  const pPos = cellCenter(playerSpawn.col, playerSpawn.row)
  const aPos = cellCenter(aiSpawn.col, aiSpawn.row)
  return {
    cols: MAZE_COLS,
    rows: MAZE_ROWS,
    cellSize: CELL_SIZE,
    width: WORLD_W,
    height: WORLD_H,
    grid,
    walls,
    player: {
      id: 'player',
      x: pPos.x,
      y: pPos.y,
      angle: 0,
      vx: 0,
      vy: 0,
      alive: true,
      cooldown: 0.25,
      shield: false,
      tripleShot: 0,
      speedBoostTimer: 0,
      muzzleFlash: 0,
    },
    ai: {
      id: 'ai',
      x: aPos.x,
      y: aPos.y,
      angle: Math.PI,
      vx: 0,
      vy: 0,
      alive: true,
      cooldown: 0.35,
      shield: false,
      tripleShot: 0,
      speedBoostTimer: 0,
      muzzleFlash: 0,
    },
    bullets: [],
    powerUps: [],
    particles: [],
    nextEntityId: 1,
    elapsed: 0,
    powerUpTimer: 4.5,
  }
}

/** 精确圆-线段碰撞推离，保证坦克贴墙/拐角丝滑滑动不卡住 */
export const resolveCircleWalls = (
  x: number,
  y: number,
  radius: number,
  walls: readonly WallSegment[]
): { x: number; y: number; hit: boolean } => {
  let nx = x
  let ny = y
  let hit = false
  const minDist = radius + WALL_HALF

  for (let pass = 0; pass < 2; pass += 1) {
    for (const w of walls) {
      const dx = w.x2 - w.x1
      const dy = w.y2 - w.y1
      const lenSq = dx * dx + dy * dy
      let t = 0
      if (lenSq > 0) {
        t = Math.max(0, Math.min(1, ((nx - w.x1) * dx + (ny - w.y1) * dy) / lenSq))
      }
      const cx = w.x1 + t * dx
      const cy = w.y1 + t * dy
      const rx = nx - cx
      const ry = ny - cy
      const dist = Math.hypot(rx, ry)
      if (dist < minDist) {
        hit = true
        if (dist > 0.0001) {
          const push = minDist - dist
          nx += (rx / dist) * push
          ny += (ry / dist) * push
        } else if (w.horizontal) {
          ny += ny >= w.y1 ? minDist : -minDist
        } else {
          nx += nx >= w.x1 ? minDist : -minDist
        }
      }
    }
  }

  return {
    x: Math.max(minDist, Math.min(WORLD_W - minDist, nx)),
    y: Math.max(minDist, Math.min(WORLD_H - minDist, ny)),
    hit,
  }
}

type RayHit = {
  t: number
  x: number
  y: number
  horizontal: boolean
}

const intersectRayWalls = (
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  maxDist: number,
  walls: readonly WallSegment[]
): RayHit | null => {
  let best: RayHit | null = null
  const pad = BULLET_RADIUS + WALL_HALF

  for (const w of walls) {
    if (w.horizontal) {
      if (Math.abs(dy) < 1e-6) {
        continue
      }
      const targetY = dy > 0 ? w.y1 - pad : w.y1 + pad
      const t = (targetY - oy) / dy
      if (t <= 0.001 || t > maxDist) {
        continue
      }
      const hx = ox + dx * t
      if (hx >= w.x1 - pad && hx <= w.x2 + pad) {
        if (!best || t < best.t) {
          best = { t, x: hx, y: targetY, horizontal: true }
        }
      }
    } else {
      if (Math.abs(dx) < 1e-6) {
        continue
      }
      const targetX = dx > 0 ? w.x1 - pad : w.x1 + pad
      const t = (targetX - ox) / dx
      if (t <= 0.001 || t > maxDist) {
        continue
      }
      const hy = oy + dy * t
      if (hy >= w.y1 - pad && hy <= w.y2 + pad) {
        if (!best || t < best.t) {
          best = { t, x: targetX, y: hy, horizontal: false }
        }
      }
    }
  }
  return best
}

/** 从 (ox, oy) 沿 angle 发射最多 maxBounces 次反弹的射线，用于直瞄与跳弹检测 */
export const castBounceRay = (
  ox: number,
  oy: number,
  angle: number,
  maxDist: number,
  maxBounces: number,
  walls: readonly WallSegment[]
): Array<{ x: number; y: number }> => {
  const pts: Array<{ x: number; y: number }> = [{ x: ox, y: oy }]
  let x = ox
  let y = oy
  let dx = Math.cos(angle)
  let dy = Math.sin(angle)
  let remaining = maxDist

  for (let b = 0; b <= maxBounces && remaining > 1; b += 1) {
    const hit = intersectRayWalls(x, y, dx, dy, remaining, walls)
    if (!hit) {
      pts.push({ x: x + dx * remaining, y: y + dy * remaining })
      break
    }
    pts.push({ x: hit.x, y: hit.y })
    remaining -= hit.t
    if (hit.horizontal) {
      dy = -dy
    } else {
      dx = -dx
    }
    x = hit.x + dx * 0.5
    y = hit.y + dy * 0.5
  }
  return pts
}

/** 子步步进子弹，防止高速穿透薄墙，并精确按水平/垂直墙面法线反射 */
export const stepBullet = (
  bullet: BulletEntity,
  dt: number,
  walls: readonly WallSegment[]
): BulletEntity | null => {
  const subSteps = 3
  const subDt = dt / subSteps
  let x = bullet.x
  let y = bullet.y
  let vx = bullet.vx
  let vy = bullet.vy
  let bounces = bullet.bounces
  const pad = BULLET_RADIUS + WALL_HALF

  for (let step = 0; step < subSteps; step += 1) {
    let nx = x + vx * subDt
    let ny = y + vy * subDt
    let bouncedH = false
    let bouncedV = false

    for (const w of walls) {
      if (w.horizontal) {
        if (nx >= w.x1 - pad && nx <= w.x2 + pad) {
          const prevSide = y - w.y1
          const nextSide = ny - w.y1
          if (
            Math.abs(nextSide) < pad ||
            (prevSide * nextSide < 0 && Math.abs(prevSide) < pad + 18)
          ) {
            bouncedH = true
            ny = prevSide >= 0 ? w.y1 + pad + 0.4 : w.y1 - pad - 0.4
          }
        }
      } else if (ny >= w.y1 - pad && ny <= w.y2 + pad) {
        const prevSide = x - w.x1
        const nextSide = nx - w.x1
        if (
          Math.abs(nextSide) < pad ||
          (prevSide * nextSide < 0 && Math.abs(prevSide) < pad + 18)
        ) {
          bouncedV = true
          nx = prevSide >= 0 ? w.x1 + pad + 0.4 : w.x1 - pad - 0.4
        }
      }
    }

    if (bouncedH) {
      vy = -vy
      bounces += 1
    }
    if (bouncedV) {
      vx = -vx
      bounces += 1
    }
    if (nx < pad) {
      nx = pad + 0.4
      vx = Math.abs(vx)
      bounces += 1
    } else if (nx > WORLD_W - pad) {
      nx = WORLD_W - pad - 0.4
      vx = -Math.abs(vx)
      bounces += 1
    }
    if (ny < pad) {
      ny = pad + 0.4
      vy = Math.abs(vy)
      bounces += 1
    } else if (ny > WORLD_H - pad) {
      ny = WORLD_H - pad - 0.4
      vy = -Math.abs(vy)
      bounces += 1
    }

    x = nx
    y = ny
    if (bounces > bullet.maxBounces) {
      return null
    }
  }

  const nextAge = bullet.age + dt
  if (nextAge >= bullet.maxAge) {
    return null
  }
  const trail = [...bullet.trail, { x, y }].slice(-8)
  return {
    ...bullet,
    x,
    y,
    vx,
    vy,
    age: nextAge,
    bounces,
    trail,
  }
}

const spawnBurst = (
  particles: TankParticle[],
  x: number,
  y: number,
  color: string,
  count: number
) => {
  for (let i = 0; i < count; i += 1) {
    const a = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.4
    const spd = 45 + Math.random() * 140
    particles.push({
      x,
      y,
      vx: Math.cos(a) * spd,
      vy: Math.sin(a) * spd,
      life: 0.45 + Math.random() * 0.35,
      maxLife: 0.75,
      color,
      size: 2.5 + Math.random() * 3.5,
    })
  }
}

const updateTankMotion = (
  tank: TankEntity,
  input: TankInput,
  controlMode: TankControlMode,
  dt: number,
  walls: readonly WallSegment[]
): TankEntity => {
  if (!tank.alive) {
    return tank
  }

  const speedMult = tank.speedBoostTimer > 0 ? 1.38 : 1
  const maxSpd = TANK_SPEED * speedMult
  let angle = tank.angle
  let vx = 0
  let vy = 0

  if (controlMode === 'directional') {
    const mag = Math.hypot(input.moveX, input.moveY)
    if (mag > 0.08) {
      const clampedMag = Math.min(1, mag)
      const moveAngle = Math.atan2(input.moveY, input.moveX)
      const targetAngle = input.desiredAngle ?? moveAngle
      const diff = normalizeAngle(targetAngle - angle)
      const maxStep = TANK_TURN_SPEED * 2.1 * dt
      angle =
        Math.abs(diff) <= maxStep ? targetAngle : normalizeAngle(angle + Math.sign(diff) * maxStep)
      vx = (input.moveX / mag) * maxSpd * clampedMag
      vy = (input.moveY / mag) * maxSpd * clampedMag
    } else if (input.desiredAngle !== undefined && input.desiredAngle !== null) {
      const diff = normalizeAngle(input.desiredAngle - angle)
      const maxStep = TANK_TURN_SPEED * 2.1 * dt
      angle =
        Math.abs(diff) <= maxStep
          ? input.desiredAngle
          : normalizeAngle(angle + Math.sign(diff) * maxStep)
    }
  } else {
    // 经典坦克操控：moveX 控制炮塔车身左右旋转，-moveY 控制前进/倒车
    if (Math.abs(input.moveX) > 0.08) {
      angle = normalizeAngle(angle + input.moveX * TANK_TURN_SPEED * dt)
    }
    const throttle = -input.moveY
    if (Math.abs(throttle) > 0.08) {
      const dir = throttle > 0 ? 1 : -0.72
      vx = Math.cos(angle) * maxSpd * Math.abs(throttle) * dir
      vy = Math.sin(angle) * maxSpd * Math.abs(throttle) * dir
    }
  }

  const resolved = resolveCircleWalls(tank.x + vx * dt, tank.y + vy * dt, TANK_RADIUS, walls)

  return {
    ...tank,
    x: resolved.x,
    y: resolved.y,
    angle,
    vx,
    vy,
    cooldown: Math.max(0, tank.cooldown - dt),
    speedBoostTimer: Math.max(0, tank.speedBoostTimer - dt),
    muzzleFlash: Math.max(0, tank.muzzleFlash - dt),
  }
}

const fireTankWeapon = (
  tank: TankEntity,
  world: TankWorldState
): { updatedTank: TankEntity; newBullets: BulletEntity[] } => {
  const activeOwned = world.bullets.filter((b) => b.owner === tank.id).length
  if (!tank.alive || tank.cooldown > 0 || activeOwned >= MAX_BULLETS_PER_TANK) {
    return { updatedTank: tank, newBullets: [] }
  }

  const angles =
    tank.tripleShot > 0 ? [tank.angle - 0.16, tank.angle, tank.angle + 0.16] : [tank.angle]
  const barrelLen = TANK_RADIUS + BULLET_RADIUS + 3
  const spawned: BulletEntity[] = []

  for (const shotAngle of angles) {
    if (activeOwned + spawned.length >= MAX_BULLETS_PER_TANK) {
      break
    }
    const rawX = tank.x + Math.cos(shotAngle) * barrelLen
    const rawY = tank.y + Math.sin(shotAngle) * barrelLen
    const safePos = resolveCircleWalls(rawX, rawY, BULLET_RADIUS, world.walls)
    const id = world.nextEntityId
    world.nextEntityId += 1
    spawned.push({
      id,
      owner: tank.id,
      x: safePos.x,
      y: safePos.y,
      vx: Math.cos(shotAngle) * BULLET_SPEED,
      vy: Math.sin(shotAngle) * BULLET_SPEED,
      age: 0,
      maxAge: BULLET_MAX_AGE,
      bounces: 0,
      maxBounces: BULLET_MAX_BOUNCES,
      trail: [{ x: safePos.x, y: safePos.y }],
    })
  }

  return {
    updatedTank: {
      ...tank,
      cooldown: FIRE_COOLDOWN,
      tripleShot: Math.max(0, tank.tripleShot - 1),
      muzzleFlash: 0.1,
    },
    newBullets: spawned,
  }
}

export const stepTankWorld = (
  world: TankWorldState,
  playerInput: TankInput,
  aiInput: TankInput,
  controlMode: TankControlMode,
  dt: number
): 'player' | 'ai' | 'draw' | null => {
  world.elapsed += dt

  world.player = updateTankMotion(world.player, playerInput, controlMode, dt, world.walls)
  world.ai = updateTankMotion(world.ai, aiInput, 'directional', dt, world.walls)

  // 双方互不重叠推离
  if (world.player.alive && world.ai.alive) {
    const dx = world.ai.x - world.player.x
    const dy = world.ai.y - world.player.y
    const dist = Math.hypot(dx, dy)
    const minSep = TANK_RADIUS * 2
    if (dist > 0.001 && dist < minSep) {
      const push = (minSep - dist) * 0.5
      const ux = (dx / dist) * push
      const uy = (dy / dist) * push
      const pRes = resolveCircleWalls(
        world.player.x - ux,
        world.player.y - uy,
        TANK_RADIUS,
        world.walls
      )
      const aRes = resolveCircleWalls(world.ai.x + ux, world.ai.y + uy, TANK_RADIUS, world.walls)
      world.player.x = pRes.x
      world.player.y = pRes.y
      world.ai.x = aRes.x
      world.ai.y = aRes.y
    }
  }

  if (playerInput.fire) {
    const fired = fireTankWeapon(world.player, world)
    world.player = fired.updatedTank
    world.bullets.push(...fired.newBullets)
  }
  if (aiInput.fire) {
    const fired = fireTankWeapon(world.ai, world)
    world.ai = fired.updatedTank
    world.bullets.push(...fired.newBullets)
  }

  // 刷新随机道具（最多保留 2 个）
  world.powerUpTimer -= dt
  if (world.powerUpTimer <= 0) {
    world.powerUpTimer = 8.5
    if (world.powerUps.length < 2) {
      const col = Math.floor(Math.random() * world.cols)
      const row = Math.floor(Math.random() * world.rows)
      const center = cellCenter(col, row, world.cellSize)
      const kinds: readonly PowerUpKind[] = ['shield', 'triple', 'speed']
      const kind = kinds[Math.floor(Math.random() * kinds.length)]
      const id = world.nextEntityId
      world.nextEntityId += 1
      world.powerUps.push({ id, kind, x: center.x, y: center.y, col, row })
    }
  }

  // 道具拾取判定
  const remainingPowerUps = []
  for (const pu of world.powerUps) {
    let pickedBy: TankEntity | null = null
    if (
      world.player.alive &&
      Math.hypot(world.player.x - pu.x, world.player.y - pu.y) < TANK_RADIUS + 11
    ) {
      pickedBy = world.player
    } else if (
      world.ai.alive &&
      Math.hypot(world.ai.x - pu.x, world.ai.y - pu.y) < TANK_RADIUS + 11
    ) {
      pickedBy = world.ai
    }
    if (pickedBy) {
      if (pu.kind === 'shield') {
        pickedBy.shield = true
      } else if (pu.kind === 'triple') {
        pickedBy.tripleShot = 2
      } else {
        pickedBy.speedBoostTimer = 6
      }
      spawnBurst(world.particles, pu.x, pu.y, '#38bdf8', 10)
    } else {
      remainingPowerUps.push(pu)
    }
  }
  world.powerUps = remainingPowerUps

  // 推进子弹并检测击中
  const nextBullets: BulletEntity[] = []
  for (const rawBullet of world.bullets) {
    const b = stepBullet(rawBullet, dt, world.walls)
    if (!b) {
      continue
    }

    let consumed = false
    const targets: Array<{ side: TankSide; tank: TankEntity }> = [
      { side: 'player', tank: world.player },
      { side: 'ai', tank: world.ai },
    ]
    for (const { side, tank } of targets) {
      if (!tank.alive) {
        continue
      }
      if (b.owner === side && b.age < SELF_HIT_GRACE) {
        continue
      }
      const dist = Math.hypot(b.x - tank.x, b.y - tank.y)
      if (dist <= TANK_RADIUS + BULLET_RADIUS) {
        consumed = true
        if (tank.shield) {
          tank.shield = false
          spawnBurst(world.particles, tank.x, tank.y, '#38bdf8', 14)
        } else {
          tank.alive = false
          spawnBurst(world.particles, tank.x, tank.y, side === 'player' ? '#60a5fa' : '#f97316', 24)
        }
        break
      }
    }
    if (!consumed) {
      nextBullets.push(b)
    }
  }
  world.bullets = nextBullets

  // 更新粒子效果
  const nextParticles: TankParticle[] = []
  for (const pt of world.particles) {
    const nextLife = pt.life - dt
    if (nextLife > 0) {
      nextParticles.push({
        ...pt,
        x: pt.x + pt.vx * dt,
        y: pt.y + pt.vy * dt,
        vx: pt.vx * 0.94,
        vy: pt.vy * 0.94,
        life: nextLife,
      })
    }
  }
  world.particles = nextParticles

  if (!world.player.alive && !world.ai.alive) {
    return 'draw'
  }
  if (!world.ai.alive) {
    return 'player'
  }
  if (!world.player.alive) {
    return 'ai'
  }
  return null
}
