import clsx from 'clsx'
import { useEffect, useState } from 'react'
import { useIsMobile } from '../app/viewport.js'
import logoUrl from '../assets/logo.png'
import { Button } from '../components/base/Button.js'
import { IconButton } from '../components/base/IconButton.js'
import {
  IconCloseOutline16,
  IconGamepadOutline16,
  IconPlayMediaOutline16,
  IconThinkOutline14,
} from '../components/base/icons.js'
import { useTranslate } from '../i18n/index.js'
import { usePetCatalog } from '../pet/catalog.js'
import { PetSprite, type PetMood } from '../pet/PetSprite.js'
import { useSettings } from '../services/settings.js'
import styles from './GameDrawer.module.css'
import {
  ACTIVE_PERSONA_OPPONENT_ID,
  CUSTOM_OPPONENT_ID,
  DEFAULT_OPPONENT_ID,
  PET_OPPONENT_ID,
  resolveCurrentOpponent,
  saveCustomGameOpponent,
  setGameOpponentChoice,
  useGameOpponentStore,
} from './opponents.js'
import { findRegisteredGame, GAME_REGISTRY } from './registry.js'
import {
  backToGamePicker,
  closeGameDrawer,
  replayOpponentSpeech,
  restartCurrentGame,
  retryAiTurn,
  startGame,
  submitPlayerGameMove,
  toggleGameExpanded,
  toggleGameThinkingMode,
  toggleGameVoice,
  undoGameRound,
  useGameStore,
} from './store.js'
import { useGameVoice } from './voiceCue.js'

/**
 * 右侧可收合 AI 对弈抽屉：
 * 1) 支持电脑端一键「放大弹窗」以独立大窗口对弈；
 * 2) 未选择具体游戏时展示对手与游戏列表；进入后展示 2.5D 棋/牌桌与折叠思考/语音。
 */
export const GameDrawer = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const locale = useSettings((state) => state.locale)
  useSettings((state) => state.activePetId)
  usePetCatalog()
  const drawerOpen = useGameStore((state) => state.drawerOpen)
  const expanded = useGameStore((state) => state.expanded)
  const activeGameId = useGameStore((state) => state.activeGameId)
  const gameState = useGameStore((state) => state.gameState)
  const aiThinking = useGameStore((state) => state.aiThinking)
  const thinkingMode = useGameStore((state) => state.thinkingMode)
  const gameVoiceOn = useGameStore((state) => state.gameVoiceOn)
  const bubbleText = useGameStore((state) => state.bubbleText)
  const thoughtText = useGameStore((state) => state.thoughtText)
  const errorText = useGameStore((state) => state.errorText)
  const turnSecondsLeft = useGameStore((state) => state.turnSecondsLeft)
  const voiceStatus = useGameVoice((state) => state.status)

  const [thoughtExpanded, setThoughtExpanded] = useState(false)

  useEffect(() => {
    if (!thoughtText) {
      setThoughtExpanded(false)
    }
  }, [thoughtText])

  const selectedChoice = useGameOpponentStore((state) => state.selectedChoice)
  const customDraft = useGameOpponentStore((state) => state.custom)
  const [editingCustom, setEditingCustom] = useState(false)
  const [draftName, setDraftName] = useState(customDraft.name)
  const [draftTagline, setDraftTagline] = useState(customDraft.tagline)
  const [draftPrompt, setDraftPrompt] = useState(customDraft.systemPrompt)
  const [draftGreeting, setDraftGreeting] = useState(customDraft.greeting)

  if (!drawerOpen) {
    return null
  }

  const plugin = findRegisteredGame(activeGameId)
  const opponent = resolveCurrentOpponent(locale)
  const status = plugin && gameState ? plugin.getStatus(gameState) : 'playing'
  const turn = plugin && gameState ? plugin.getTurn(gameState) : 'player'
  const statusNote = plugin && gameState ? plugin.getStatusNote?.(gameState, locale) : null
  const canUndo = plugin && gameState ? plugin.canUndo(gameState) && !aiThinking : false

  const opponentStatusLabel = aiThinking
    ? t('gameStatusThinking')
    : status === 'player_win'
      ? t('gameStatusPlayerWin')
      : status === 'ai_win'
        ? t('gameStatusAiWin')
        : status === 'draw'
          ? t('gameStatusDraw')
          : turn === 'player'
            ? t('gameStatusYourTurn')
            : t('gameStatusAiTurn')

  const resolvePetMood = (): PetMood => {
    if (!plugin) {
      return 'wave'
    }
    if (aiThinking) {
      return 'think'
    }
    if (voiceStatus === 'playing') {
      return 'speak'
    }
    if (status === 'ai_win') {
      return 'laugh'
    }
    if (status === 'player_win') {
      return 'sad'
    }
    return 'wait'
  }

  const renderOpponentAvatar = () => {
    if (opponent.petSpriteUrl) {
      return (
        <PetSprite
          spriteUrl={opponent.petSpriteUrl}
          mood={resolvePetMood()}
          width={38}
          cols={opponent.petCols}
          rows={opponent.petRows}
        />
      )
    }
    const isDataImage = Boolean(opponent.avatar && opponent.avatar.startsWith('data:image/'))
    if (isDataImage) {
      return <img src={opponent.avatar} alt={opponent.name} className={styles.avatarCustomImg} />
    }
    return <img src={logoUrl} alt={opponent.name} className={styles.avatarImg} />
  }

  const showRetryButton = Boolean(errorText && plugin && gameState && turn === 'ai' && !aiThinking)
  const isExpandedModal = expanded && !isMobile

  const drawerNode = (
    <aside
      className={clsx(styles.drawer, isExpandedModal && styles.drawerExpanded)}
      aria-label={t('gameDrawerTitle')}
    >
      <div className={styles.header}>
        {plugin ? (
          <button type="button" className={styles.backBtn} onClick={backToGamePicker}>
            ← {t('gameSwitch')}
          </button>
        ) : (
          <IconGamepadOutline16 />
        )}
        <div className={styles.headerTitle}>
          {plugin ? plugin.name[locale] : t('gameDrawerTitle')}
        </div>
        {!isMobile ? (
          <button
            type="button"
            className={styles.backBtn}
            onClick={toggleGameExpanded}
            aria-pressed={isExpandedModal}
          >
            {isExpandedModal ? t('gameCollapse') : t('gameExpand')}
          </button>
        ) : null}
        <IconButton
          icon={<IconCloseOutline16 />}
          aria-label={t('close')}
          onClick={closeGameDrawer}
        />
      </div>

      {plugin && gameState ? (
        <>
          <div className={styles.toolbar}>
            <button
              type="button"
              className={clsx(styles.pillBtn, thinkingMode && styles.pillBtnActive)}
              onClick={toggleGameThinkingMode}
            >
              <IconThinkOutline14 />
              <span>{t('thinkingSwitch')}</span>
            </button>
            <button
              type="button"
              className={clsx(styles.pillBtn, gameVoiceOn && styles.pillBtnActive)}
              onClick={toggleGameVoice}
            >
              <IconPlayMediaOutline16 />
              <span>{gameVoiceOn ? t('gameVoiceOn') : t('gameVoiceOff')}</span>
            </button>
            <button
              type="button"
              className={styles.pillBtn}
              disabled={!canUndo}
              onClick={undoGameRound}
            >
              {t('gameUndo')}
            </button>
            <button type="button" className={styles.pillBtn} onClick={restartCurrentGame}>
              {t('gameRestart')}
            </button>
            <button
              type="button"
              className={clsx(
                styles.pillBtn,
                thoughtExpanded && thoughtText && styles.pillBtnActive
              )}
              disabled={!thoughtText}
              onClick={() => setThoughtExpanded((prev) => !prev)}
            >
              <span>
                {thoughtExpanded && thoughtText ? t('gameHideThought') : t('gameViewThought')}
              </span>
            </button>
          </div>

          <div className={styles.bodyWrap}>
            {thoughtExpanded && thoughtText ? (
              <div
                className={styles.thoughtPopover}
                role="region"
                aria-label={t('gameViewThought')}
              >
                <div className={styles.thoughtPopoverHeader}>
                  <span>{t('gameViewThought')}</span>
                  <button
                    type="button"
                    className={styles.thoughtCloseBtn}
                    onClick={() => setThoughtExpanded(false)}
                  >
                    {t('gameHideThought')}
                  </button>
                </div>
                <div className={styles.thoughtPanel}>{thoughtText}</div>
              </div>
            ) : null}

            <div className={styles.body}>
              {!plugin.hideGenericOpponentHeader ? (
                <div className={styles.opponentStage}>
                  <div
                    className={clsx(
                      styles.avatarBox,
                      (aiThinking || voiceStatus === 'playing') && styles.avatarThinking
                    )}
                  >
                    {renderOpponentAvatar()}
                  </div>
                  <div className={styles.opponentMeta}>
                    <div className={styles.opponentTop}>
                      <span className={styles.opponentName}>{opponent.name}</span>
                      <span className={styles.opponentBadge}>{opponentStatusLabel}</span>
                    </div>
                    <div className={styles.bubbleRow}>
                      <div className={styles.speechBubble}>{bubbleText || opponent.greeting}</div>
                      <button
                        type="button"
                        className={styles.speakReplay}
                        aria-label={t('gameReplayVoice')}
                        title={t('gameReplayVoice')}
                        onClick={replayOpponentSpeech}
                      >
                        <IconPlayMediaOutline16 />
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}

              {statusNote ? (
                <div className={styles.noticeBar} role="status">
                  <span>{statusNote}</span>
                </div>
              ) : null}

              {errorText ? (
                <div className={styles.errorBar} role="alert">
                  <span>{errorText}</span>
                  {showRetryButton ? (
                    <Button variant="outlined" size="s" onClick={retryAiTurn}>
                      {t('retry')}
                    </Button>
                  ) : null}
                </div>
              ) : null}

              <plugin.BoardComponent
                state={gameState}
                disabled={aiThinking || status !== 'playing' || turn !== 'player'}
                turnSecondsLeft={turnSecondsLeft}
                aiThinking={aiThinking}
                onPlayerMove={submitPlayerGameMove}
              />

              <div className={styles.boardFooter}>
                <span>{plugin.badge[locale]}</span>
                {status !== 'playing' ? (
                  <Button variant="primary" size="s" onClick={restartCurrentGame}>
                    {t('gamePlayAgain')}
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className={styles.body}>
          <div className={styles.opponentStage}>
            <div className={styles.avatarBox}>{renderOpponentAvatar()}</div>
            <div className={styles.opponentMeta}>
              <div className={styles.opponentTop}>
                <span className={styles.opponentName}>{opponent.name}</span>
                <span className={styles.opponentBadge}>{opponent.tagline}</span>
              </div>
              <div className={styles.speechBubble}>{opponent.greeting}</div>
            </div>
          </div>

          <div className={styles.pickerSectionTitle}>{t('gameOpponentSection')}</div>
          <div className={styles.opponentChoices}>
            <button
              type="button"
              className={clsx(
                styles.pillBtn,
                selectedChoice === PET_OPPONENT_ID && styles.pillBtnActive
              )}
              onClick={() => {
                setGameOpponentChoice(PET_OPPONENT_ID)
                setEditingCustom(false)
              }}
            >
              {t('gameOpponentPet')}
            </button>
            <button
              type="button"
              className={clsx(
                styles.pillBtn,
                selectedChoice === DEFAULT_OPPONENT_ID && styles.pillBtnActive
              )}
              onClick={() => {
                setGameOpponentChoice(DEFAULT_OPPONENT_ID)
                setEditingCustom(false)
              }}
            >
              {t('gameOpponentDefaultLogo')}
            </button>
            <button
              type="button"
              className={clsx(
                styles.pillBtn,
                selectedChoice === ACTIVE_PERSONA_OPPONENT_ID && styles.pillBtnActive
              )}
              onClick={() => {
                setGameOpponentChoice(ACTIVE_PERSONA_OPPONENT_ID)
                setEditingCustom(false)
              }}
            >
              {t('gameOpponentUsePersona')}
            </button>
            <button
              type="button"
              className={clsx(
                styles.pillBtn,
                selectedChoice === CUSTOM_OPPONENT_ID && styles.pillBtnActive
              )}
              onClick={() => {
                setGameOpponentChoice(CUSTOM_OPPONENT_ID)
                setEditingCustom((prev) => !prev)
              }}
            >
              {t('gameOpponentCustom')}
            </button>
          </div>

          {editingCustom || selectedChoice === CUSTOM_OPPONENT_ID ? (
            <div className={styles.customForm}>
              <input
                type="text"
                className={styles.customInput}
                value={draftName}
                placeholder={t('gameOpponentNamePlaceholder')}
                onChange={(e) => setDraftName(e.target.value)}
              />
              <input
                type="text"
                className={styles.customInput}
                value={draftTagline}
                placeholder={t('gameOpponentTagPlaceholder')}
                onChange={(e) => setDraftTagline(e.target.value)}
              />
              <input
                type="text"
                className={styles.customInput}
                value={draftGreeting}
                placeholder={t('gameOpponentGreetingPlaceholder')}
                onChange={(e) => setDraftGreeting(e.target.value)}
              />
              <input
                type="text"
                className={styles.customInput}
                value={draftPrompt}
                placeholder={t('gameOpponentPromptPlaceholder')}
                onChange={(e) => setDraftPrompt(e.target.value)}
              />
              <Button
                variant="primary"
                size="s"
                onClick={() => {
                  saveCustomGameOpponent(
                    {
                      name: draftName,
                      tagline: draftTagline,
                      greeting: draftGreeting,
                      systemPrompt: draftPrompt,
                    },
                    locale
                  )
                  setEditingCustom(false)
                }}
              >
                {t('personaSave')}
              </Button>
            </div>
          ) : null}

          <div className={styles.pickerSectionTitle}>{t('gameSelectTitle')}</div>
          <div className={styles.gameGrid}>
            {GAME_REGISTRY.map((item) => (
              <button
                key={item.id}
                type="button"
                className={styles.gameCard}
                onClick={() => startGame(item.id)}
              >
                <div className={styles.gameCardTop}>
                  <span className={styles.gameCardName}>{item.name[locale]}</span>
                  <span className={styles.gameCardBadge}>{item.badge[locale]}</span>
                </div>
                <span className={styles.gameCardDesc}>{item.subtitle[locale]}</span>
              </button>
            ))}
            <div className={clsx(styles.gameCard, styles.gameCardUpcoming)} aria-disabled="true">
              <div className={styles.gameCardTop}>
                <span className={styles.gameCardName}>{t('gameMahjongTitle')}</span>
                <span className={clsx(styles.gameCardBadge, styles.gameCardBadgeMuted)}>
                  {t('gameMahjongBadge')}
                </span>
              </div>
              <span className={styles.gameCardDesc}>{t('gameMahjongSubtitle')}</span>
            </div>
          </div>

          <div className={styles.costNoticeBox}>{t('gameCostNotice')}</div>
        </div>
      )}
    </aside>
  )

  if (isExpandedModal) {
    return (
      <div
        className={styles.expandedBackdrop}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            toggleGameExpanded()
          }
        }}
      >
        {drawerNode}
      </div>
    )
  }

  return drawerNode
}
