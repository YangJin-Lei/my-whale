import clsx from 'clsx'
import { useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  setDraftAssistantOverride,
  setDraftIncognito,
  setDraftPersona,
  useChatStore,
} from '../../services/chat/store.js'
import { DEFAULT_PERSONA_ID, MY_WHALE_ASSISTANT_ID } from '../../services/persona/builtin.js'
import { findPersona, getAllPersonas, usePersonaStore } from '../../services/persona/store.js'
import {
  PERSONA_INSTRUCTIONS_MAX,
  PERSONA_NAME_MAX,
  type Persona,
} from '../../services/persona/types.js'
import { useSettings } from '../../services/settings.js'
import { openGameDrawer } from '../../game/store.js'
import { Button } from '../base/Button.js'
import { IconGamepadOutline16, IconIncognitoOutline16 } from '../base/icons.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import { PersonaAvatar } from './PersonaAvatar.js'
import { compressAvatarFile, PersonaEditor } from './PersonaEditor.js'
import styles from './Persona.module.css'

/**
 * 欢迎页快捷选择：my-whale助手（点击立即配置微调）、用户自定义人设、无痕会话、小游戏。
 */
export const PersonaPicker = () => {
  const t = useTranslate()
  const locale = useSettings((state) => state.locale)
  const customPersonas = usePersonaStore((state) => state.personas)
  const draftPersonaId = useChatStore((state) => state.draftPersonaId)
  const draftAssistantOverride = useChatStore((state) => state.draftAssistantOverride)
  const draftIncognito = useChatStore((state) => state.draftIncognito)
  const [creating, setCreating] = useState(false)
  const [tuningWelcome, setTuningWelcome] = useState(false)

  const all = getAllPersonas(customPersonas, locale)
  const myWhaleBase = all.find((p) => p.id === MY_WHALE_ASSISTANT_ID)
  const selected = findPersona(draftPersonaId, customPersonas, locale)
  const showActiveBuiltin =
    selected.builtin && selected.id !== DEFAULT_PERSONA_ID && selected.id !== MY_WHALE_ASSISTANT_ID

  const [tuneName, setTuneName] = useState('')
  const [tuneAvatar, setTuneAvatar] = useState('')
  const [tuneInstructions, setTuneInstructions] = useState('')
  const avatarInputRef = useRef<HTMLInputElement>(null)

  const openWelcomeTuner = () => {
    if (!myWhaleBase) {
      return
    }
    setDraftPersona(myWhaleBase)
    setTuneName(draftAssistantOverride?.name || myWhaleBase.name)
    setTuneAvatar(draftAssistantOverride?.avatar || '')
    setTuneInstructions(draftAssistantOverride?.instructions || myWhaleBase.instructions)
    setTuningWelcome(true)
  }

  const handleAvatarUpload = async (file: File | undefined) => {
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

  const saveWelcomeTuner = () => {
    if (!myWhaleBase) {
      return
    }
    setDraftAssistantOverride({
      name: tuneName.trim() || myWhaleBase.name,
      avatar: tuneAvatar,
      instructions: tuneInstructions.trim() || myWhaleBase.instructions,
    })
    setTuningWelcome(false)
  }

  const renderCard = (persona: Persona) => {
    const active = selected.id === persona.id
    return (
      <button
        key={persona.id}
        type="button"
        className={clsx(styles.pickerCard, active && styles.pickerCardActive)}
        title={persona.description}
        onClick={() => setDraftPersona(persona)}
      >
        <PersonaAvatar
          avatar={persona.avatar}
          name={persona.name}
          isDefault={persona.id === DEFAULT_PERSONA_ID}
          size="s"
        />
        <span className={styles.pickerName}>{persona.name}</span>
      </button>
    )
  }

  const myWhaleDisplayName = draftAssistantOverride?.name.trim() || myWhaleBase?.name || ''
  const myWhaleDisplayAvatar = draftAssistantOverride?.avatar || ''

  return (
    <div className={styles.pickerWrap}>
      <div className={styles.pickerRow}>
        {myWhaleBase ? (
          <button
            type="button"
            className={clsx(
              styles.pickerCard,
              selected.id === MY_WHALE_ASSISTANT_ID && styles.pickerCardActive
            )}
            onClick={openWelcomeTuner}
          >
            <PersonaAvatar
              avatar={myWhaleDisplayAvatar}
              name={myWhaleDisplayName}
              isDefault={!myWhaleDisplayAvatar}
              size="s"
            />
            <span className={styles.pickerName}>{myWhaleDisplayName}</span>
          </button>
        ) : null}
        {showActiveBuiltin ? renderCard(selected) : null}
        {customPersonas.map(renderCard)}
        <button type="button" className={styles.pickerCard} onClick={() => setCreating(true)}>
          <span>+ {t('personaNew')}</span>
        </button>
        <button
          type="button"
          className={clsx(styles.pickerCard, draftIncognito && styles.pickerCardIncognito)}
          title={t('personaIncognitoDesc')}
          onClick={() => setDraftIncognito(!draftIncognito)}
        >
          <IconIncognitoOutline16 />
          <span>{t('personaIncognito')}</span>
        </button>
        <button
          type="button"
          className={styles.pickerCard}
          title={t('gameDrawerTitle')}
          onClick={openGameDrawer}
        >
          <IconGamepadOutline16 />
          <span>{t('miniGames')}</span>
        </button>
      </div>

      {tuningWelcome ? (
        <Modal
          title={myWhaleDisplayName}
          closable
          className={styles.sessionModal}
          mainClassName={styles.sessionModalMain}
          onClose={() => setTuningWelcome(false)}
          footer={
            <div className={styles.noteSaveRow}>
              <Button variant="outlined" size="m" onClick={() => setTuningWelcome(false)}>
                {t('cancel')}
              </Button>
              <Button variant="primary" size="m" onClick={saveWelcomeTuner}>
                {t('personaSave')}
              </Button>
            </div>
          }
        >
          <div className={styles.tuneBox}>
            <div className={styles.avatarRow}>
              <PersonaAvatar
                avatar={tuneAvatar}
                name={tuneName || myWhaleDisplayName}
                isDefault={!tuneAvatar}
                size="l"
              />
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={(event) => {
                  void handleAvatarUpload(event.target.files?.[0])
                  event.target.value = ''
                }}
              />
              <Button variant="outlined" size="s" onClick={() => avatarInputRef.current?.click()}>
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
          </div>
        </Modal>
      ) : null}

      {creating ? (
        <PersonaEditor
          initial={null}
          onClose={() => setCreating(false)}
          onSaved={(saved) => setDraftPersona(saved)}
        />
      ) : null}
    </div>
  )
}
