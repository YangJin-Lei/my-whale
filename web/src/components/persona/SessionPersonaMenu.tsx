import clsx from 'clsx'
import { useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  getSessionUsedMemories,
  isEphemeralSession,
  switchSessionPersona,
  syncSessionPersonaSnapshot,
  toggleSessionIncognito,
  updateSessionNote,
} from '../../services/chat/store.js'
import type { Session } from '../../services/chat/types.js'
import { DEFAULT_PERSONA_ID } from '../../services/persona/builtin.js'
import { findPersona, getAllPersonas, usePersonaStore } from '../../services/persona/store.js'
import { SESSION_NOTE_MAX } from '../../services/persona/types.js'
import { useSettings } from '../../services/settings.js'
import { Button } from '../base/Button.js'
import { IconChevronDownOutline14, IconIncognitoOutline16 } from '../base/icons.js'
import { Modal } from '../base/Modal.js'
import { PersonaAvatar } from './PersonaAvatar.js'
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
  const [noteDraft, setNoteDraft] = useState('')
  const [showMemories, setShowMemories] = useState(false)

  const allPersonas = getAllPersonas(customPersonas, locale)
  const currentId = session.persona?.personaId ?? null
  const matchedCustom = currentId ? customPersonas.find((item) => item.id === currentId) : undefined
  const resolved = findPersona(currentId, customPersonas, locale)
  const displayName = session.persona?.snapshot?.name ?? resolved.name
  const displayAvatar = session.persona?.snapshot?.avatar ?? resolved.avatar
  const isDefaultPersona =
    (currentId ?? DEFAULT_PERSONA_ID) === DEFAULT_PERSONA_ID && !session.persona?.snapshot
  const incognito = Boolean(session.persona?.incognito)
  const ephemeral = isEphemeralSession(session.id)

  // 会话内切换仅展示默认助手 + 用户自定义人设（及当前会话自身引用的内置人设）
  const switchOptions = allPersonas.filter(
    (p) => p.id === DEFAULT_PERSONA_ID || !p.builtin || p.id === currentId
  )

  const hasUpdate =
    Boolean(matchedCustom) &&
    Boolean(session.persona?.snapshot) &&
    (matchedCustom?.instructions !== session.persona?.snapshot?.instructions ||
      matchedCustom?.name !== session.persona?.snapshot?.name ||
      matchedCustom?.avatar !== session.persona?.snapshot?.avatar)

  const usedMemories = open || showMemories ? getSessionUsedMemories(session.id) : []

  const openMenu = () => {
    setNoteDraft(session.persona?.note ?? '')
    setShowMemories(false)
    setOpen(true)
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
                      isDefault={persona.id === DEFAULT_PERSONA_ID}
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
