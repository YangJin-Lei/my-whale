import clsx from 'clsx'
import { useEffect, useRef, useState } from 'react'
import { Button } from '../components/base/Button.js'
import { IconButton } from '../components/base/IconButton.js'
import { IconCloseOutline16, IconSendOutline16 } from '../components/base/icons.js'
import { Modal } from '../components/base/Modal.js'
import { showToast } from '../components/base/toastState.js'
import { useTranslate } from '../i18n/index.js'
import { getChatroomPetIds, PET_CHATROOM_MAX, useSettings } from '../services/settings.js'
import { findPetById, usePetCatalog } from './catalog.js'
import {
  addChatroomPet,
  closePetChatroom,
  defaultPetApiConfig,
  getPetApiConfig,
  openPetDebugModal,
  removeChatroomPet,
  resetPetChatroom,
  saveChatroomToMainSession,
  savePetApiConfig,
  sendUserToPetChatroom,
  setChatroomIntervalSec,
  testPetApiConfig,
  toggleChatroomRunning,
  triggerPetChatroomTurn,
  usePetChatroom,
  type PetApiConfig,
  type PetApiMode,
} from './chatroom.js'
import styles from './PetChatroomDrawer.module.css'
import { PetSprite } from './PetSprite.js'

const INTERVAL_OPTIONS = [8, 15, 30, 60] as const

const PetApiDebugModal = ({ petId }: { petId: string }) => {
  const t = useTranslate()
  const locale = useSettings((s) => s.locale)
  const pet = findPetById(petId)
  const existing = getPetApiConfig(petId)
  const stats = usePetChatroom((s) => s.petDebugStats[petId])

  const [mode, setMode] = useState<PetApiMode>(existing.mode)
  const [protocol, setProtocol] = useState<'openai' | 'anthropic'>(existing.protocol)
  const [url, setUrl] = useState(existing.url)
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState(existing.model)
  const [thinking, setThinking] = useState(existing.thinking)
  const [customPrompt, setCustomPrompt] = useState(existing.customPrompt)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null)

  const buildDraft = (): PetApiConfig => ({
    mode,
    protocol,
    url: url.trim().replace(/\/+$/, ''),
    apiKey: apiKey.trim() || existing.apiKey,
    model: model.trim(),
    thinking,
    customPrompt: customPrompt.trim(),
  })

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      await testPetApiConfig(petId, buildDraft())
      setTestResult({ ok: true, text: t('petRoomDebugTestOk') })
    } catch (error) {
      setTestResult({
        ok: false,
        text: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setTesting(false)
    }
  }

  const handleSave = () => {
    savePetApiConfig(petId, buildDraft())
    openPetDebugModal(null)
  }

  const totalInput = (stats?.inputTokens ?? 0) + (stats?.cacheReadTokens ?? 0)
  const cachePct =
    totalInput > 0 ? Math.round(((stats?.cacheReadTokens ?? 0) / totalInput) * 100) : 0

  return (
    <Modal
      title={`${pet.name[locale]} · ${t('petRoomDebugTitle')}`}
      onClose={() => openPetDebugModal(null)}
      footer={
        <>
          <Button
            variant="outlined"
            size="m"
            disabled={testing}
            onClick={() => {
              const reset = defaultPetApiConfig()
              savePetApiConfig(petId, reset)
              openPetDebugModal(null)
            }}
          >
            {t('customApiClear')}
          </Button>
          <Button variant="outlined" size="m" disabled={testing} onClick={() => void handleTest()}>
            {testing ? t('apiKeyVerifying') : t('petRoomDebugTest')}
          </Button>
          <Button variant="primary" size="m" disabled={testing} onClick={handleSave}>
            {t('personaSave')}
          </Button>
        </>
      }
    >
      <div className={styles.debugForm}>
        <div className={styles.debugField}>
          <span className={styles.debugLabel}>{t('petRoomDebugMode')}</span>
          <div className={styles.controlGroup}>
            <button
              type="button"
              className={clsx(styles.pillBtn, mode === 'global' && styles.pillBtnActive)}
              onClick={() => setMode('global')}
            >
              {t('petRoomDebugModeGlobal')}
            </button>
            <button
              type="button"
              className={clsx(styles.pillBtn, mode === 'official' && styles.pillBtnActive)}
              onClick={() => setMode('official')}
            >
              {t('apiProviderOfficial')}
            </button>
            <button
              type="button"
              className={clsx(styles.pillBtn, mode === 'custom' && styles.pillBtnActive)}
              onClick={() => setMode('custom')}
            >
              {t('apiProviderCustom')}
            </button>
          </div>
        </div>

        {mode === 'custom' ? (
          <>
            <div className={styles.debugField}>
              <span className={styles.debugLabel}>{t('customApiProtocol')}</span>
              <div className={styles.controlGroup}>
                <button
                  type="button"
                  className={clsx(styles.pillBtn, protocol === 'openai' && styles.pillBtnActive)}
                  onClick={() => setProtocol('openai')}
                >
                  {t('customApiProtocolOpenAi')}
                </button>
                <button
                  type="button"
                  className={clsx(styles.pillBtn, protocol === 'anthropic' && styles.pillBtnActive)}
                  onClick={() => setProtocol('anthropic')}
                >
                  {t('customApiProtocolAnthropic')}
                </button>
              </div>
            </div>
            <div className={styles.debugField}>
              <label className={styles.debugLabel} htmlFor="pet-debug-url">
                {t('customApiUrlLabel')}
              </label>
              <input
                id="pet-debug-url"
                type="url"
                className={styles.debugInput}
                value={url}
                placeholder={t('customApiUrlPlaceholder')}
                onChange={(e) => setUrl(e.target.value)}
              />
            </div>
          </>
        ) : null}

        {mode !== 'global' ? (
          <>
            <div className={styles.debugField}>
              <label className={styles.debugLabel} htmlFor="pet-debug-key">
                {t('customApiKeyLabel')}
              </label>
              <input
                id="pet-debug-key"
                type="password"
                className={styles.debugInput}
                value={apiKey}
                placeholder={
                  existing.apiKey
                    ? t('customApiKeySavedPlaceholder')
                    : mode === 'official'
                      ? t('petRoomDebugKeyOptional')
                      : t('customApiKeyPlaceholder')
                }
                onChange={(e) => setApiKey(e.target.value)}
              />
            </div>
            <div className={styles.debugField}>
              <label className={styles.debugLabel} htmlFor="pet-debug-model">
                {t('customApiModelLabel')}
              </label>
              <input
                id="pet-debug-model"
                type="text"
                className={styles.debugInput}
                value={model}
                placeholder={
                  mode === 'official' ? 'deepseek-flash' : t('customApiModelPlaceholder')
                }
                onChange={(e) => setModel(e.target.value)}
              />
            </div>
          </>
        ) : null}

        <label className={styles.controlGroup}>
          <input
            type="checkbox"
            checked={thinking}
            onChange={(e) => setThinking(e.target.checked)}
          />
          <span className={styles.debugLabel}>{t('thinkingSwitch')}</span>
        </label>

        <div className={styles.debugField}>
          <label className={styles.debugLabel} htmlFor="pet-debug-prompt">
            {t('petRoomDebugPrompt')}
          </label>
          <textarea
            id="pet-debug-prompt"
            className={styles.debugTextarea}
            value={customPrompt}
            placeholder={t('petRoomDebugPromptPlaceholder')}
            onChange={(e) => setCustomPrompt(e.target.value)}
          />
        </div>

        {stats ? (
          <div className={styles.debugStatsCard}>
            <div>
              {stats.endpointLabel} · {stats.lastLatencyMs ?? 0}ms
            </div>
            <div>
              {t('petRoomDebugCacheStats', {
                cached: stats.cacheReadTokens,
                pct: cachePct,
                out: stats.outputTokens,
              })}
            </div>
            {stats.errorText ? <div className={styles.debugErrorMsg}>{stats.errorText}</div> : null}
          </div>
        ) : null}

        {testResult ? (
          <div className={testResult.ok ? styles.debugStatusMsg : styles.debugErrorMsg}>
            {testResult.text}
          </div>
        ) : null}
      </div>
    </Modal>
  )
}

export const PetChatroomDrawer = () => {
  const t = useTranslate()
  const locale = useSettings((s) => s.locale)
  const desktopPetIds = useSettings((s) => s.desktopPetIds)
  const chatroomExtraPetIds = useSettings((s) => s.chatroomExtraPetIds)
  const memberIds = getChatroomPetIds({
    ...useSettings.getState(),
    desktopPetIds,
    chatroomExtraPetIds,
  })
  const allPets = usePetCatalog()

  const drawerOpen = usePetChatroom((s) => s.drawerOpen)
  const running = usePetChatroom((s) => s.running)
  const autoIntervalSec = usePetChatroom((s) => s.autoIntervalSec)
  const countdownSec = usePetChatroom((s) => s.countdownSec)
  const messages = usePetChatroom((s) => s.messages)
  const streamingPetId = usePetChatroom((s) => s.streamingPetId)
  const streamingText = usePetChatroom((s) => s.streamingText)
  const linkedSessionId = usePetChatroom((s) => s.linkedSessionId)
  const errorText = usePetChatroom((s) => s.errorText)
  const debugModalPetId = usePetChatroom((s) => s.debugModalPetId)
  const petApiConfigs = usePetChatroom((s) => s.petApiConfigs)
  const petDebugStats = usePetChatroom((s) => s.petDebugStats)

  const [inputText, setInputText] = useState('')
  const [addingMember, setAddingMember] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = listRef.current
    if (el) {
      el.scrollTop = el.scrollHeight
    }
  }, [messages.length, streamingText])

  if (!drawerOpen) {
    return null
  }

  const desktopSet = new Set(desktopPetIds)
  const memberSet = new Set(memberIds)
  const availableToAdd = allPets.filter((p) => !memberSet.has(p.id))

  const handleSubmit = () => {
    const text = inputText.trim()
    if (!text) {
      return
    }
    setInputText('')
    sendUserToPetChatroom(text)
  }

  const handleSaveSession = () => {
    const id = saveChatroomToMainSession(false)
    if (id) {
      showToast({ key: 'petRoomSavedToast' })
    }
  }

  const streamingPet = streamingPetId ? findPetById(streamingPetId) : null

  return (
    <aside className={styles.drawer} aria-label={t('petRoomTitle')}>
      <div className={styles.header}>
        <div className={styles.title}>
          {t('petRoomTitle')} ({memberIds.length}/{PET_CHATROOM_MAX})
        </div>
        <button
          type="button"
          className={clsx(styles.pillBtn, running ? styles.pauseBtn : styles.playBtn)}
          onClick={toggleChatroomRunning}
        >
          {running ? t('petRoomPause') : t('petRoomStart')}
        </button>
        <IconButton
          icon={<IconCloseOutline16 />}
          aria-label={t('close')}
          onClick={closePetChatroom}
        />
      </div>

      <div className={styles.costBanner}>{t('petRoomCostNotice')}</div>

      <div className={styles.controlsBar}>
        <div className={styles.controlGroup}>
          <span>{t('petRoomTimerLabel')}:</span>
          {INTERVAL_OPTIONS.map((sec) => (
            <button
              key={sec}
              type="button"
              className={clsx(styles.pillBtn, autoIntervalSec === sec && styles.pillBtnActive)}
              onClick={() => setChatroomIntervalSec(sec)}
            >
              {sec}s
            </button>
          ))}
          {running && countdownSec !== null ? (
            <span className={styles.desktopTag}>{countdownSec}s</span>
          ) : null}
        </div>
        <div className={styles.spacer} />
        <div className={styles.controlGroup}>
          <button
            type="button"
            className={styles.pillBtn}
            disabled={Boolean(streamingPetId)}
            onClick={() => void triggerPetChatroomTurn()}
          >
            {t('petRoomStepOnce')}
          </button>
          <button
            type="button"
            className={styles.pillBtn}
            disabled={messages.length === 0}
            onClick={handleSaveSession}
          >
            {t('petRoomSaveSession')}
          </button>
          {linkedSessionId ? (
            <button
              type="button"
              className={clsx(styles.pillBtn, styles.pillBtnActive)}
              onClick={() => void saveChatroomToMainSession(true)}
            >
              {t('petRoomViewSession')}
            </button>
          ) : null}
          <button type="button" className={styles.pillBtn} onClick={resetPetChatroom}>
            {t('petRoomNewRoom')}
          </button>
        </div>
      </div>

      <div className={styles.rosterSection}>
        <div className={styles.rosterScroll}>
          {memberIds.map((petId) => {
            const pet = findPetById(petId)
            const isDesktop = desktopSet.has(petId)
            const isSpeaking = streamingPetId === petId
            const cfg = petApiConfigs[petId]
            const stats = petDebugStats[petId]
            const apiTag =
              cfg?.mode === 'custom' ? cfg.model || 'API' : cfg?.mode === 'official' ? 'DS' : 'API'
            const totalIn = (stats?.inputTokens ?? 0) + (stats?.cacheReadTokens ?? 0)
            const hitPct =
              totalIn > 0 ? Math.round(((stats?.cacheReadTokens ?? 0) / totalIn) * 100) : null

            return (
              <div
                key={petId}
                className={clsx(styles.memberChip, isSpeaking && styles.memberChipSpeaking)}
              >
                <button
                  type="button"
                  className={styles.memberMentionBtn}
                  onClick={() =>
                    setInputText((prev) =>
                      prev.trim() ? `${prev} @${pet.name[locale]} ` : `@${pet.name[locale]} `
                    )
                  }
                >
                  <PetSprite
                    spriteUrl={pet.spriteUrl}
                    mood={isSpeaking ? 'speak' : 'idle'}
                    width={22}
                    cols={pet.cols}
                    rows={pet.rows}
                    animate={isSpeaking}
                  />
                  <span>{pet.name[locale]}</span>
                </button>
                {isDesktop ? (
                  <span className={styles.desktopTag}>{t('petRoomDesktopTag')}</span>
                ) : null}
                <button
                  type="button"
                  className={styles.apiDebugBtn}
                  onClick={() => openPetDebugModal(petId)}
                >
                  {hitPct !== null ? `${apiTag} ${hitPct}%` : apiTag}
                </button>
                {!isDesktop ? (
                  <button
                    type="button"
                    className={styles.kickBtn}
                    aria-label={t('delete')}
                    onClick={() => removeChatroomPet(petId)}
                  >
                    ×
                  </button>
                ) : null}
              </div>
            )
          })}

          {memberIds.length < PET_CHATROOM_MAX && availableToAdd.length > 0 ? (
            <button
              type="button"
              className={styles.pillBtn}
              onClick={() => setAddingMember((prev) => !prev)}
            >
              + {t('petRoomAddMember')}
            </button>
          ) : null}
        </div>

        {addingMember && availableToAdd.length > 0 ? (
          <div className={styles.addPicker}>
            {availableToAdd.map((pet) => (
              <button
                key={pet.id}
                type="button"
                className={styles.pillBtn}
                onClick={() => {
                  addChatroomPet(pet.id)
                  if (memberIds.length + 1 >= PET_CHATROOM_MAX) {
                    setAddingMember(false)
                  }
                }}
              >
                + {pet.name[locale]}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div ref={listRef} className={styles.messages}>
        {messages.length === 0 && !streamingPet ? (
          <div className={styles.emptyHint}>{t('petRoomEmptyHint')}</div>
        ) : null}
        {messages.map((msg) => {
          if (msg.senderType === 'system') {
            return (
              <div key={msg.id} className={styles.systemLine}>
                {msg.content}
              </div>
            )
          }
          if (msg.senderType === 'user') {
            return (
              <div key={msg.id} className={styles.userRow}>
                <div className={styles.userBubble}>{msg.content}</div>
              </div>
            )
          }
          const pet = findPetById(msg.petId)
          return (
            <div key={msg.id} className={styles.petRow}>
              <div className={styles.petAvatarBox}>
                <PetSprite
                  spriteUrl={pet.spriteUrl}
                  mood="idle"
                  width={32}
                  cols={pet.cols}
                  rows={pet.rows}
                  animate={false}
                />
              </div>
              <div className={styles.petMsgBody}>
                <div className={styles.petNameLine}>{msg.senderName}</div>
                <div className={styles.petBubble}>{msg.content}</div>
              </div>
            </div>
          )
        })}

        {streamingPet ? (
          <div className={styles.petRow}>
            <div className={styles.petAvatarBox}>
              <PetSprite
                spriteUrl={streamingPet.spriteUrl}
                mood="speak"
                width={32}
                cols={streamingPet.cols}
                rows={streamingPet.rows}
                animate
              />
            </div>
            <div className={styles.petMsgBody}>
              <div className={styles.petNameLine}>{streamingPet.name[locale]}</div>
              <div className={styles.petBubble}>{streamingText || t('petThinking')}</div>
            </div>
          </div>
        ) : null}
      </div>

      {errorText ? <div className={styles.errorBox}>{errorText}</div> : null}

      <div className={styles.inputBar}>
        <input
          type="text"
          className={styles.textInput}
          placeholder={t('petRoomInputPlaceholder')}
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault()
              handleSubmit()
            }
          }}
        />
        <IconButton
          icon={<IconSendOutline16 />}
          aria-label={t('send')}
          disabled={!inputText.trim()}
          onClick={handleSubmit}
        />
      </div>

      {debugModalPetId ? <PetApiDebugModal petId={debugModalPetId} /> : null}
    </aside>
  )
}
