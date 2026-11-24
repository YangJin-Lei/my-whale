import clsx from 'clsx'
import { useEffect, useRef, useState } from 'react'
import { useIsMobile } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import { useSettings } from '../../services/settings.js'
import { resolveCurrentOpponent } from '../opponents.js'
import { updateGameFeedback } from '../store.js'
import type { BoardComponentProps } from '../types.js'
import { TankAiController } from './ai.js'
import {
  BULLET_RADIUS,
  createInitialTankWorld,
  MAX_BULLETS_PER_TANK,
  stepTankWorld,
  TANK_RADIUS,
  WORLD_H,
  WORLD_W,
} from './engine.js'
import styles from './Tank.module.css'
import type {
  AiDebugInfo,
  TankControlMode,
  TankDifficulty,
  TankEntity,
  TankInput,
  TankMatchState,
  TankWorldState,
} from './types.js'

const ROUND_TRANSITION_SEC = 1.45

const drawTankSprite = (
  ctx: CanvasRenderingContext2D,
  tank: TankEntity,
  bodyColor: string,
  turretColor: string,
  label: string
) => {
  if (!tank.alive) {
    return
  }
  ctx.save()
  ctx.translate(tank.x, tank.y)

  if (tank.shield) {
    ctx.beginPath()
    ctx.arc(0, 0, TANK_RADIUS + 5, 0, Math.PI * 2)
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.85)'
    ctx.lineWidth = 2.5
    ctx.stroke()
  }

  ctx.save()
  ctx.rotate(tank.angle)
  // 履带阴影 + 车体
  ctx.fillStyle = '#1e293b'
  ctx.fillRect(-13, -12, 26, 24)
  ctx.fillStyle = bodyColor
  ctx.fillRect(-11, -10, 22, 20)
  // 炮管
  ctx.fillStyle = turretColor
  ctx.fillRect(0, -3.2, TANK_RADIUS + 7, 6.4)
  // 炮口火光
  if (tank.muzzleFlash > 0) {
    ctx.beginPath()
    ctx.arc(TANK_RADIUS + 9, 0, 5.5, 0, Math.PI * 2)
    ctx.fillStyle = '#fde047'
    ctx.fill()
  }
  // 炮塔盖
  ctx.beginPath()
  ctx.arc(0, 0, 6.8, 0, Math.PI * 2)
  ctx.fillStyle = turretColor
  ctx.fill()
  ctx.restore()

  ctx.fillStyle = 'rgba(248, 250, 252, 0.88)'
  ctx.font = '600 9.5px sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText(label, 0, -TANK_RADIUS - 5)
  ctx.restore()
}

const drawArena = (
  ctx: CanvasRenderingContext2D,
  world: TankWorldState,
  debugInfo: AiDebugInfo | null,
  showDebug: boolean,
  aiLabel: string,
  playerLabel: string
) => {
  ctx.clearRect(0, 0, WORLD_W, WORLD_H)

  // 地板微网格
  ctx.fillStyle = '#0f172a'
  ctx.fillRect(0, 0, WORLD_W, WORLD_H)
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.08)'
  ctx.lineWidth = 1
  for (let c = 1; c < world.cols; c += 1) {
    const x = c * world.cellSize
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, WORLD_H)
    ctx.stroke()
  }
  for (let r = 1; r < world.rows; r += 1) {
    const y = r * world.cellSize
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(WORLD_W, y)
    ctx.stroke()
  }

  // AI 调试可视化：A* 路线 + 威胁点 + 预判跳弹线
  if (showDebug && debugInfo) {
    if (debugInfo.path.length >= 2) {
      ctx.save()
      ctx.setLineDash([5, 5])
      ctx.strokeStyle = 'rgba(52, 211, 153, 0.72)'
      ctx.lineWidth = 2.2
      ctx.beginPath()
      ctx.moveTo(debugInfo.path[0].x, debugInfo.path[0].y)
      for (let i = 1; i < debugInfo.path.length; i += 1) {
        ctx.lineTo(debugInfo.path[i].x, debugInfo.path[i].y)
      }
      ctx.stroke()
      ctx.restore()
    }

    if (debugInfo.aimRay && debugInfo.aimRay.length >= 2) {
      ctx.save()
      ctx.setLineDash([4, 4])
      ctx.strokeStyle = 'rgba(250, 204, 21, 0.8)'
      ctx.lineWidth = 1.8
      ctx.beginPath()
      ctx.moveTo(debugInfo.aimRay[0].x, debugInfo.aimRay[0].y)
      for (let i = 1; i < debugInfo.aimRay.length; i += 1) {
        ctx.lineTo(debugInfo.aimRay[i].x, debugInfo.aimRay[i].y)
      }
      ctx.stroke()
      ctx.restore()
    }

    for (const th of debugInfo.threats) {
      ctx.beginPath()
      ctx.arc(th.x, th.y, 11, 0, Math.PI * 2)
      ctx.strokeStyle = 'rgba(248, 113, 113, 0.9)'
      ctx.lineWidth = 2
      ctx.stroke()
    }
  }

  // 随机迷宫墙体
  ctx.strokeStyle = '#94a3b8'
  ctx.lineWidth = 5
  ctx.lineCap = 'round'
  for (const w of world.walls) {
    ctx.beginPath()
    ctx.moveTo(w.x1, w.y1)
    ctx.lineTo(w.x2, w.y2)
    ctx.stroke()
  }

  // 道具
  for (const pu of world.powerUps) {
    ctx.save()
    ctx.translate(pu.x, pu.y)
    ctx.beginPath()
    ctx.arc(0, 0, 11, 0, Math.PI * 2)
    ctx.fillStyle = pu.kind === 'shield' ? '#0284c7' : pu.kind === 'triple' ? '#d97706' : '#16a34a'
    ctx.fill()
    ctx.strokeStyle = '#f8fafc'
    ctx.lineWidth = 1.6
    ctx.stroke()
    ctx.fillStyle = '#ffffff'
    ctx.font = 'bold 10px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(pu.kind === 'shield' ? 'S' : pu.kind === 'triple' ? '3X' : '⚡', 0, 0.5)
    ctx.restore()
  }

  // 子弹轨迹与弹头
  for (const b of world.bullets) {
    if (b.trail.length >= 2) {
      ctx.beginPath()
      ctx.moveTo(b.trail[0].x, b.trail[0].y)
      for (let i = 1; i < b.trail.length; i += 1) {
        ctx.lineTo(b.trail[i].x, b.trail[i].y)
      }
      ctx.strokeStyle = b.owner === 'player' ? 'rgba(96, 165, 250, 0.5)' : 'rgba(251, 146, 60, 0.5)'
      ctx.lineWidth = 2.4
      ctx.stroke()
    }
    ctx.beginPath()
    ctx.arc(b.x, b.y, BULLET_RADIUS, 0, Math.PI * 2)
    ctx.fillStyle = b.owner === 'player' ? '#93c5fd' : '#fdba74'
    ctx.fill()
  }

  // 粒子
  for (const pt of world.particles) {
    const alpha = Math.max(0, pt.life / pt.maxLife)
    ctx.globalAlpha = alpha
    ctx.beginPath()
    ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2)
    ctx.fillStyle = pt.color
    ctx.fill()
  }
  ctx.globalAlpha = 1

  drawTankSprite(ctx, world.player, '#2563eb', '#60a5fa', playerLabel)
  drawTankSprite(ctx, world.ai, '#ea580c', '#fb923c', aiLabel)
}

export const TankBoard = ({
  state,
  onPlayerMove,
}: BoardComponentProps<TankMatchState, TankMatchState>) => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const locale = useSettings((s) => s.locale)
  const opponent = resolveCurrentOpponent(locale)

  const [showAiDebug, setShowAiDebug] = useState(false)
  const [roundBanner, setRoundBanner] = useState<string | null>(null)
  const [joyKnob, setJoyKnob] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [ammoLeft, setAmmoLeft] = useState(MAX_BULLETS_PER_TANK)
  const [touchCapable, setTouchCapable] = useState(false)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const worldRef = useRef<TankWorldState>(createInitialTankWorld())
  const aiControllerRef = useRef(new TankAiController())
  const stateRef = useRef(state)
  stateRef.current = state
  const showDebugRef = useRef(showAiDebug)
  showDebugRef.current = showAiDebug
  const onMoveRef = useRef(onPlayerMove)
  onMoveRef.current = onPlayerMove

  const keysRef = useRef<Set<string>>(new Set())
  const joyVecRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const joyPointerIdRef = useRef<number | null>(null)
  const joyOriginRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const touchFireRef = useRef(false)
  const roundPauseRef = useRef<{ winner: 'player' | 'ai' | 'draw'; leftSec: number } | null>(null)
  const prevSessionTokenRef = useRef(state.sessionToken)

  useEffect(() => {
    const hasTouch =
      typeof window !== 'undefined' &&
      ('ontouchstart' in window || (navigator.maxTouchPoints ?? 0) > 0)
    setTouchCapable(hasTouch)
  }, [])

  // 点重开/再来一局时重置新迷宫
  useEffect(() => {
    if (state.sessionToken !== prevSessionTokenRef.current) {
      prevSessionTokenRef.current = state.sessionToken
      worldRef.current = createInitialTankWorld()
      aiControllerRef.current.reset()
      roundPauseRef.current = null
      setRoundBanner(null)
    }
  }, [state.sessionToken])

  // 键盘事件（WASD / 方向键移动，空格/J/K 开火）
  useEffect(() => {
    const isTypingTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) {
        return false
      }
      const tag = target.tagName
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
    }

    const handledKeys = new Set([
      'KeyW',
      'KeyA',
      'KeyS',
      'KeyD',
      'ArrowUp',
      'ArrowDown',
      'ArrowLeft',
      'ArrowRight',
      'Space',
      'KeyJ',
      'KeyK',
    ])

    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || !handledKeys.has(e.code)) {
        return
      }
      e.preventDefault()
      keysRef.current.add(e.code)
    }
    const onKeyUp = (e: KeyboardEvent) => {
      keysRef.current.delete(e.code)
    }
    const onBlur = () => {
      keysRef.current.clear()
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  // 60fps 实时模拟与渲染循环
  useEffect(() => {
    let rafId = 0
    let lastTime = performance.now()
    let lastHudSync = 0
    let lastDebugInfo: AiDebugInfo | null = null

    const readPlayerInput = (): TankInput => {
      const keys = keysRef.current
      let moveX = joyVecRef.current.x
      let moveY = joyVecRef.current.y
      if (keys.has('KeyA') || keys.has('ArrowLeft')) {
        moveX -= 1
      }
      if (keys.has('KeyD') || keys.has('ArrowRight')) {
        moveX += 1
      }
      if (keys.has('KeyW') || keys.has('ArrowUp')) {
        moveY -= 1
      }
      if (keys.has('KeyS') || keys.has('ArrowDown')) {
        moveY += 1
      }
      const len = Math.hypot(moveX, moveY)
      if (len > 1) {
        moveX /= len
        moveY /= len
      }
      const fire = touchFireRef.current || keys.has('Space') || keys.has('KeyJ') || keys.has('KeyK')
      return { moveX, moveY, fire }
    }

    const loop = (now: number) => {
      const dt = Math.min(0.04, Math.max(0.004, (now - lastTime) / 1000))
      lastTime = now

      const match = stateRef.current
      const world = worldRef.current

      if (match.status === 'playing') {
        if (roundPauseRef.current) {
          // 回合结束后保留 1.45s 爆炸粒子余韵再开新随机地图
          stepTankWorld(
            world,
            { moveX: 0, moveY: 0, fire: false },
            { moveX: 0, moveY: 0, fire: false },
            match.controlMode,
            dt
          )
          roundPauseRef.current.leftSec -= dt
          if (roundPauseRef.current.leftSec <= 0) {
            const w = roundPauseRef.current.winner
            roundPauseRef.current = null
            setRoundBanner(null)
            const nextPlayer = match.playerScore + (w === 'player' ? 1 : 0)
            const nextAi = match.aiScore + (w === 'ai' ? 1 : 0)
            const finishedStatus =
              nextPlayer >= match.targetWins
                ? 'player_win'
                : nextAi >= match.targetWins
                  ? 'ai_win'
                  : 'playing'

            const note =
              w === 'player'
                ? locale === 'zh-CN'
                  ? `第 ${match.round} 局你击毁了对手！`
                  : `Round ${match.round}: You scored!`
                : w === 'ai'
                  ? locale === 'zh-CN'
                    ? `第 ${match.round} 局对手跳弹命中！`
                    : `Round ${match.round}: AI scored!`
                  : locale === 'zh-CN'
                    ? `第 ${match.round} 局同归于尽！`
                    : `Round ${match.round}: Double KO!`

            if (finishedStatus === 'playing') {
              worldRef.current = createInitialTankWorld()
              aiControllerRef.current.reset()
            }
            onMoveRef.current({
              ...match,
              round: finishedStatus === 'playing' ? match.round + 1 : match.round,
              playerScore: nextPlayer,
              aiScore: nextAi,
              status: finishedStatus,
              lastRoundNote: note,
            })
            updateGameFeedback({
              bubbleText: note,
              speechToSpeak: w === 'player' ? '漂亮！这一炮防不住。' : '哈哈，算准反弹角度了吧！',
            })
          }
        } else {
          const playerInput = readPlayerInput()
          const aiDecision = aiControllerRef.current.decide(world, match.difficulty)
          lastDebugInfo = aiDecision.debug
          const outcome = stepTankWorld(world, playerInput, aiDecision.input, match.controlMode, dt)
          if (outcome) {
            roundPauseRef.current = { winner: outcome, leftSec: ROUND_TRANSITION_SEC }
            setRoundBanner(
              outcome === 'player'
                ? locale === 'zh-CN'
                  ? '击毁敌方坦克！准备下一随机地图…'
                  : 'Target Destroyed!'
                : outcome === 'ai'
                  ? locale === 'zh-CN'
                    ? '被敌方炮弹击中！'
                    : 'Tank Destroyed!'
                  : locale === 'zh-CN'
                    ? '同归于尽！'
                    : 'Double Knockout!'
            )
          }
        }
      }

      if (now - lastHudSync > 110) {
        lastHudSync = now
        const activeOwned = world.bullets.filter((b) => b.owner === 'player').length
        setAmmoLeft(Math.max(0, MAX_BULLETS_PER_TANK - activeOwned))
      }

      const canvas = canvasRef.current
      const ctx = canvas?.getContext('2d')
      if (canvas && ctx) {
        const dpr = Math.min(2, window.devicePixelRatio || 1)
        const targetW = WORLD_W * dpr
        const targetH = WORLD_H * dpr
        if (canvas.width !== targetW || canvas.height !== targetH) {
          canvas.width = targetW
          canvas.height = targetH
        }
        ctx.save()
        ctx.scale(dpr, dpr)
        drawArena(
          ctx,
          worldRef.current,
          lastDebugInfo,
          showDebugRef.current,
          opponent.name,
          locale === 'zh-CN' ? '你' : 'You'
        )
        ctx.restore()
      }

      rafId = window.requestAnimationFrame(loop)
    }

    rafId = window.requestAnimationFrame(loop)
    return () => window.cancelAnimationFrame(rafId)
  }, [locale, opponent.name])

  const regenerateMap = () => {
    worldRef.current = createInitialTankWorld()
    aiControllerRef.current.reset()
    roundPauseRef.current = null
    setRoundBanner(null)
  }

  const updateJoystickFromPointer = (clientX: number, clientY: number) => {
    const maxRadius = 36
    const dx = clientX - joyOriginRef.current.x
    const dy = clientY - joyOriginRef.current.y
    const dist = Math.hypot(dx, dy)
    const clamped = Math.min(maxRadius, dist)
    const angle = Math.atan2(dy, dx)
    const kx = dist > 0.001 ? Math.cos(angle) * clamped : 0
    const ky = dist > 0.001 ? Math.sin(angle) * clamped : 0
    setJoyKnob({ x: kx, y: ky })
    joyVecRef.current = {
      x: kx / maxRadius,
      y: ky / maxRadius,
    }
  }

  const difficulties: Array<{ id: TankDifficulty; label: string }> = [
    { id: 'normal', label: locale === 'zh-CN' ? '普通' : 'Normal' },
    { id: 'hard', label: locale === 'zh-CN' ? '困难' : 'Hard' },
    { id: 'master', label: locale === 'zh-CN' ? '大师' : 'Master' },
  ]

  const showTouchControls = isMobile || touchCapable

  return (
    <div className={styles.stage}>
      <div className={styles.hudBar}>
        <div className={styles.scoreGroup}>
          <span className={styles.scorePillPlayer}>
            {locale === 'zh-CN' ? '你' : 'You'} {state.playerScore}
          </span>
          <span className={styles.roundTag}>
            {locale === 'zh-CN'
              ? `第 ${state.round} 局 · 先胜 ${state.targetWins}`
              : `R${state.round} · FT${state.targetWins}`}
          </span>
          <span className={styles.scorePillAi}>
            {opponent.name} {state.aiScore}
          </span>
        </div>

        <div className={styles.controlsBar}>
          {difficulties.map((d) => (
            <button
              key={d.id}
              type="button"
              className={clsx(styles.chipBtn, state.difficulty === d.id && styles.chipBtnActive)}
              onClick={() => onPlayerMove({ ...state, difficulty: d.id })}
            >
              {d.label}
            </button>
          ))}
          <button
            type="button"
            className={clsx(
              styles.chipBtn,
              state.controlMode === 'classic' && styles.chipBtnActive
            )}
            onClick={() => {
              const nextMode: TankControlMode =
                state.controlMode === 'directional' ? 'classic' : 'directional'
              onPlayerMove({ ...state, controlMode: nextMode })
            }}
          >
            {state.controlMode === 'directional'
              ? t('tankControlDirectional')
              : t('tankControlClassic')}
          </button>
          <button
            type="button"
            className={clsx(styles.chipBtn, showAiDebug && styles.chipBtnActive)}
            onClick={() => setShowAiDebug((prev) => !prev)}
          >
            {t('tankShowAiDebug')}
          </button>
          <button type="button" className={styles.chipBtn} onClick={regenerateMap}>
            {t('tankNewMap')}
          </button>
        </div>
      </div>

      <div className={styles.arenaWrap}>
        <canvas ref={canvasRef} className={styles.canvas} />
        {roundBanner ? (
          <div className={styles.roundOverlay}>
            <div className={styles.roundOverlayTitle}>{roundBanner}</div>
          </div>
        ) : state.status !== 'playing' ? (
          <div className={styles.roundOverlay}>
            <div className={styles.roundOverlayTitle}>
              {state.status === 'player_win'
                ? locale === 'zh-CN'
                  ? '全胜夺冠！你赢下了整场坦克对决！'
                  : 'Victory! Match Won!'
                : locale === 'zh-CN'
                  ? 'AI 率先拿下赛点，点击「再来一局」再战！'
                  : 'AI won the match!'}
            </div>
            <div className={styles.roundOverlaySub}>{state.lastRoundNote}</div>
          </div>
        ) : null}
      </div>

      {!showTouchControls ? (
        <div className={styles.keyHint}>
          {locale === 'zh-CN'
            ? '操作：W A S D / 方向键移动，空格 / J 开火（子弹可贴墙多次反弹）'
            : 'Controls: W A S D / Arrows to move, Space / J to fire ricochet shells'}
        </div>
      ) : null}

      {showTouchControls ? (
        <div className={styles.touchControls}>
          <div
            className={styles.joystickZone}
            role="application"
            aria-label="Tank virtual joystick"
            onPointerDown={(e) => {
              e.preventDefault()
              const rect = e.currentTarget.getBoundingClientRect()
              joyPointerIdRef.current = e.pointerId
              joyOriginRef.current = {
                x: rect.left + rect.width / 2,
                y: rect.top + rect.height / 2,
              }
              try {
                e.currentTarget.setPointerCapture(e.pointerId)
              } catch {
                // 忽略不支持捕获的设备
              }
              updateJoystickFromPointer(e.clientX, e.clientY)
            }}
            onPointerMove={(e) => {
              if (joyPointerIdRef.current !== e.pointerId) {
                return
              }
              updateJoystickFromPointer(e.clientX, e.clientY)
            }}
            onPointerUp={(e) => {
              if (joyPointerIdRef.current !== e.pointerId) {
                return
              }
              joyPointerIdRef.current = null
              joyVecRef.current = { x: 0, y: 0 }
              setJoyKnob({ x: 0, y: 0 })
            }}
            onPointerCancel={() => {
              joyPointerIdRef.current = null
              joyVecRef.current = { x: 0, y: 0 }
              setJoyKnob({ x: 0, y: 0 })
            }}
          >
            <span className={styles.joystickCrossH} />
            <span className={styles.joystickCrossV} />
            <span
              className={styles.joystickKnob}
              style={{ transform: `translate(${joyKnob.x}px, ${joyKnob.y}px)` }}
            />
          </div>

          <div className={styles.fireZone}>
            <button
              type="button"
              className={styles.fireBtn}
              onPointerDown={(e) => {
                e.preventDefault()
                touchFireRef.current = true
              }}
              onPointerUp={() => {
                touchFireRef.current = false
              }}
              onPointerLeave={() => {
                touchFireRef.current = false
              }}
              onPointerCancel={() => {
                touchFireRef.current = false
              }}
            >
              {t('tankFire')}
            </button>
            <div className={styles.ammoPips}>
              {Array.from({ length: MAX_BULLETS_PER_TANK }, (_, idx) => (
                <span
                  key={idx}
                  className={clsx(styles.ammoPip, idx >= ammoLeft && styles.ammoPipEmpty)}
                />
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
