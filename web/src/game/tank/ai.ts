import {
  BULLET_RADIUS,
  BULLET_SPEED,
  castBounceRay,
  cellCenter,
  MAX_BULLETS_PER_TANK,
  normalizeAngle,
  posToCell,
  resolveCircleWalls,
  SELF_HIT_GRACE,
  stepBullet,
  TANK_RADIUS,
} from './engine.js'
import type {
  AiDebugInfo,
  BulletEntity,
  MazeCell,
  TankDifficulty,
  TankEntity,
  TankInput,
  TankWorldState,
  WallSegment,
} from './types.js'

export type BulletThreat = {
  bulletId: number
  tti: number
  cpaDist: number
  impactX: number
  impactY: number
  vx: number
  vy: number
}

/** 危险权重感知 A* 寻路：自动绕开墙体与子弹预测经过的高危格子 */
export const findAStarPath = (
  grid: ReadonlyArray<ReadonlyArray<MazeCell>>,
  startCol: number,
  startRow: number,
  goalCol: number,
  goalRow: number,
  dangerGrid?: ReadonlyArray<ReadonlyArray<number>>
): Array<{ col: number; row: number }> => {
  const rows = grid.length
  const cols = grid[0]?.length ?? 0
  if (startCol === goalCol && startRow === goalRow) {
    return [{ col: startCol, row: startRow }]
  }

  const keyOf = (c: number, r: number) => r * cols + c
  const gScore = Array.from({ length: rows }, () => Array.from({ length: cols }, () => Infinity))
  const fScore = Array.from({ length: rows }, () => Array.from({ length: cols }, () => Infinity))
  const cameFrom = new Map<number, [number, number]>()
  const closed = Array.from({ length: rows }, () => Array.from({ length: cols }, () => false))

  const heuristic = (c: number, r: number) => Math.abs(c - goalCol) + Math.abs(r - goalRow)
  gScore[startRow][startCol] = 0
  fScore[startRow][startCol] = heuristic(startCol, startRow)

  const open: Array<[number, number]> = [[startCol, startRow]]

  while (open.length > 0) {
    let bestIdx = 0
    for (let i = 1; i < open.length; i += 1) {
      const [c, r] = open[i]
      const [bc, br] = open[bestIdx]
      if (fScore[r][c] < fScore[br][bc]) {
        bestIdx = i
      }
    }

    const [currC, currR] = open.splice(bestIdx, 1)[0]
    if (currC === goalCol && currR === goalRow) {
      const path: Array<{ col: number; row: number }> = []
      let traceC = goalCol
      let traceR = goalRow
      for (;;) {
        path.unshift({ col: traceC, row: traceR })
        const prev = cameFrom.get(keyOf(traceC, traceR))
        if (!prev) {
          break
        }
        traceC = prev[0]
        traceR = prev[1]
      }
      return path
    }

    closed[currR][currC] = true
    const cell = grid[currR][currC]
    const neighbors: Array<[number, number]> = []
    if (!cell.top && currR > 0) {
      neighbors.push([currC, currR - 1])
    }
    if (!cell.right && currC + 1 < cols) {
      neighbors.push([currC + 1, currR])
    }
    if (!cell.bottom && currR + 1 < rows) {
      neighbors.push([currC, currR + 1])
    }
    if (!cell.left && currC > 0) {
      neighbors.push([currC - 1, currR])
    }

    for (const [nc, nr] of neighbors) {
      if (closed[nr][nc]) {
        continue
      }
      const hazard = dangerGrid ? (dangerGrid[nr]?.[nc] ?? 0) : 0
      const tentativeG = gScore[currR][currC] + 1 + hazard
      if (tentativeG < gScore[nr][nc]) {
        cameFrom.set(keyOf(nc, nr), [currC, currR])
        gScore[nr][nc] = tentativeG
        fScore[nr][nc] = tentativeG + heuristic(nc, nr)
        if (!open.some(([oc, or]) => oc === nc && or === nr)) {
          open.push([nc, nr])
        }
      }
    }
  }

  return []
}

/** 模拟所有现存子弹（含多段墙壁反弹），构建威胁名单与 A* 避险热度图 */
export const analyzeBulletThreats = (
  world: TankWorldState,
  aiTank: TankEntity,
  horizonSec: number
): {
  threats: BulletThreat[]
  dangerGrid: number[][]
} => {
  const dangerGrid = Array.from({ length: world.rows }, () =>
    Array.from({ length: world.cols }, () => 0)
  )
  const threats: BulletThreat[] = []
  const dangerRadius = TANK_RADIUS + BULLET_RADIUS + 20
  const simDt = 0.03
  const maxSteps = Math.max(8, Math.round(horizonSec / simDt))

  for (const source of world.bullets) {
    let sim: BulletEntity | null = { ...source, trail: [] }
    let bestDist = Infinity
    let bestT = 0
    let bestX = sim.x
    let bestY = sim.y
    let bestVx = sim.vx
    let bestVy = sim.vy

    for (let step = 0; step < maxSteps && sim; step += 1) {
      const t = step * simDt
      const cell = posToCell(sim.x, sim.y, world.cols, world.rows)
      dangerGrid[cell.row][cell.col] = Math.min(8, dangerGrid[cell.row][cell.col] + 1.2)

      const selfSafe = sim.owner === aiTank.id && sim.age < SELF_HIT_GRACE + 0.06
      if (!selfSafe) {
        const d = Math.hypot(sim.x - aiTank.x, sim.y - aiTank.y)
        if (d < bestDist) {
          bestDist = d
          bestT = t
          bestX = sim.x
          bestY = sim.y
          bestVx = sim.vx
          bestVy = sim.vy
        }
      }

      sim = stepBullet(sim, simDt, world.walls)
    }

    if (bestDist <= dangerRadius) {
      threats.push({
        bulletId: source.id,
        tti: bestT,
        cpaDist: bestDist,
        impactX: bestX,
        impactY: bestY,
        vx: bestVx,
        vy: bestVy,
      })
    }
  }

  threats.sort((a, b) => a.tti - b.tti)
  return { threats, dangerGrid }
}

const pickEvadeDirection = (
  world: TankWorldState,
  aiTank: TankEntity,
  threats: readonly BulletThreat[]
): { moveX: number; moveY: number } => {
  const primary = threats[0]
  const bulletSpd = Math.hypot(primary.vx, primary.vy) || BULLET_SPEED
  const bx = primary.vx / bulletSpd
  const by = primary.vy / bulletSpd
  // 法线（垂直弹道）双方向 + 反方向作为首选基准
  const perp1Angle = Math.atan2(bx, -by)
  const perp2Angle = Math.atan2(-bx, by)

  let bestScore = -Infinity
  let bestDx = -bx
  let bestDy = -by

  const candidates = 16
  for (let i = 0; i < candidates; i += 1) {
    const angle = (Math.PI * 2 * i) / candidates
    const dx = Math.cos(angle)
    const dy = Math.sin(angle)
    const lookX = aiTank.x + dx * 28
    const lookY = aiTank.y + dy * 28
    const resolved = resolveCircleWalls(lookX, lookY, TANK_RADIUS, world.walls)
    const wallTravel = Math.hypot(resolved.x - aiTank.x, resolved.y - aiTank.y)
    if (wallTravel < 10) {
      continue
    }

    // 评估新位置相对所有迫近威胁落点的逃生距离
    let minClearance = Infinity
    for (const th of threats.slice(0, 3)) {
      const distToThreat = Math.hypot(resolved.x - th.impactX, resolved.y - th.impactY)
      if (distToThreat < minClearance) {
        minClearance = distToThreat
      }
    }

    // 偏好垂直于弹道横移，而非迎面或贴线跑
    const orthoBonus = Math.max(Math.cos(angle - perp1Angle), Math.cos(angle - perp2Angle)) * 8
    const score = minClearance + wallTravel * 0.55 + orthoBonus
    if (score > bestScore) {
      bestScore = score
      bestDx = dx
      bestDy = dy
    }
  }

  return { moveX: bestDx, moveY: bestDy }
}

const distancePointToSegment = (
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number => {
  const dx = x2 - x1
  const dy = y2 - y1
  const lenSq = dx * dx + dy * dy
  if (lenSq <= 0.0001) {
    return Math.hypot(px - x1, py - y1)
  }
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq))
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
}

const isSelfDangerShot = (
  ox: number,
  oy: number,
  angle: number,
  walls: readonly WallSegment[]
): boolean => {
  const shortRay = castBounceRay(ox, oy, angle, 240, 2, walls)
  // 若跳弹首段后第一/二跳回到自身附近，禁止开火防自伤
  for (let i = 1; i + 1 < shortRay.length; i += 1) {
    const d = distancePointToSegment(
      ox,
      oy,
      shortRay[i].x,
      shortRay[i].y,
      shortRay[i + 1].x,
      shortRay[i + 1].y
    )
    if (d <= TANK_RADIUS + 10) {
      return true
    }
  }
  return false
}

const rayHitsTarget = (
  ray: ReadonlyArray<{ x: number; y: number }>,
  tx: number,
  ty: number,
  hitRadius: number
): boolean => {
  for (let i = 0; i + 1 < ray.length; i += 1) {
    if (
      distancePointToSegment(tx, ty, ray[i].x, ray[i].y, ray[i + 1].x, ray[i + 1].y) <= hitRadius
    ) {
      return true
    }
  }
  return false
}

const hasPointToPointLos = (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  walls: readonly WallSegment[]
): boolean => {
  const dist = Math.hypot(x2 - x1, y2 - y1)
  const angle = Math.atan2(y2 - y1, x2 - x1)
  const ray = castBounceRay(x1, y1, angle, dist + 2, 0, walls)
  if (ray.length < 2) {
    return false
  }
  const end = ray[ray.length - 1]
  return Math.hypot(end.x - x1, end.y - y1) >= dist - 4
}

export const findBestShotAngle = (
  world: TankWorldState,
  aiTank: TankEntity,
  playerTank: TankEntity,
  difficulty: TankDifficulty
): { angle: number; ray: Array<{ x: number; y: number }> } | null => {
  if (!playerTank.alive) {
    return null
  }
  const dist = Math.hypot(playerTank.x - aiTank.x, playerTank.y - aiTank.y)
  const leadTime = Math.min(0.65, dist / BULLET_SPEED)
  const leadX = playerTank.x + playerTank.vx * leadTime * 0.65
  const leadY = playerTank.y + playerTank.vy * leadTime * 0.65
  const directAngle = Math.atan2(leadY - aiTank.y, leadX - aiTank.x)

  const directRay = castBounceRay(aiTank.x, aiTank.y, directAngle, dist + 28, 0, world.walls)
  if (
    rayHitsTarget(directRay, playerTank.x, playerTank.y, TANK_RADIUS + BULLET_RADIUS + 2) &&
    !isSelfDangerShot(aiTank.x, aiTank.y, directAngle, world.walls)
  ) {
    return { angle: directAngle, ray: directRay }
  }

  if (difficulty === 'normal') {
    return null
  }

  const maxBounces = difficulty === 'master' ? 2 : 1
  const sweepCount = difficulty === 'master' ? 36 : 24
  const maxRayLen = difficulty === 'master' ? 540 : 420
  const baseAngle = Math.atan2(playerTank.y - aiTank.y, playerTank.x - aiTank.x)

  for (let i = 0; i < sweepCount; i += 1) {
    const offset = ((i + 1) / sweepCount) * Math.PI * 2
    const candidateAngle = normalizeAngle(baseAngle + offset)
    const ray = castBounceRay(
      aiTank.x,
      aiTank.y,
      candidateAngle,
      maxRayLen,
      maxBounces,
      world.walls
    )
    if (
      ray.length >= 3 &&
      rayHitsTarget(ray, playerTank.x, playerTank.y, TANK_RADIUS + BULLET_RADIUS) &&
      !isSelfDangerShot(aiTank.x, aiTank.y, candidateAngle, world.walls)
    ) {
      return { angle: candidateAngle, ray }
    }
  }

  return null
}

export class TankAiController {
  private cachedPath: Array<{ col: number; row: number }> = []
  private lastPathAt = -1

  reset() {
    this.cachedPath = []
    this.lastPathAt = -1
  }

  decide(
    world: TankWorldState,
    difficulty: TankDifficulty
  ): { input: TankInput; debug: AiDebugInfo } {
    const ai = world.ai
    const player = world.player
    if (!ai.alive || !player.alive) {
      return {
        input: { moveX: 0, moveY: 0, fire: false },
        debug: { mode: 'pursue', path: [], threats: [], aimRay: null },
      }
    }

    const horizon = difficulty === 'normal' ? 0.9 : 1.35
    const { threats, dangerGrid } = analyzeBulletThreats(world, ai, horizon)
    const threatPoints = threats.map((t) => ({ x: t.impactX, y: t.impactY }))
    const shotPlan = findBestShotAngle(world, ai, player, difficulty)
    const activeOwnedBullets = world.bullets.filter((b) => b.owner === 'ai').length
    const canFire = ai.cooldown <= 0 && activeOwnedBullets < MAX_BULLETS_PER_TANK

    // 1) 躲避迫近弹道（最高优先级）
    if (threats.length > 0) {
      const evadeVec = pickEvadeDirection(world, ai, threats)
      const fireDuringEvade =
        Boolean(shotPlan) &&
        canFire &&
        Math.abs(normalizeAngle((shotPlan?.angle ?? 0) - ai.angle)) < 0.35
      return {
        input: {
          moveX: evadeVec.moveX,
          moveY: evadeVec.moveY,
          fire: fireDuringEvade,
          desiredAngle: shotPlan ? shotPlan.angle : Math.atan2(evadeVec.moveY, evadeVec.moveX),
        },
        debug: {
          mode: 'evade',
          path: this.cachedPath.map((c) => cellCenter(c.col, c.row, world.cellSize)),
          threats: threatPoints,
          aimRay: shotPlan?.ray ?? null,
        },
      }
    }

    // 2) 确定 A* 追击目标：附近有强力道具且距玩家更近/顺路时优先捡取
    const aiCell = posToCell(ai.x, ai.y, world.cols, world.rows)
    const playerCell = posToCell(player.x, player.y, world.cols, world.rows)
    let goalCell = playerCell
    let pickingUp = false

    for (const pu of world.powerUps) {
      const dPu = Math.abs(pu.col - aiCell.col) + Math.abs(pu.row - aiCell.row)
      const dPlayer = Math.abs(playerCell.col - aiCell.col) + Math.abs(playerCell.row - aiCell.row)
      if (dPu <= 3 && dPu <= dPlayer) {
        goalCell = { col: pu.col, row: pu.row }
        pickingUp = true
        break
      }
    }

    if (world.elapsed - this.lastPathAt >= 0.22 || this.cachedPath.length === 0) {
      this.cachedPath = findAStarPath(
        world.grid,
        aiCell.col,
        aiCell.row,
        goalCell.col,
        goalCell.row,
        dangerGrid
      )
      this.lastPathAt = world.elapsed
    }

    const pathPoints = this.cachedPath.map((c) => cellCenter(c.col, c.row, world.cellSize))

    // 3) 若命中直射或跳弹窗口，对准并开火，同时轻微侧移拉开弹线
    if (shotPlan) {
      const angleDiff = Math.abs(normalizeAngle(shotPlan.angle - ai.angle))
      const tolerance = difficulty === 'master' ? 0.14 : 0.22
      const shouldShoot = canFire && angleDiff <= tolerance
      const distToPlayer = Math.hypot(player.x - ai.x, player.y - ai.y)
      let moveX = 0
      let moveY = 0
      if (distToPlayer > 140 && pathPoints.length >= 2) {
        const nextPt = pathPoints[1]
        const dx = nextPt.x - ai.x
        const dy = nextPt.y - ai.y
        const len = Math.hypot(dx, dy) || 1
        moveX = (dx / len) * 0.72
        moveY = (dy / len) * 0.72
      } else {
        // 近战环绕微步走位
        const strafeAngle = shotPlan.angle + Math.PI / 2
        const sign = Math.sin(world.elapsed * 2.1) >= 0 ? 1 : -1
        moveX = Math.cos(strafeAngle) * 0.65 * sign
        moveY = Math.sin(strafeAngle) * 0.65 * sign
      }

      return {
        input: {
          moveX,
          moveY,
          fire: shouldShoot,
          desiredAngle: shotPlan.angle,
        },
        debug: {
          mode: 'attack',
          path: pathPoints,
          threats: threatPoints,
          aimRay: shotPlan.ray,
        },
      }
    }

    // 4) 沿 A* 路径高速追击（带直视路径点平滑，走直线捷径不走直角折线）
    let targetPt = pathPoints[1] ?? pathPoints[0] ?? { x: player.x, y: player.y }
    if (
      pathPoints.length >= 3 &&
      hasPointToPointLos(ai.x, ai.y, pathPoints[2].x, pathPoints[2].y, world.walls)
    ) {
      targetPt = pathPoints[2]
    }
    const dx = targetPt.x - ai.x
    const dy = targetPt.y - ai.y
    const dist = Math.hypot(dx, dy) || 1
    const moveX = dx / dist
    const moveY = dy / dist
    const moveAngle = Math.atan2(moveY, moveX)

    return {
      input: {
        moveX,
        moveY,
        fire: false,
        desiredAngle: moveAngle,
      },
      debug: {
        mode: pickingUp ? 'pickup' : 'pursue',
        path: pathPoints,
        threats: threatPoints,
        aimRay: null,
      },
    }
  }
}
