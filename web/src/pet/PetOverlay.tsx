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
import { useSettings } from '../services/settings.js'
import { findPetById, usePetCatalog } from './catalog.js'
import { PetSprite } from './PetSprite.js'
import styles from './PetOverlay.module.css'
import {
  closePetPanel,
  sendPetQuery,
  setPetMood,
  stopPetSession,
  togglePetPanel,
  usePetStore,
} from './store.js'

const PET_POS_KEY = 'mywhale:pet-position-v1'

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

const getInitialPos = (petWidth: number): Pos => {
  const w = typeof window === 'undefined' ? 390 : window.innerWidth
  const h = typeof window === 'undefined' ? 800 : window.innerHeight
  const petHeight = Math.round((petWidth * 208) / 192)
  try {
    const raw = window.localStorage.getItem(PET_POS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Pos>
      if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
        return clampPos(parsed.x, parsed.y, petWidth)
      }
    }
  } catch {
    // 忽略存储限制
  }
  return clampPos(w - petWidth - 18, h - petHeight - 108, petWidth)
}

/**
 * 全端悬浮桌宠：
 * - 支持多角色切换（奶蛙 / Chiikawa 系列等）
 * - 开启应用默认弹出，可在「设置 → 桌宠」关闭
 * - 手机端弹窗与底部输入框左右边界对齐（左右各 16px），防止越界裁切
 */
export const PetOverlay = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const locale = useSettings((state) => state.locale)
  const petEnabled = useSettings((state) => state.petEnabled)
  const activePetId = useSettings((state) => state.activePetId)
  usePetCatalog()
  const pet = findPetById(activePetId)
  const petTitle = pet.name[locale]

  const panelOpen = usePetStore((state) => state.panelOpen)
  const mood = usePetStore((state) => state.mood)
  const replyText = usePetStore((state) => state.replyText)
  const streaming = usePetStore((state) => state.streaming)
  const errorText = usePetStore((state) => state.errorText)

  const petWidth = isMobile ? 68 : 76
  const [pos, setPos] = useState<Pos>(() => getInitialPos(petWidth))
  const [viewportW, setViewportW] = useState(() =>
    typeof window === 'undefined' ? 390 : window.innerWidth
  )
  const [inputText, setInputText] = useState('')
  const dragRef = useRef<{
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

  // 打开应用或切换桌宠角色时招手打招呼后进入待机
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
  }, [activePetId, petEnabled])

  useEffect(() => {
    const onResize = () => {
      setViewportW(window.innerWidth)
      setPos((prev) => clampPos(prev.x, prev.y, petWidth))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [petWidth])

  if (!petEnabled) {
    return null
  }

  // 与移动端 ChatInput 保持一致的左右 16px 边界对齐；桌面端智能避让屏幕左右边
  const panelWidth = isMobile ? Math.max(240, viewportW - 32) : 340
  const panelOffsetX = isMobile
    ? 16 - pos.x
    : Math.max(16 - pos.x, Math.min(viewportW - panelWidth - 16 - pos.x, petWidth - panelWidth))
  const openBelow = pos.y < 220

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
    <div
      className={styles.root}
      style={{
        left: `${pos.x}px`,
        top: `${pos.y}px`,
      }}
    >
      {panelOpen ? (
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
          if (!drag || drag.pointerId !== event.pointerId) {
            return
          }
          const dx = event.clientX - drag.startX
          const dy = event.clientY - drag.startY
          if (!drag.moved && Math.hypot(dx, dy) > 6) {
            drag.moved = true
          }
          if (drag.moved) {
            if (!streaming) {
              setPetMood(dx < 0 ? 'runLeft' : 'runRight')
            }
            setPos(clampPos(drag.origX + dx, drag.origY + dy, petWidth))
          }
        }}
        onPointerUp={(event) => {
          const drag = dragRef.current
          if (!drag || drag.pointerId !== event.pointerId) {
            return
          }
          dragRef.current = null
          if (drag.moved) {
            setPetMood(panelOpen ? 'wait' : 'idle')
            try {
              window.localStorage.setItem(PET_POS_KEY, JSON.stringify(pos))
            } catch {
              // 忽略存储限制
            }
          } else {
            togglePetPanel()
          }
        }}
        onPointerCancel={() => {
          dragRef.current = null
          setPetMood(panelOpen ? 'wait' : 'idle')
        }}
      >
        <PetSprite
          spriteUrl={pet.spriteUrl}
          mood={mood}
          width={petWidth}
          cols={pet.cols}
          rows={pet.rows}
        />
      </button>
    </div>
  )
}
