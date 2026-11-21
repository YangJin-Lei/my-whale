import clsx from 'clsx'
import { useEffect, useRef, useState } from 'react'
import { useIsMobile } from '../app/viewport.js'
import {
  IconCloseOutline16,
  IconMicFill16,
  IconMicOutline16,
  IconSendOutline16,
} from '../components/base/icons.js'
import { useVoiceInput } from '../components/chatInput/useVoiceInput.js'
import { useTranslate } from '../i18n/index.js'
import { clampPetSize, useSettings } from '../services/settings.js'
import { findPetById, usePetCatalog } from './catalog.js'
import { openPetChatroom } from './chatroom.js'
import styles from './PetOverlay.module.css'
import { PetSprite, type PetMood } from './PetSprite.js'
import {
  closePetPanel,
  sendPetQuery,
  setPetMood,
  stopPetSession,
  togglePetPanel,
  usePetStore,
} from './store.js'

const PET_POS_KEY = 'mywhale:pet-position-v1'
const PET_POSITIONS_KEY = 'mywhale:pet-positions-v1'

type Pos = { x: number; y: number }

const clampPos = (x: number, y: number, petWidth: number): Pos => {
  const w = typeof window === 'undefined' ? 390 : window.innerWidth
  const h = typeof window === 'undefined' ? 800 : window.innerHeight
  const petHeight = Math.round((petWidth * 208) / 192)
  return {
    x: Math.max(8, Math.min(w - petWidth - 8, x)),
    y: Math.max(12, Math.min(h - petHeight - 16, y)),
  }
}

const getDefaultSlotPos = (slotIndex: number, petWidth: number): Pos => {
  const w = typeof window === 'undefined' ? 390 : window.innerWidth
  const h = typeof window === 'undefined' ? 800 : window.innerHeight
  const petHeight = Math.round((petWidth * 208) / 192)
  const stepX = Math.min(petWidth, 92) + 12
  return clampPos(w - petWidth - 18 - slotIndex * stepX, h - petHeight - 108, petWidth)
}

const readStoredPositions = (): Record<string, Pos> => {
  if (typeof window === 'undefined') {
    return {}
  }
  const out: Record<string, Pos> = {}
  try {
    const rawMap = window.localStorage.getItem(PET_POSITIONS_KEY)
    if (rawMap) {
      const parsed = JSON.parse(rawMap) as Record<string, Partial<Pos>>
      if (typeof parsed === 'object' && parsed !== null) {
        for (const [id, val] of Object.entries(parsed)) {
          if (val && typeof val.x === 'number' && typeof val.y === 'number') {
            out[id] = { x: val.x, y: val.y }
          }
        }
      }
    }
    if (Object.keys(out).length === 0) {
      const legacy = window.localStorage.getItem(PET_POS_KEY)
      if (legacy) {
        const parsed = JSON.parse(legacy) as Partial<Pos>
        if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
          out.__legacy = { x: parsed.x, y: parsed.y }
        }
      }
    }
  } catch {
    // 忽略存储限制
  }
  return out
}

const writeStoredPositions = (map: Record<string, Pos>) => {
  if (typeof window === 'undefined') {
    return
  }
  try {
    window.localStorage.setItem(PET_POSITIONS_KEY, JSON.stringify(map))
  } catch {
    // 忽略存储限制
  }
}

/**
 * 全端多桌宠悬浮层：
 * - 支持 1~3 只桌宠同屏显示与独立拖拽；
 * - 支持滑块调节大小（小游戏图标大小 ~ 屏幕宽度一半）；
 * - 点击任意桌宠可单聊，也可一键进入「多桌宠聊天室」。
 */
export const PetOverlay = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const locale = useSettings((state) => state.locale)
  const petEnabled = useSettings((state) => state.petEnabled)
  const desktopPetIds = useSettings((state) => state.desktopPetIds)
  const rawPetSize = useSettings((state) => state.petSize)
  usePetCatalog()

  const panelOpen = usePetStore((state) => state.panelOpen)
  const activeChatPetId = usePetStore((state) => state.activeChatPetId)
  const mood = usePetStore((state) => state.mood)
  const petMoods = usePetStore((state) => state.petMoods)
  const replyText = usePetStore((state) => state.replyText)
  const streaming = usePetStore((state) => state.streaming)
  const errorText = usePetStore((state) => state.errorText)

  const [viewportW, setViewportW] = useState(() =>
    typeof window === 'undefined' ? 390 : window.innerWidth
  )
  const petWidth = clampPetSize(rawPetSize, viewportW)
  const [positions, setPositions] = useState<Record<string, Pos>>(() => readStoredPositions())
  const [inputText, setInputText] = useState('')
  const dragRef = useRef<{
    petId: string
    pointerId: number
    startX: number
    startY: number
    origX: number
    origY: number
    moved: boolean
  } | null>(null)

  const voice = useVoiceInput((text) => {
    void sendPetQuery(text)
  })

  useEffect(() => {
    if (!petEnabled) {
      stopPetSession()
      return
    }
    setPetMood('wave')
    const timer = window.setTimeout(() => {
      usePetStore.setState((prev) =>
        prev.streaming ? prev : { mood: prev.panelOpen ? 'wait' : 'idle' }
      )
    }, 2200)
    return () => window.clearTimeout(timer)
  }, [desktopPetIds, petEnabled])

  useEffect(() => {
    const onResize = () => {
      const nextW = window.innerWidth
      setViewportW(nextW)
      const nextPetW = clampPetSize(useSettings.getState().petSize, nextW)
      setPositions((prev) => {
        const clamped: Record<string, Pos> = {}
        for (const [id, p] of Object.entries(prev)) {
          clamped[id] = clampPos(p.x, p.y, nextPetW)
        }
        return clamped
      })
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  if (!petEnabled) {
    return null
  }

  const resolvedChatPetId =
    activeChatPetId && desktopPetIds.includes(activeChatPetId)
      ? activeChatPetId
      : (desktopPetIds[0] ?? 'nailong')

  const isRecording = voice.status === 'recording'
  const isTranscribing = voice.status === 'transcribing'

  const submitInput = () => {
    const value = inputText.trim()
    if (!value || streaming) {
      return
    }
    setInputText('')
    void sendPetQuery(value)
  }

  const bubbleContent = errorText
    ? errorText
    : replyText
      ? replyText
      : streaming
        ? t('petThinking')
        : isRecording || isTranscribing
          ? t('petListening')
          : null

  return (
    <>
      {desktopPetIds.slice(0, 3).map((petId, slotIdx) => {
        const pet = findPetById(petId)
        const petTitle = pet.name[locale]
        const rawPos =
          positions[petId] ??
          (slotIdx === 0 ? positions.__legacy : undefined) ??
          getDefaultSlotPos(slotIdx, petWidth)
        const pos = clampPos(rawPos.x, rawPos.y, petWidth)
        const showPanel = panelOpen && resolvedChatPetId === petId
        const effectiveMood: PetMood =
          petMoods[petId] ?? (showPanel ? mood : slotIdx === 0 ? mood : 'idle')

        const panelWidth = isMobile ? Math.max(240, viewportW - 32) : 340
        const panelOffsetX = isMobile
          ? 16 - pos.x
          : Math.max(
              16 - pos.x,
              Math.min(viewportW - panelWidth - 16 - pos.x, petWidth - panelWidth)
            )
        const openBelow = pos.y < 220

        return (
          <div
            key={petId}
            className={styles.root}
            style={{
              left: `${pos.x}px`,
              top: `${pos.y}px`,
            }}
          >
            {showPanel ? (
              <div
                className={clsx(styles.panel, openBelow && styles.panelBelow)}
                style={{
                  width: `${panelWidth}px`,
                  left: `${panelOffsetX}px`,
                }}
                role="dialog"
                aria-label={petTitle}
              >
                <div className={styles.panelHeader}>
                  <span className={styles.panelTitle}>{petTitle}</span>
                  <button
                    type="button"
                    className={styles.headerBtn}
                    onClick={() => {
                      closePetPanel()
                      openPetChatroom()
                    }}
                  >
                    {t('petRoomTitle')}
                  </button>
                  <button
                    type="button"
                    className={styles.headerBtn}
                    aria-label={t('close')}
                    onClick={closePetPanel}
                  >
                    <IconCloseOutline16 />
                  </button>
                </div>

                {bubbleContent ? (
                  <div className={styles.replyBox}>
                    <div className={styles.replyContent}>{bubbleContent}</div>
                  </div>
                ) : null}

                <div className={styles.inputRow}>
                  <input
                    type="text"
                    className={styles.input}
                    placeholder={t('petInputPlaceholder')}
                    value={inputText}
                    onChange={(event) => setInputText(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                        event.preventDefault()
                        submitInput()
                      }
                    }}
                  />
                  {voice.available ? (
                    <button
                      type="button"
                      className={clsx(styles.iconAction, isRecording && styles.micActive)}
                      aria-label={t('voiceInput')}
                      disabled={isTranscribing}
                      onClick={voice.toggle}
                    >
                      {isRecording ? <IconMicFill16 /> : <IconMicOutline16 />}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className={clsx(styles.iconAction, styles.sendBtn)}
                    aria-label={t('send')}
                    disabled={!inputText.trim() || streaming}
                    onClick={submitInput}
                  >
                    <IconSendOutline16 />
                  </button>
                </div>
              </div>
            ) : null}

            <button
              type="button"
              className={styles.petBtn}
              aria-label={petTitle}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId)
                dragRef.current = {
                  petId,
                  pointerId: event.pointerId,
                  startX: event.clientX,
                  startY: event.clientY,
                  origX: pos.x,
                  origY: pos.y,
                  moved: false,
                }
              }}
              onPointerMove={(event) => {
                const drag = dragRef.current
                if (!drag || drag.petId !== petId || drag.pointerId !== event.pointerId) {
                  return
                }
                const dx = event.clientX - drag.startX
                const dy = event.clientY - drag.startY
                if (!drag.moved && Math.hypot(dx, dy) > 6) {
                  drag.moved = true
                }
                if (drag.moved) {
                  if (!streaming) {
                    setPetMood(dx < 0 ? 'runLeft' : 'runRight', petId)
                  }
                  const nextPos = clampPos(drag.origX + dx, drag.origY + dy, petWidth)
                  setPositions((prev) => ({ ...prev, [petId]: nextPos }))
                }
              }}
              onPointerUp={(event) => {
                const drag = dragRef.current
                if (!drag || drag.petId !== petId || drag.pointerId !== event.pointerId) {
                  return
                }
                dragRef.current = null
                if (drag.moved) {
                  setPetMood(showPanel ? 'wait' : 'idle', petId)
                  setPositions((prev) => {
                    writeStoredPositions(prev)
                    return prev
                  })
                } else {
                  togglePetPanel(petId)
                }
              }}
              onPointerCancel={() => {
                dragRef.current = null
                setPetMood(showPanel ? 'wait' : 'idle', petId)
              }}
            >
              <PetSprite
                spriteUrl={pet.spriteUrl}
                mood={effectiveMood}
                width={petWidth}
                cols={pet.cols}
                rows={pet.rows}
              />
            </button>
          </div>
        )
      })}
    </>
  )
}
