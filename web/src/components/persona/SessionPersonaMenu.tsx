import clsx from 'clsx'
import { useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  addSessionLocalMemory,
  deleteSessionLocalMemory,
  getSessionUsedMemories,
  isEphemeralSession,
  promoteTrialSession,
  setSessionMemoryScope,
  switchSessionPersona,
  syncSessionPersonaSnapshot,
  toggleSessionIncognito,
  tuneSessionAssistant,
  updateSessionNote,
} from '../../services/chat/store.js'
import type { Session } from '../../services/chat/types.js'
import { MEMORY_CONTENT_MAX } from '../../services/memory/types.js'
import { DEFAULT_PERSONA_ID, MY_WHALE_ASSISTANT_ID } from '../../services/persona/builtin.js'
import { findPersona, getAllPersonas, usePersonaStore } from '../../services/persona/store.js'
import {
  PERSONA_INSTRUCTIONS_MAX,
  PERSONA_NAME_MAX,
  SESSION_NOTE_MAX,
} from '../../services/persona/types.js'
import { useSettings } from '../../services/settings.js'
import { Button } from '../base/Button.js'
import { IconChevronDownOutline14, IconIncognitoOutline16 } from '../base/icons.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import { PersonaAvatar } from './PersonaAvatar.js'
import { compressAvatarFile } from './PersonaEditor.js'
import styles from './Persona.module.css'

export const SessionPersonaMenu = ({
  session,
  streaming,
}: {
  session: Session
  streaming: boolean
}) => {
  const t = useTranslate()
  const locale = useSettings((state) => state.locale)
  const customPersonas = usePersonaStore((state) => state.personas)
  const [open, setOpen] = useState(false)
  const [tuning, setTuning] = useState(false)
  const [tuneName, setTuneName] = useState('')
  const [tuneAvatar, setTuneAvatar] = useState('')
  const [tuneInstructions, setTuneInstructions] = useState('')
  const tuneAvatarInputRef = useRef<HTMLInputElement>(null)
  const [noteDraft, setNoteDraft] = useState('')
  const [localDraft, setLocalDraft] = useState('')
  const [showMemories, setShowMemories] = useState(false)

  const allPersonas = getAllPersonas(customPersonas, locale)
  const currentId = session.persona?.personaId ?? null
  const matchedCustom = currentId ? customPersonas.find((item) => item.id === currentId) : undefined
  const resolved = findPersona(currentId, customPersonas, locale)
  const displayName = session.persona?.snapshot?.name ?? resolved.name
  const displayAvatar = session.persona?.snapshot?.avatar ?? resolved.avatar
  const resolvedId = currentId ?? DEFAULT_PERSONA_ID
  const isDefaultPersona =
    (resolvedId === DEFAULT_PERSONA_ID || resolvedId === MY_WHALE_ASSISTANT_ID) &&
    (!session.persona?.snapshot?.avatar ||
      !session.persona.snapshot.avatar.startsWith('data:image/'))
  const incognito = Boolean(session.persona?.incognito)
  const localOnly = session.persona?.memoryScope === 'local_only'
  const localMemories = session.persona?.localMemories ?? []
  const ephemeral = isEphemeralSession(session.id)

  // 会话内切换展示：my-whale助手 + 用户自定义人设（仅当当前会话原为默认助手或内置人设时保留自身选项）
  const switchOptions = allPersonas.filter(
    (p) => p.id === MY_WHALE_ASSISTANT_ID || !p.builtin || p.id === currentId
  )

  const hasUpdate =
    Boolean(matchedCustom) &&
    Boolean(session.persona?.snapshot) &&
    (matchedCustom?.instructions !== session.persona?.snapshot?.instructions ||
      matchedCustom?.name !== session.persona?.snapshot?.name ||
      matchedCustom?.avatar !== session.persona?.snapshot?.avatar)

  const usedMemories = open || showMemories ? getSessionUsedMemories(session.id) : []

  const openMenu = () => {
    setTuning(false)
    setTuneName(displayName)
    setTuneAvatar(displayAvatar && displayAvatar.startsWith('data:image/') ? displayAvatar : '')
    setTuneInstructions(session.persona?.snapshot?.instructions ?? resolved.instructions ?? '')
    setNoteDraft(session.persona?.note ?? '')
    setLocalDraft('')
    setShowMemories(false)
    setOpen(true)
  }

  const handleTuneAvatarChange = async (file: File | undefined) => {
    if (!file) {
      return
    }
    const compressed = await compressAvatarFile(file)
    if (!compressed) {
      showToast({ key: 'personaAvatarTooLarge', type: 'error' })
      return
    }
    setTuneAvatar(compressed)
  }

  const saveTunedAssistant = () => {
    tuneSessionAssistant(session.id, {
      name: tuneName,
      avatar: tuneAvatar,
      instructions: tuneInstructions,
    })
    setTuning(false)
    setOpen(false)
  }

  const submitLocalMemory = () => {
    if (!localDraft.trim()) {
      return
    }
    addSessionLocalMemory(session.id, localDraft)
    setLocalDraft('')
  }

  return (
    <div className={styles.sessionMenuWrap}>
      <button
        type="button"
        className={clsx(styles.sessionPill, incognito && styles.sessionPillIncognito)}
        onClick={openMenu}
      >
        <PersonaAvatar
          avatar={displayAvatar}
          name={displayName}
          isDefault={isDefaultPersona}
          size="s"
        />
        <span className={styles.sessionPillName}>{displayName}</span>
        {incognito ? (
          <span className={styles.incognitoIcon} title={t('personaIncognito')}>
            <IconIncognitoOutline16 />
          </span>
        ) : null}
        {ephemeral ? <span className={styles.trialTag}>{t('personaTrialTag')}</span> : null}
        <span className={styles.caret}>
          <IconChevronDownOutline14 />
        </span>
      </button>

      {ephemeral ? (
        <button
          type="button"
          className={styles.updateBannerBtn}
          onClick={() => {
            if (promoteTrialSession(session.id)) {
              showToast({ key: 'personaSavedToListToast' })
            }
          }}
        >
          {t('personaSaveToList')}
        </button>
      ) : null}

      {hasUpdate && matchedCustom && !streaming ? (
        <button
          type="button"
          className={styles.updateBannerBtn}
          onClick={() => syncSessionPersonaSnapshot(session.id, matchedCustom)}
        >
          {t('personaUpdatedBanner', { name: matchedCustom.name })} · {t('personaApplyUpdate')}
        </button>
      ) : null}

      {open ? (
        <Modal
          title={t('personaSwitchAction')}
          closable
          className={styles.sessionModal}
          mainClassName={styles.sessionModalMain}
          onClose={() => setOpen(false)}
        >
          <div className={styles.modalSection}>
            <div className={styles.tuneCurrentRow}>
              <div className={styles.tuneIdentity}>
                <PersonaAvatar
                  avatar={displayAvatar}
                  name={displayName}
                  isDefault={isDefaultPersona}
                  size="m"
                />
                <span className={styles.switchName}>{displayName}</span>
              </div>
              <Button
                variant={tuning ? 'primary' : 'outlined'}
                size="s"
                disabled={streaming}
                onClick={() => setTuning((v) => !v)}
              >
                {t('personaTune')}
              </Button>
            </div>
            {tuning ? (
              <div className={styles.tuneBox}>
                <div className={styles.avatarRow}>
                  <PersonaAvatar
                    avatar={tuneAvatar}
                    name={tuneName || displayName}
                    isDefault={!tuneAvatar}
                    size="l"
                  />
                  <input
                    ref={tuneAvatarInputRef}
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={(event) => {
                      void handleTuneAvatarChange(event.target.files?.[0])
                      event.target.value = ''
                    }}
                  />
                  <Button
                    variant="outlined"
                    size="s"
                    onClick={() => tuneAvatarInputRef.current?.click()}
                  >
                    {t('personaUploadAvatar')}
                  </Button>
                  {tuneAvatar ? (
                    <Button variant="outlined" size="s" onClick={() => setTuneAvatar('')}>
                      {t('personaClearAvatar')}
                    </Button>
                  ) : null}
                </div>
                <label className={styles.fieldLabel}>{t('personaName')}</label>
                <input
                  className={styles.input}
                  maxLength={PERSONA_NAME_MAX}
                  value={tuneName}
                  onChange={(event) => setTuneName(event.target.value)}
                />
                <label className={styles.fieldLabel}>{t('personaInstructions')}</label>
                <textarea
                  className={styles.textarea}
                  rows={4}
                  maxLength={PERSONA_INSTRUCTIONS_MAX}
                  value={tuneInstructions}
                  onChange={(event) => setTuneInstructions(event.target.value)}
                />
                <div className={styles.noteSaveRow}>
                  <Button variant="primary" size="s" onClick={saveTunedAssistant}>
                    {t('personaSave')}
                  </Button>
                </div>
              </div>
            ) : null}
          </div>

          <div className={styles.modalSection}>
            <div className={styles.fieldLabel}>{t('personaSwitchAction')}</div>
            <div className={styles.switchGrid}>
              {switchOptions.map((persona) => {
                const active = (currentId ?? resolved.id) === persona.id
                return (
                  <button
                    key={persona.id}
                    type="button"
                    disabled={streaming}
                    className={clsx(styles.switchItem, active && styles.switchItemActive)}
                    onClick={() => {
                      if (!active) {
                        switchSessionPersona(session.id, persona)
                      }
                      setOpen(false)
                    }}
                  >
                    <PersonaAvatar
                      avatar={persona.avatar}
                      name={persona.name}
                      isDefault={
                        persona.id === DEFAULT_PERSONA_ID || persona.id === MY_WHALE_ASSISTANT_ID
                      }
                      size="s"
                    />
                    <span className={styles.switchName}>{persona.name}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className={styles.modalSection}>
            <div className={styles.fieldHeader}>
              <label className={styles.fieldLabel}>{t('personaSessionNote')}</label>
              <span className={styles.counter}>
                {noteDraft.length}/{SESSION_NOTE_MAX}
              </span>
            </div>
            <textarea
              className={styles.textarea}
              rows={3}
              maxLength={SESSION_NOTE_MAX}
              placeholder={t('personaSessionNotePlaceholder')}
              value={noteDraft}
              onChange={(event) => setNoteDraft(event.target.value)}
            />
            <div className={styles.noteSaveRow}>
              <Button
                variant="outlined"
                size="s"
                onClick={() => {
                  updateSessionNote(session.id, noteDraft)
                  setOpen(false)
                }}
              >
                {t('personaSave')}
              </Button>
            </div>
          </div>

          <div className={styles.modalSection}>
            <div className={styles.toggleRow}>
              <div>
                <div className={styles.incognitoTitle}>
                  <IconIncognitoOutline16 />
                  <span>{t('personaIncognito')}</span>
                </div>
                <div className={styles.hint}>{t('personaIncognitoDesc')}</div>
              </div>
              <input
                type="checkbox"
                checked={incognito}
                onChange={(event) => toggleSessionIncognito(session.id, event.target.checked)}
              />
            </div>
          </div>

          <div className={styles.modalSection}>
            <div className={styles.toggleRow}>
              <div>
                <div className={styles.fieldLabel}>{t('memoryScopeLocalOnly')}</div>
                <div className={styles.hint}>{t('memoryScopeLocalOnlyDesc')}</div>
              </div>
              <input
                type="checkbox"
                disabled={incognito}
                checked={localOnly}
                onChange={(event) =>
                  setSessionMemoryScope(
                    session.id,
                    event.target.checked ? 'local_only' : 'global_and_local'
                  )
                }
              />
            </div>
          </div>

          <div className={styles.modalSection}>
            <div className={styles.fieldLabel}>
              {t('personaLocalMemories')} ({localMemories.length})
            </div>
            {localMemories.length > 0 ? (
              <ul className={styles.localMemoryList}>
                {localMemories.map((item) => (
                  <li key={item.id} className={styles.localMemoryItem}>
                    <span>{item.content}</span>
                    <button
                      type="button"
                      className={styles.localMemoryDel}
                      aria-label={t('delete')}
                      onClick={() => deleteSessionLocalMemory(session.id, item.id)}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className={styles.hint}>{t('personaNoLocalMemories')}</div>
            )}
            <div className={styles.localMemoryAddRow}>
              <input
                className={styles.input}
                maxLength={MEMORY_CONTENT_MAX}
                placeholder={t('personaLocalMemoryPlaceholder')}
                value={localDraft}
                onChange={(event) => setLocalDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    submitLocalMemory()
                  }
                }}
              />
              <Button
                variant="outlined"
                size="s"
                disabled={!localDraft.trim()}
                onClick={submitLocalMemory}
              >
                {t('personaLocalMemoryAdd')}
              </Button>
            </div>
          </div>

          <div className={styles.modalSection}>
            <button
              type="button"
              className={styles.linkBtn}
              onClick={() => setShowMemories((v) => !v)}
            >
              {t('personaUsedMemories')} ({usedMemories.length})
            </button>
            {showMemories ? (
              usedMemories.length > 0 ? (
                <ul className={styles.usedMemoryList}>
                  {usedMemories.map((memory) => (
                    <li key={memory.id}>{memory.content}</li>
                  ))}
                </ul>
              ) : (
                <div className={styles.hint}>{t('personaNoUsedMemories')}</div>
              )
            ) : null}
          </div>
        </Modal>
      ) : null}
    </div>
  )
}
