import clsx from 'clsx'
import { useEffect, useMemo, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { usePetCatalog } from '../../pet/catalog.js'
import { PetSprite, type PetMood } from '../../pet/PetSprite.js'
import { useSettings } from '../../services/settings.js'
import type { BoardComponentProps } from '../types.js'
import {
  getDiscardPhaseOptions,
  getDiscardTingMap,
  getTingWaits,
  MAHJONG_SEAT_ORDER,
  tileCodeToLabel,
} from './engine.js'
import styles from './Mahjong.module.css'
import {
  type MahjongAiSeatId,
  resolveMahjongSeatOpponent,
  setMahjongSeatPet,
  useMahjongSeatStore,
} from './seats.js'
import {
  getMahjongSeatLabel,
  type MahjongMove,
  type MahjongSeatId,
  type MahjongState,
  type MahjongTile,
} from './types.js'

const renderTileContent = (code: number) => {
  if (code >= 0 && code <= 8) {
    return (
      <span className={styles.suitWan}>
        <span className={styles.tileMainChar}>{code + 1}</span>
        <span className={styles.tileSubChar}>万</span>
      </span>
    )
  }
  if (code >= 9 && code <= 17) {
    return (
      <span className={styles.suitTiao}>
        <span className={styles.tileMainChar}>{code - 8}</span>
        <span className={styles.tileSubChar}>条</span>
      </span>
    )
  }
  if (code >= 18 && code <= 26) {
    return (
      <span className={styles.suitTong}>
        <span className={styles.tileMainChar}>{code - 17}</span>
        <span className={styles.tileSubChar}>筒</span>
      </span>
    )
  }
  const honors = ['东', '南', '西', '北', '中', '发', '白']
  const ch = honors[code - 27] ?? '?'
  const cls =
    code === 31
      ? styles.suitRed
      : code === 32
        ? styles.suitGreen
        : code === 33
          ? styles.suitBai
          : styles.suitHonor
  return (
    <span className={cls}>
      <span className={styles.tileMainChar}>{ch}</span>
    </span>
  )
}

const renderMiniTile = (tile: MahjongTile, highlight = false) => (
  <span key={tile.id} className={clsx(styles.miniTile, highlight && styles.miniTileLatest)}>
    {renderTileContent(tile.code)}
  </span>
)

export const MahjongBoard = ({
  state,
  disabled,
  turnSecondsLeft,
  aiThinking,
  onPlayerMove,
}: BoardComponentProps<MahjongState, MahjongMove>) => {
  const t = useTranslate()
  const locale = useSettings((s) => s.locale)
  const pets = usePetCatalog()
  const seatConfig = useMahjongSeatStore()

  const [selectedTileId, setSelectedTileId] = useState<string | null>(null)
  const [pickerSeat, setPickerSeat] = useState<MahjongAiSeatId | null>(null)

  const playerHand = state.hands.player
  const playerMelds = state.melds.player
  const isPlayerDiscardTurn =
    !disabled && state.phase === 'playing_discard' && state.currentTurn === 'player'
  const activeClaim =
    state.phase === 'claim_window' && state.pendingClaims[0]?.seat === 'player'
      ? state.pendingClaims[0]
      : null
  const isPlayerClaimTurn = !disabled && activeClaim !== null

  useEffect(() => {
    setSelectedTileId((prev) => (prev && playerHand.some((x) => x.id === prev) ? prev : null))
  }, [playerHand])

  const discardOptions = useMemo(
    () => (isPlayerDiscardTurn ? getDiscardPhaseOptions(state, 'player') : null),
    [isPlayerDiscardTurn, state]
  )

  const currentTingWaits = useMemo(() => {
    const expected = (4 - playerMelds.length) * 3 + 1
    if (playerHand.length === expected) {
      return getTingWaits(playerHand, playerMelds.length)
    }
    return []
  }, [playerHand, playerMelds.length])

  const discardTingMap = useMemo(() => {
    if (!isPlayerDiscardTurn) {
      return new Map<number, number[]>()
    }
    return getDiscardTingMap(playerHand, playerMelds.length)
  }, [isPlayerDiscardTurn, playerHand, playerMelds.length])

  const selectedTile = playerHand.find((x) => x.id === selectedTileId) ?? null
  const selectedTileWaits = selectedTile ? (discardTingMap.get(selectedTile.code) ?? []) : []

  const handleTileTap = (tile: MahjongTile) => {
    if (!isPlayerDiscardTurn) {
      return
    }
    if (selectedTileId === tile.id) {
      setSelectedTileId(null)
      onPlayerMove({ type: 'discard', tileId: tile.id })
      return
    }
    setSelectedTileId(tile.id)
  }

  const getAiMood = (seat: MahjongAiSeatId): PetMood => {
    if (state.phase === 'finished' && state.winResult) {
      return state.winResult.winnerSeat === seat ? 'laugh' : 'sad'
    }
    const actor = state.phase === 'claim_window' ? state.pendingClaims[0]?.seat : state.currentTurn
    if (actor === seat && aiThinking) {
      return 'think'
    }
    if (actor === seat) {
      return 'speak'
    }
    return 'wait'
  }

  const renderAiSeatCard = (seat: MahjongAiSeatId) => {
    const opp = resolveMahjongSeatOpponent(seat, locale)
    const handCount = state.hands[seat].length
    const melds = state.melds[seat]
    const speech = state.seatSpeeches[seat]
    const actor = state.phase === 'claim_window' ? state.pendingClaims[0]?.seat : state.currentTurn
    const isTurn = state.phase !== 'finished' && actor === seat

    return (
      <div key={seat} className={clsx(styles.aiSeatCard, isTurn && styles.aiSeatActive)}>
        <div className={styles.aiSeatHead}>
          <button
            type="button"
            className={styles.petPickBtn}
            title={t('mahjongSwapPet')}
            onClick={() => setPickerSeat((prev) => (prev === seat ? null : seat))}
          >
            {opp.petSpriteUrl ? (
              <PetSprite
                spriteUrl={opp.petSpriteUrl}
                mood={getAiMood(seat)}
                width={32}
                cols={opp.petCols}
                rows={opp.petRows}
              />
            ) : null}
          </button>

          <div className={styles.aiSeatMeta}>
            <div className={styles.aiSeatName}>{opp.name}</div>
            <div className={styles.aiSeatSub}>
              <span>
                {opp.tagline} · {handCount}
                {locale === 'zh-CN' ? '张' : ''}
              </span>
              {isTurn && typeof turnSecondsLeft === 'number' ? (
                <span
                  className={clsx(styles.timerPill, turnSecondsLeft <= 10 && styles.timerUrgent)}
                >
                  {turnSecondsLeft}s
                </span>
              ) : null}
            </div>
          </div>
        </div>

        {pickerSeat === seat ? (
          <select
            aria-label={t('mahjongSwapPet')}
            className={styles.petSelect}
            value={seatConfig[seat]}
            onChange={(e) => {
              setMahjongSeatPet(seat, e.target.value)
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

        {speech ? <div className={styles.speechLine}>{speech}</div> : null}

        {melds.length > 0 ? (
          <div className={styles.meldsRow}>
            {melds.map((meld, idx) => (
              <div key={idx} className={styles.meldGroup}>
                {meld.tiles.map((tile, tIdx) =>
                  meld.kind === 'angang' && (tIdx === 0 || tIdx === 3) ? (
                    <span key={tile.id} className={styles.tileHiddenBack} />
                  ) : (
                    renderMiniTile(tile)
                  )
                )}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div className={styles.stage}>
      <div className={styles.tableFelt}>
        <div className={styles.topBar}>
          <span className={styles.wallBadge}>
            {t('mahjongWallLeft', { left: state.wall.length })}
          </span>
          {currentTingWaits.length > 0 ? (
            <span className={styles.tingBadge}>
              {t('mahjongTing')}:
              {currentTingWaits
                .slice(0, 5)
                .map((code) => tileCodeToLabel(code, locale))
                .join('、')}
            </span>
          ) : null}
        </div>

        <div className={styles.aiRow}>
          {renderAiSeatCard('ai_left')}
          {renderAiSeatCard('ai_across')}
          {renderAiSeatCard('ai_right')}
        </div>

        {/* 桌面牌河 */}
        <div className={styles.riverPanel}>
          {MAHJONG_SEAT_ORDER.map((seat: MahjongSeatId) => {
            const river = state.discards[seat]
            const latestDiscardId =
              state.lastDiscard?.seat === seat ? state.lastDiscard.tile.id : null
            return (
              <div key={seat} className={styles.riverSeat}>
                <span className={styles.riverSeatLabel}>{getMahjongSeatLabel(seat, locale)}</span>
                <div className={styles.riverTiles}>
                  {river.map((tile) => renderMiniTile(tile, tile.id === latestDiscardId))}
                </div>
              </div>
            )
          })}
        </div>

        {state.phase === 'finished' ? (
          <div className={styles.winBanner}>
            <div className={styles.winTitle}>
              {state.winResult
                ? `${getMahjongSeatLabel(state.winResult.winnerSeat, locale)} · ${
                    state.winResult.winType === 'zimo'
                      ? locale === 'zh-CN'
                        ? '自摸胡牌'
                        : 'Self-Draw Win'
                      : locale === 'zh-CN'
                        ? '点炮胡牌'
                        : 'Win on Discard'
                  }（${state.winResult.totalFan}${locale === 'zh-CN' ? '番' : ' Fan'}）`
                : locale === 'zh-CN'
                  ? '荒庄和局：牌山已全部摸完'
                  : 'Wall Exhausted — Draw'}
            </div>
            {state.winResult ? (
              <>
                <div className={styles.winFans}>{state.winResult.fanNames.join(' · ')}</div>
                <div className={styles.riverTiles}>
                  {state.hands[state.winResult.winnerSeat].map((tile) => renderMiniTile(tile))}
                  {state.winResult.winType === 'dianpao'
                    ? renderMiniTile(state.winResult.winTile, true)
                    : null}
                </div>
              </>
            ) : null}
          </div>
        ) : null}

        {/* 玩家区：副露、吃碰杠胡按钮与手牌 */}
        <div className={styles.playerArea}>
          <div className={styles.playerBar}>
            <span className={styles.playerTitle}>
              {getMahjongSeatLabel('player', locale)} ({playerHand.length}
              {locale === 'zh-CN' ? '张' : ''})
            </span>
            {selectedTileWaits.length > 0 ? (
              <span className={styles.tingPreview}>
                {locale === 'zh-CN' ? '打此牌听：' : 'Waits: '}
                {selectedTileWaits
                  .slice(0, 6)
                  .map((c) => tileCodeToLabel(c, locale))
                  .join('、')}
              </span>
            ) : null}
            {isPlayerDiscardTurn && typeof turnSecondsLeft === 'number' ? (
              <span className={clsx(styles.timerPill, turnSecondsLeft <= 10 && styles.timerUrgent)}>
                {turnSecondsLeft}s
              </span>
            ) : null}
          </div>

          {playerMelds.length > 0 ? (
            <div className={styles.meldsRow}>
              {playerMelds.map((meld, idx) => (
                <div key={idx} className={styles.meldGroup}>
                  {meld.tiles.map((tile) => renderMiniTile(tile))}
                </div>
              ))}
            </div>
          ) : null}

          {state.phase !== 'finished' ? (
            <div className={styles.actionBar}>
              {isPlayerClaimTurn && activeClaim ? (
                <>
                  {activeClaim.options.some((o) => o.type === 'hu') ? (
                    <button
                      type="button"
                      className={clsx(styles.actionBtn, styles.actionHu)}
                      onClick={() => onPlayerMove({ type: 'hu' })}
                    >
                      {t('mahjongHu')}
                    </button>
                  ) : null}
                  {activeClaim.options.some((o) => o.type === 'gang') ? (
                    <button
                      type="button"
                      className={clsx(styles.actionBtn, styles.actionPrimary)}
                      onClick={() => onPlayerMove({ type: 'gang' })}
                    >
                      {t('mahjongGang')}
                    </button>
                  ) : null}
                  {activeClaim.options.some((o) => o.type === 'pong') ? (
                    <button
                      type="button"
                      className={clsx(styles.actionBtn, styles.actionPrimary)}
                      onClick={() => onPlayerMove({ type: 'pong' })}
                    >
                      {t('mahjongPong')}
                    </button>
                  ) : null}
                  {activeClaim.options
                    .filter(
                      (o): o is { type: 'chi'; useCodes: [number, number] } => o.type === 'chi'
                    )
                    .map((opt) => (
                      <button
                        key={opt.useCodes.join('-')}
                        type="button"
                        className={styles.actionBtn}
                        onClick={() => onPlayerMove({ type: 'chi', useCodes: opt.useCodes })}
                      >
                        {t('mahjongChi')} {tileCodeToLabel(opt.useCodes[0], locale)}
                        {tileCodeToLabel(opt.useCodes[1], locale)}
                      </button>
                    ))}
                  <button
                    type="button"
                    className={styles.actionBtn}
                    onClick={() => onPlayerMove({ type: 'pass' })}
                  >
                    {t('mahjongPass')}
                  </button>
                </>
              ) : isPlayerDiscardTurn ? (
                <>
                  {discardOptions?.canHu ? (
                    <button
                      type="button"
                      className={clsx(styles.actionBtn, styles.actionHu)}
                      onClick={() => onPlayerMove({ type: 'hu' })}
                    >
                      {t('mahjongHu')}
                    </button>
                  ) : null}
                  {discardOptions?.angangCodes.map((code) => (
                    <button
                      key={`ag-${code}`}
                      type="button"
                      className={styles.actionBtn}
                      onClick={() => onPlayerMove({ type: 'angang', code })}
                    >
                      {t('mahjongGang')} {tileCodeToLabel(code, locale)}
                    </button>
                  ))}
                  {discardOptions?.bugangCodes.map((code) => (
                    <button
                      key={`bg-${code}`}
                      type="button"
                      className={styles.actionBtn}
                      onClick={() => onPlayerMove({ type: 'bugang', code })}
                    >
                      {t('mahjongGang')} {tileCodeToLabel(code, locale)}
                    </button>
                  ))}
                  <button
                    type="button"
                    className={clsx(styles.actionBtn, styles.actionPrimary)}
                    disabled={!selectedTile}
                    onClick={() => {
                      if (selectedTile) {
                        setSelectedTileId(null)
                        onPlayerMove({ type: 'discard', tileId: selectedTile.id })
                      }
                    }}
                  >
                    {t('mahjongDiscard')}
                  </button>
                </>
              ) : null}
            </div>
          ) : null}

          <div className={styles.handRow}>
            {playerHand.map((tile) => {
              const selected = tile.id === selectedTileId
              const isJustDrawn = tile.id === state.lastDrawnId && isPlayerDiscardTurn
              return (
                <button
                  key={tile.id}
                  type="button"
                  disabled={!isPlayerDiscardTurn}
                  aria-label={tileCodeToLabel(tile.code, locale)}
                  className={clsx(
                    styles.handTile,
                    isJustDrawn && styles.handTileDrawn,
                    selected && styles.handTileSelected
                  )}
                  onClick={() => handleTileTap(tile)}
                >
                  {renderTileContent(tile.code)}
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
