import logoUrl from '../../assets/logo.png'
import { useIsMobile } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import { useChatStore } from '../../services/chat/store.js'
import { findPersona, usePersonaStore } from '../../services/persona/store.js'
import { MY_WHALE_ASSISTANT_ID } from '../../services/persona/builtin.js'
import { useSettings } from '../../services/settings.js'
import { ChatInput } from '../chatInput/ChatInput.js'
import { PersonaAvatar } from '../persona/PersonaAvatar.js'
import { PersonaPicker } from '../persona/PersonaPicker.js'
import { MobileHeader } from './MobileHeader.js'
import styles from './Welcome.module.css'

/** 新对话：问候语/角色开场白 + 人设选择 + 输入框。桌面端居中；移动端输入框吸底 */
export const Welcome = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const locale = useSettings((state) => state.locale)
  const customPersonas = usePersonaStore((state) => state.personas)
  const draftPersonaId = useChatStore((state) => state.draftPersonaId)
  const draftAssistantOverride = useChatStore((state) => state.draftAssistantOverride)
  const basePersona = findPersona(draftPersonaId, customPersonas, locale)
  const persona =
    draftPersonaId === MY_WHALE_ASSISTANT_ID && draftAssistantOverride
      ? {
          ...basePersona,
          name: draftAssistantOverride.name.trim() || basePersona.name,
          avatar: draftAssistantOverride.avatar.trim(),
        }
      : basePersona

  return (
    <div className={styles.container}>
      {isMobile ? <MobileHeader /> : null}
      <div className={styles.welcome}>
        {persona.greeting ? (
          <div className={styles.personaGreeting}>
            <div className={styles.personaGreetingHeader}>
              <PersonaAvatar
                avatar={persona.avatar}
                name={persona.name}
                isDefault={persona.id === MY_WHALE_ASSISTANT_ID && !persona.avatar}
                size="m"
              />
              <span className={styles.personaGreetingName}>{persona.name}</span>
            </div>
            <div className={styles.personaGreetingBubble}>{persona.greeting}</div>
          </div>
        ) : (
          <div className={styles.greeting}>
            <img src={logoUrl} alt={t('appName')} className={styles.welcomeLogo} />
            <span>{t('welcomeMessageChat250808')}</span>
          </div>
        )}
        <PersonaPicker />
        <ChatInput sessionId={null} />
        {isMobile ? <div className={styles.caveat}>{t('contentCaveat')}</div> : null}
      </div>
    </div>
  )
}
