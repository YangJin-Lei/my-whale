import clsx from 'clsx'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { usePetCatalog } from '../../pet/catalog.js'
import { PetSprite, type PetMood } from '../../pet/PetSprite.js'
import { useSettings } from '../../services/settings.js'
import type { BoardComponentProps } from '../types.js'
import styles from './Doudizhu.module.css'
import {
  canBeatCombo,
  describeComboName,
  detectCombo,
  findBeatCandidates,
  rankToLabel,
} from './engine.js'
import {
  type AiSeatId,
  resolveDoudizhuSeatOpponent,
  setDoudizhuSeatPet,
  useDoudizhuSeatStore,
} from './seats.js'
import type { Card, DoudizhuMove, DoudizhuSeatId, DoudizhuState } from './types.js'

const renderMiniCardFace = (card: Card, size: 'xs' | 'sm' | 'lg' = 'lg') => {
  const isRed = card.suit === 'H' || card.suit === 'D' || card.rank === 17
  const suitSymbol =
    card.suit === 'S'
      ? '♠'
      : card.suit === 'H'
        ? '♥'
        : card.suit === 'C'
          ? '♣'
          : card.suit === 'D'
            ? '♦'
            : ''
  const isJoker = card.rank === 16 || card.rank === 17

  return (
    <span
      className={clsx(
        styles.cardContent,
        size === 'xs' && styles.cardContentXs,
        size === 'sm' && styles.cardContentSm,
        isRed ? styles.cardRed : styles.cardBlack
      )}
    >
      <span className={styles.cardRank}>
        {isJoker ? (card.rank === 17 ? '大' : '小') : rankToLabel(card.rank)}
      </span>
      <span className={styles.cardSuit}>{isJoker ? '王' : suitSymbol}</span>
    </span>
  )
}

export const DoudizhuBoard = ({
  state,
  disabled,
  turnSecondsLeft,
  aiThinking,
  onPlayerMove,
}: BoardComponentProps<DoudizhuState, DoudizhuMove>) => {
  const t = useTranslate()
  const locale = useSettings((state) => state.locale)
  const pets = usePetCatalog()
  const seatConfig = useDoudizhuSeatStore()

  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [hintIndex, setHintIndex] = useState(0)
  const [noBeatNotice, setNoBeatNotice] = useState(false)
  const [pickerSeat, setPickerSeat] = useState<AiSeatId | null>(null)
  const swipeSelectRef = useRef<{
    active: boolean
    mode: 'select' | 'deselect'
    visited: Set<string>
  }>({
    active: false,
    mode: 'select',
    visited: new Set(),
  })

  const playerHand = state.hands.player
  const isPlayerTurn = !disabled && state.phase !== 'finished' && state.currentTurn === 'player'
  const isLeading = state.tablePlay === null || state.tablePlay.seat === 'player'

  // 手牌变化后清理已打出的选中状态
  useEffect(() => {
    const owned = new Set(playerHand.map((c) => c.id))
    setSelectedIds((prev) => prev.filter((id) => owned.has(id)))
    setHintIndex(0)
    setNoBeatNotice(false)
  }, [playerHand, state.currentTurn])

  const selectedCards = useMemo(() => {
    const pickedSet = new Set(selectedIds)
    return playerHand.filter((c) => pickedSet.has(c.id))
  }, [playerHand, selectedIds])

  const selectedCombo = useMemo(() => detectCombo(selectedCards), [selectedCards])
  const canSubmitPlay = useMemo(() => {
    if (!isPlayerTurn || state.phase !== 'playing' || !selectedCombo) {
      return false
    }
    const target = isLeading ? null : (state.tablePlay?.combo ?? null)
    return canBeatCombo(selectedCombo, target)
  }, [isLeading, isPlayerTurn, selectedCombo, state.phase, state.tablePlay])

  const setCardSelection = (id: string, select: boolean) => {
    setNoBeatNotice(false)
    setSelectedIds((prev) => {
      const has = prev.includes(id)
      if (select && !has) {
        return [...prev, id]
      }
      if (!select && has) {
        return prev.filter((item) => item !== id)
      }
      return prev
    })
  }

  const triggerHint = () => {
    if (!isPlayerTurn || state.phase !== 'playing') {
      return
    }
    const target = isLeading ? null : (state.tablePlay?.combo ?? null)
    const candidates = findBeatCandidates(playerHand, target)
    if (candidates.length === 0) {
      setNoBeatNotice(true)
      setSelectedIds([])
      return
    }
    setNoBeatNotice(false)
    const picked = candidates[hintIndex % candidates.length]
    setSelectedIds(picked.map((c) => c.id))
    setHintIndex((prev) => prev + 1)
  }

  const getSeatRole = (seat: DoudizhuSeatId): string | null => {
    if (!state.landlordSeat) {
      return null
    }
    if (state.landlordSeat === seat) {
      return locale === 'zh-CN' ? '地主' : 'Landlord'
    }
    return locale === 'zh-CN' ? '农民' : 'Peasant'
  }

  const getSeatMood = (seat: AiSeatId): PetMood => {
    if (state.phase === 'finished' && state.winnerTeam) {
      const seatIsLandlord = state.landlordSeat === seat
      const won =
        (state.winnerTeam === 'landlord' && seatIsLandlord) ||
        (state.winnerTeam === 'peasants' && !seatIsLandlord)
      return won ? 'laugh' : 'sad'
    }
    if (state.currentTurn === seat && aiThinking) {
      return 'think'
    }
    if (state.currentTurn === seat) {
      return 'speak'
    }
    return 'wait'
  }

  const renderAiSeat = (seat: AiSeatId) => {
    const opp = resolveDoudizhuSeatOpponent(seat, locale)
    const count = state.hands[seat].length
    const display = state.seatDisplays[seat]
    const role = getSeatRole(seat)
    const activeTurn = state.phase !== 'finished' && state.currentTurn === seat
    const isLow = state.phase === 'playing' && count > 0 && count <= 2

    return (
      <div className={clsx(styles.aiSeatCard, activeTurn && styles.aiSeatActive)}>
        <div className={styles.aiSeatTop}>
          <button
            type="button"
            className={styles.petPickTrigger}
            title={t('doudizhuSwapPet')}
            onClick={() => setPickerSeat((prev) => (prev === seat ? null : seat))}
          >
            {opp.petSpriteUrl ? (
              <PetSprite
                spriteUrl={opp.petSpriteUrl}
                mood={getSeatMood(seat)}
                width={38}
                cols={opp.petCols}
                rows={opp.petRows}
              />
            ) : null}
          </button>

          <div className={styles.aiSeatMeta}>
            <div className={styles.aiSeatNameRow}>
              <span className={styles.aiSeatName}>{opp.name}</span>
              {role ? (
                <span
                  className={clsx(
                    styles.roleBadge,
                    state.landlordSeat === seat ? styles.roleLandlord : styles.rolePeasant
                  )}
                >
                  {role}
                </span>
              ) : null}
            </div>
            <div className={styles.aiSeatCountRow}>
              <span className={clsx(styles.countPill, isLow && styles.countAlert)}>
                {locale === 'zh-CN' ? `余 ${count} 张` : `${count} left`}
              </span>
              {activeTurn && typeof turnSecondsLeft === 'number' ? (
                <span
                  className={clsx(
                    styles.timerBadge,
                    turnSecondsLeft <= 10 && styles.timerBadgeUrgent
                  )}
                >
                  {turnSecondsLeft}s
                </span>
              ) : null}
            </div>
          </div>
        </div>

        {pickerSeat === seat ? (
          <select
            aria-label={t('doudizhuSwapPet')}
            className={styles.seatPetSelect}
            value={seatConfig[seat]}
            onChange={(event) => {
              setDoudizhuSeatPet(seat, event.target.value)
              setPickerSeat(null)
            }}
          >
            {pets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name[locale]}
              </option>
            ))}
          </select>
        ) : null}

        {display.speech ? <div className={styles.seatSpeech}>{display.speech}</div> : null}

        <div className={styles.seatPlayedZone}>
          {display.cards.length > 0 ? (
            <div className={styles.playedCardsRow}>
              {display.cards.map((card) => (
                <div key={card.id} className={styles.miniCard}>
                  {renderMiniCardFace(card, 'sm')}
                </div>
              ))}
            </div>
          ) : display.pass ? (
            <span className={styles.passPill}>
              {state.phase === 'bidding' ? t('doudizhuNoBid') : t('doudizhuPass')}
            </span>
          ) : display.bidLabel ? (
            <span className={styles.bidPill}>{display.bidLabel}</span>
          ) : null}
        </div>
      </div>
    )
  }

  const playerDisplay = state.seatDisplays.player
  const playerRole = getSeatRole('player')
  const showPlayerTimer =
    state.phase !== 'finished' &&
    state.currentTurn === 'player' &&
    typeof turnSecondsLeft === 'number'

  return (
    <div className={styles.stage}>
      <div className={styles.tableFelt}>
        {/* 顶部公共信息条：3张底牌 + 算牌次数配额 */}
        <div className={styles.topInfoBar}>
          <div className={styles.bottomCardsGroup}>
            <span className={styles.topLabel}>{t('doudizhuBottomCards')}</span>
            <div className={styles.bottomCardsRow}>
              {state.bottomCards.map((card) =>
                state.landlordSeat ? (
                  <div key={card.id} className={styles.xsCard}>
                    {renderMiniCardFace(card, 'xs')}
                  </div>
                ) : (
                  <div key={card.id} className={styles.xsCardBack} />
                )
              )}
            </div>
          </div>
          <div className={styles.budgetBadge}>
            {t('doudizhuCountBudget', { left: state.cardCountBudgetLeft })}
          </div>
        </div>

        {/* 两位对坐桌宠玩家 */}
        <div className={styles.aiSeatsRow}>
          {renderAiSeat('ai_left')}
          {renderAiSeat('ai_right')}
        </div>

        {/* 玩家最近桌面出牌状态 */}
        <div className={styles.playerTableArea}>
          {playerDisplay.cards.length > 0 ? (
            <div className={styles.playedCardsRow}>
              {playerDisplay.cards.map((card) => (
                <div key={card.id} className={styles.miniCard}>
                  {renderMiniCardFace(card, 'sm')}
                </div>
              ))}
            </div>
          ) : playerDisplay.pass ? (
            <span className={styles.passPill}>
              {state.phase === 'bidding' ? t('doudizhuNoBid') : t('doudizhuPass')}
            </span>
          ) : playerDisplay.bidLabel ? (
            <span className={styles.bidPill}>{playerDisplay.bidLabel}</span>
          ) : null}
        </div>

        {/* 玩家手牌栏与操作按钮 */}
        <div className={styles.playerSection}>
          <div className={styles.playerStatusRow}>
            <span className={styles.playerTitle}>
              {locale === 'zh-CN' ? '你的手牌' : 'Your Hand'} ({playerHand.length})
            </span>
            {playerRole ? (
              <span
                className={clsx(
                  styles.roleBadge,
                  state.landlordSeat === 'player' ? styles.roleLandlord : styles.rolePeasant
                )}
              >
                {playerRole}
              </span>
            ) : null}
            {showPlayerTimer ? (
              <span
                className={clsx(
                  styles.timerBadge,
                  (turnSecondsLeft ?? 60) <= 10 && styles.timerBadgeUrgent
                )}
              >
                {turnSecondsLeft}s
              </span>
            ) : null}
            {selectedCombo ? (
              <span className={styles.comboPreviewBadge}>
                {describeComboName(selectedCombo.kind, locale)}
              </span>
            ) : noBeatNotice ? (
              <span className={styles.noBeatBadge}>{t('doudizhuNoBeatHint')}</span>
            ) : null}
          </div>

          {state.phase !== 'finished' ? (
            <div className={styles.actionRow}>
              {state.phase === 'bidding' ? (
                <>
                  <button
                    type="button"
                    className={styles.actionBtn}
                    disabled={!isPlayerTurn}
                    onClick={() => onPlayerMove({ type: 'bid', score: 0 })}
                  >
                    {t('doudizhuNoBid')}
                  </button>
                  {([1, 2, 3] as const).map((score) => (
                    <button
                      key={score}
                      type="button"
                      className={clsx(styles.actionBtn, styles.actionPrimary)}
                      disabled={!isPlayerTurn || score <= state.highestBid}
                      onClick={() => onPlayerMove({ type: 'bid', score })}
                    >
                      {locale === 'zh-CN' ? `${score} 分` : `${score}`}
                    </button>
                  ))}
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className={styles.actionBtn}
                    disabled={!isPlayerTurn}
                    onClick={triggerHint}
                  >
                    {t('doudizhuHint')}
                  </button>
                  {selectedIds.length > 0 ? (
                    <button
                      type="button"
                      className={styles.actionBtn}
                      disabled={!isPlayerTurn}
                      onClick={() => {
                        setSelectedIds([])
                        setNoBeatNotice(false)
                      }}
                    >
                      {t('doudizhuClear')}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className={styles.actionBtn}
                    disabled={!isPlayerTurn || isLeading}
                    onClick={() => onPlayerMove({ type: 'pass' })}
                  >
                    {t('doudizhuPass')}
                  </button>
                  <button
                    type="button"
                    className={clsx(styles.actionBtn, styles.actionPrimary)}
                    disabled={!canSubmitPlay}
                    onClick={() => onPlayerMove({ type: 'play', cardIds: selectedIds })}
                  >
                    {t('doudizhuPlay')}
                  </button>
                </>
              )}
            </div>
          ) : null}

          <div
            className={styles.handRow}
            onPointerMove={(event) => {
              if (!swipeSelectRef.current.active || !isPlayerTurn || state.phase !== 'playing') {
                return
              }
              const hit = document.elementFromPoint(event.clientX, event.clientY)
              const cardBtn =
                hit instanceof Element ? hit.closest<HTMLElement>('[data-card-id]') : null
              const cardId = cardBtn?.dataset.cardId
              if (cardId && !swipeSelectRef.current.visited.has(cardId)) {
                swipeSelectRef.current.visited.add(cardId)
                setCardSelection(cardId, swipeSelectRef.current.mode === 'select')
              }
            }}
            onPointerUp={() => {
              swipeSelectRef.current.active = false
            }}
            onPointerCancel={() => {
              swipeSelectRef.current.active = false
            }}
          >
            {playerHand.map((card, index) => {
              const selected = selectedIds.includes(card.id)
              return (
                <button
                  key={card.id}
                  data-card-id={card.id}
                  type="button"
                  disabled={!isPlayerTurn || state.phase !== 'playing'}
                  className={clsx(
                    styles.handCard,
                    selected && styles.handCardSelected,
                    index > 0 && styles.handCardOverlap
                  )}
                  onPointerDown={() => {
                    if (!isPlayerTurn || state.phase !== 'playing') {
                      return
                    }
                    const nextMode = selected ? 'deselect' : 'select'
                    swipeSelectRef.current = {
                      active: true,
                      mode: nextMode,
                      visited: new Set([card.id]),
                    }
                    setCardSelection(card.id, nextMode === 'select')
                  }}
                >
                  {renderMiniCardFace(card, 'lg')}
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
