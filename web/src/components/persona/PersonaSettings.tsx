import clsx from 'clsx'
import { useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { startChatWithPersona, startTrialChat } from '../../services/chat/store.js'
import { DEFAULT_PERSONA_ID } from '../../services/persona/builtin.js'
import {
  duplicatePersona,
  getAllPersonas,
  removePersona,
  usePersonaStore,
} from '../../services/persona/store.js'
import type { Persona } from '../../services/persona/types.js'
import { setDefaultPersonaId, useSettings } from '../../services/settings.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { closeSettings } from '../settings/settingsDialogState.js'
import { PersonaAvatar } from './PersonaAvatar.js'
import { PersonaEditor } from './PersonaEditor.js'
import styles from './Persona.module.css'

export const PersonaSettings = () => {
  const t = useTranslate()
  const locale = useSettings((state) => state.locale)
  const defaultPersonaId = useSettings((state) => state.defaultPersonaId)
  const customPersonas = usePersonaStore((state) => state.personas)
  const allPersonas = getAllPersonas(customPersonas, locale)

  const [editing, setEditing] = useState<Persona | null | undefined>(undefined)
  const [deleting, setDeleting] = useState<Persona | null>(null)

  return (
    <div className={styles.settingsWrap}>
      <div className={styles.settingsHeader}>
        <span className={styles.privacyTip}>{t('personaPrivacyTip')}</span>
        <Button variant="primary" size="s" onClick={() => setEditing(null)}>
          + {t('personaNew')}
        </Button>
      </div>

      <div className={styles.personaList}>
        {allPersonas.map((persona) => {
          const isDefault = persona.id === defaultPersonaId
          return (
            <div key={persona.id} className={styles.personaRow}>
              <PersonaAvatar
                avatar={persona.avatar}
                name={persona.name}
                isDefault={persona.id === DEFAULT_PERSONA_ID}
                size="m"
              />
              <div className={styles.personaInfo}>
                <div className={styles.personaNameLine}>
                  <span className={styles.personaNameText}>{persona.name}</span>
                  {persona.builtin ? (
                    <span className={styles.tag}>{t('personaBuiltin')}</span>
                  ) : null}
                  {isDefault ? (
                    <span className={clsx(styles.tag, styles.tagActive)}>
                      {t('personaDefault')}
                    </span>
                  ) : null}
                </div>
                <div className={styles.personaDesc}>{persona.description}</div>
              </div>
              <div className={styles.personaActions}>
                <button
                  type="button"
                  className={styles.linkBtn}
                  onClick={() => {
                    startChatWithPersona(persona)
                    closeSettings()
                  }}
                >
                  {t('personaStartChat')}
                </button>
                {persona.id !== DEFAULT_PERSONA_ID ? (
                  <button
                    type="button"
                    className={styles.linkBtn}
                    onClick={() => {
                      startTrialChat(persona)
                      closeSettings()
                    }}
                  >
                    {t('personaTrialChat')}
                  </button>
                ) : null}
                {!isDefault ? (
                  <button
                    type="button"
                    className={styles.linkBtn}
                    onClick={() => setDefaultPersonaId(persona.id)}
                  >
                    {t('personaSetDefault')}
                  </button>
                ) : null}
                {persona.builtin ? (
                  <button
                    type="button"
                    className={styles.linkBtn}
                    onClick={() => void duplicatePersona(persona, t('personaDuplicateSuffix'))}
                  >
                    {t('personaDuplicate')}
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      className={styles.linkBtn}
                      onClick={() => setEditing(persona)}
                    >
                      {t('editMessage')}
                    </button>
                    <button
                      type="button"
                      className={clsx(styles.linkBtn, styles.dangerText)}
                      onClick={() => setDeleting(persona)}
                    >
                      {t('delete')}
                    </button>
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {editing !== undefined ? (
        <PersonaEditor initial={editing} onClose={() => setEditing(undefined)} />
      ) : null}

      {deleting ? (
        <Modal
          title={t('personaDeleteConfirmTitle', { name: deleting.name })}
          onClose={() => setDeleting(null)}
          footer={
            <>
              <Button variant="outlined" size="m" onClick={() => setDeleting(null)}>
                {t('cancel')}
              </Button>
              <Button
                variant="danger"
                size="m"
                onClick={() => {
                  const id = deleting.id
                  setDeleting(null)
                  void removePersona(id)
                }}
              >
                {t('delete')}
              </Button>
            </>
          }
        >
          {t('personaDeleteConfirmDesc')}
        </Modal>
      ) : null}
    </div>
  )
}
