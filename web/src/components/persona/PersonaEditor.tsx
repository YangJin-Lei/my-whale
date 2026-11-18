import { useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { startTrialChat } from '../../services/chat/store.js'
import { savePersona } from '../../services/persona/store.js'
import {
  AVATAR_MAX_BYTES,
  PERSONA_DESCRIPTION_MAX,
  PERSONA_GREETING_MAX,
  PERSONA_INSTRUCTIONS_MAX,
  PERSONA_NAME_MAX,
  type Persona,
} from '../../services/persona/types.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import { closeSettings } from '../settings/settingsDialogState.js'
import { PersonaAvatar } from './PersonaAvatar.js'
import styles from './Persona.module.css'

export const compressAvatarFile = (file: File): Promise<string | null> =>
  new Promise((resolve) => {
    const img = new Image()
    const objectUrl = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(objectUrl)
      const canvas = document.createElement('canvas')
      const maxDim = 128
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
      canvas.width = Math.max(1, Math.round(img.width * scale))
      canvas.height = Math.max(1, Math.round(img.height * scale))
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        resolve(null)
        return
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      for (const quality of [0.82, 0.65, 0.45]) {
        const dataUrl = canvas.toDataURL('image/webp', quality)
        if (dataUrl.length <= AVATAR_MAX_BYTES) {
          resolve(dataUrl)
          return
        }
      }
      resolve(null)
    }
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      resolve(null)
    }
    img.src = objectUrl
  })

export const PersonaEditor = ({
  initial,
  onClose,
  onSaved,
}: {
  initial?: Persona | null
  onClose: () => void
  onSaved?: (persona: Persona) => void
}) => {
  const t = useTranslate()
  const [avatar, setAvatar] = useState(
    initial?.avatar && initial.avatar.startsWith('data:image/') ? initial.avatar : ''
  )
  const [name, setName] = useState(initial?.name || '')
  const [description, setDescription] = useState(initial?.description || '')
  const [instructions, setInstructions] = useState(initial?.instructions || '')
  const [greeting, setGreeting] = useState(initial?.greeting || '')
  const [defaultThinking, setDefaultThinking] = useState(initial?.defaults?.thinking ?? false)
  const [defaultSearch, setDefaultSearch] = useState(initial?.defaults?.search ?? false)
  const [saving, setSaving] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const canSave = Boolean(name.trim() && instructions.trim()) && !saving

  const buildDraftPersona = (): Persona => ({
    id: initial?.id ?? 'trial-draft',
    name: name.trim() || t('personaNew'),
    avatar,
    description: description.trim(),
    instructions: instructions.trim(),
    greeting: greeting.trim() || undefined,
    defaults: { thinking: defaultThinking, search: defaultSearch },
    builtin: false,
    createdAt: initial?.createdAt ?? Date.now(),
    updatedAt: Date.now(),
  })

  const handleSave = async () => {
    if (!canSave) {
      return
    }
    setSaving(true)
    try {
      const saved = await savePersona(
        {
          name,
          avatar,
          description,
          instructions,
          greeting,
          defaults: { thinking: defaultThinking, search: defaultSearch },
        },
        initial?.builtin ? undefined : initial?.id
      )
      onSaved?.(saved)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={initial && !initial.builtin ? t('personaEdit') : t('personaNew')}
      closable
      className={styles.editorModal}
      mainClassName={styles.editorMain}
      onClose={onClose}
      footer={
        <div className={styles.editorFooter}>
          <Button
            variant="outlined"
            size="m"
            disabled={!instructions.trim()}
            onClick={() => {
              startTrialChat(buildDraftPersona())
              onClose()
              closeSettings()
            }}
          >
            {t('personaTrialChat')}
          </Button>
          <div className={styles.editorFooterRight}>
            <Button variant="outlined" size="m" onClick={onClose}>
              {t('cancel')}
            </Button>
            <Button
              variant="primary"
              size="m"
              disabled={!canSave}
              onClick={() => void handleSave()}
            >
              {t('personaSave')}
            </Button>
          </div>
        </div>
      }
    >
      <div className={styles.formRow}>
        <div className={styles.avatarField}>
          <label className={styles.fieldLabel}>{t('personaAvatar')}</label>
          <div className={styles.avatarPickRow}>
            <PersonaAvatar avatar={avatar} name={name || t('personaNew')} size="l" />
            <div className={styles.avatarButtons}>
              <button
                type="button"
                className={styles.uploadAvatarBtn}
                onClick={() => fileRef.current?.click()}
              >
                {t('personaUploadAvatar')}
              </button>
              {avatar ? (
                <button
                  type="button"
                  className={styles.uploadAvatarBtn}
                  onClick={() => setAvatar('')}
                >
                  {t('personaClearAvatar')}
                </button>
              ) : null}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                hidden
                onChange={async (event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  if (!file) {
                    return
                  }
                  const dataUrl = await compressAvatarFile(file)
                  if (dataUrl) {
                    setAvatar(dataUrl)
                  } else {
                    showToast({ key: 'personaAvatarTooLarge', type: 'error' })
                  }
                }}
              />
            </div>
          </div>
        </div>
      </div>

      <div className={styles.formField}>
        <div className={styles.fieldHeader}>
          <label className={styles.fieldLabel}>{t('personaName')}</label>
          <span className={styles.counter}>
            {name.length}/{PERSONA_NAME_MAX}
          </span>
        </div>
        <input
          className={styles.input}
          maxLength={PERSONA_NAME_MAX}
          placeholder={t('personaNamePlaceholder')}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>

      <div className={styles.formField}>
        <div className={styles.fieldHeader}>
          <label className={styles.fieldLabel}>{t('personaDescription')}</label>
          <span className={styles.counter}>
            {description.length}/{PERSONA_DESCRIPTION_MAX}
          </span>
        </div>
        <input
          className={styles.input}
          maxLength={PERSONA_DESCRIPTION_MAX}
          placeholder={t('personaDescriptionPlaceholder')}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </div>

      <div className={styles.formField}>
        <div className={styles.fieldHeader}>
          <label className={styles.fieldLabel}>{t('personaInstructions')}</label>
          <span className={styles.counter}>
            {instructions.length}/{PERSONA_INSTRUCTIONS_MAX}
          </span>
        </div>
        <textarea
          className={styles.textarea}
          rows={6}
          maxLength={PERSONA_INSTRUCTIONS_MAX}
          placeholder={t('personaInstructionsPlaceholder')}
          value={instructions}
          onChange={(event) => setInstructions(event.target.value)}
        />
      </div>

      <div className={styles.formField}>
        <div className={styles.fieldHeader}>
          <label className={styles.fieldLabel}>{t('personaGreeting')}</label>
          <span className={styles.counter}>
            {greeting.length}/{PERSONA_GREETING_MAX}
          </span>
        </div>
        <input
          className={styles.input}
          maxLength={PERSONA_GREETING_MAX}
          placeholder={t('personaGreetingPlaceholder')}
          value={greeting}
          onChange={(event) => setGreeting(event.target.value)}
        />
      </div>

      <div className={styles.defaultsRow}>
        <span className={styles.fieldLabel}>{t('personaDefaults')}</span>
        <label className={styles.checkboxLabel}>
          <input
            type="checkbox"
            checked={defaultThinking}
            onChange={(event) => setDefaultThinking(event.target.checked)}
          />
          {t('thinkingSwitch')}
        </label>
        <label className={styles.checkboxLabel}>
          <input
            type="checkbox"
            checked={defaultSearch}
            onChange={(event) => setDefaultSearch(event.target.checked)}
          />
          {t('search')}
        </label>
      </div>
    </Modal>
  )
}
