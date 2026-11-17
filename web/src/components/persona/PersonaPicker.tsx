import clsx from 'clsx'
import { useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { setDraftIncognito, setDraftPersona, useChatStore } from '../../services/chat/store.js'
import { DEFAULT_PERSONA_ID } from '../../services/persona/builtin.js'
import { findPersona, getAllPersonas, usePersonaStore } from '../../services/persona/store.js'
import type { Persona } from '../../services/persona/types.js'
import { useSettings } from '../../services/settings.js'
import { IconIncognitoOutline16 } from '../base/icons.js'
import { PersonaAvatar } from './PersonaAvatar.js'
import { PersonaEditor } from './PersonaEditor.js'
import styles from './Persona.module.css'

/**
 * 欢迎页仅展示用户自定义人设（内置人设仅在「设置 → 人设」中管理），无 Emoji 图标。
 */
export const PersonaPicker = () => {
  const t = useTranslate()
  const locale = useSettings((state) => state.locale)
  const customPersonas = usePersonaStore((state) => state.personas)
  const draftPersonaId = useChatStore((state) => state.draftPersonaId)
  const draftIncognito = useChatStore((state) => state.draftIncognito)
  const [creating, setCreating] = useState(false)

  const all = getAllPersonas(customPersonas, locale)
  const defaultAssistant = all.find((p) => p.id === DEFAULT_PERSONA_ID)
  const selected = findPersona(draftPersonaId, customPersonas, locale)

  // 仅展示：默认助手（当存在自定义人设或当前选中了非默认人设时） + 自定义人设
  // 若用户在设置中将某个内置人设设为默认，也显示该当前激活项以便感知
  const showActiveBuiltin = selected.builtin && selected.id !== DEFAULT_PERSONA_ID
  const showDefaultCard = customPersonas.length > 0 || showActiveBuiltin

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

  return (
    <div className={styles.pickerWrap}>
      <div className={styles.pickerRow}>
        {showDefaultCard && defaultAssistant ? renderCard(defaultAssistant) : null}
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
      </div>

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
