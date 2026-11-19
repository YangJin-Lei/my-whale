import clsx from 'clsx'
import { useIsMobile } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import { openCompactionModal } from '../../services/chat/compaction.js'
import { getSessionCompactionStats } from '../../services/chat/store.js'
import type { CompactionLevel, Session } from '../../services/chat/types.js'
import { useSettings } from '../../services/settings.js'
import { ChatInput } from '../chatInput/ChatInput.js'
import { IconGamepadOutline16 } from '../base/icons.js'
import { openGameDrawer } from '../../game/store.js'
import { MessageList } from '../messages/MessageList.js'
import { SessionPersonaMenu } from '../persona/SessionPersonaMenu.js'
import { CompactionModal } from './CompactionModal.js'
import { MobileHeader } from './MobileHeader.js'
import styles from './SessionView.module.css'

const LEVEL_KEY_MAP = {
  light: 'compactionLevelLight',
  medium: 'compactionLevelMedium',
  heavy: 'compactionLevelHeavy',
} as const satisfies Record<CompactionLevel, string>

/** 会话页：标题栏（移动端为顶栏）+ 消息列表，输入框吸底 */
export const SessionView = ({
  session,
  streaming,
  siderCollapsed,
}: {
  session: Session
  streaming: boolean
  siderCollapsed: boolean
}) => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const compactionLevel = useSettings((s) => s.compactionLevel)
  const compactionEnabled = useSettings((s) => s.compactionEnabled)
  const title = session.title || t('untitledChat')
  const stats = getSessionCompactionStats(session.id)
  const activeTierLabel = t(LEVEL_KEY_MAP[stats.activeLevel ?? compactionLevel])
  return (
    <div className={styles.view}>
      {isMobile ? (
        <>
          <MobileHeader title={title} />
          <div className={styles.mobilePersonaBar}>
            <SessionPersonaMenu session={session} streaming={streaming} />
          </div>
        </>
      ) : (
        <div className={styles.header}>
          <div className={clsx(styles.title, siderCollapsed && styles.withCollapsedSider)}>
            {title}
          </div>
          <SessionPersonaMenu session={session} streaming={streaming} />
          <button type="button" className={styles.gameBtn} onClick={openGameDrawer}>
            <IconGamepadOutline16 />
            <span>{t('miniGames')}</span>
          </button>
        </div>
      )}
      <MessageList
        session={session}
        streaming={streaming}
        footer={
          <div className={styles.inputContainer}>
            <ChatInput sessionId={session.id} />
            <div className={styles.caveat}>
              <span>{t('contentCaveat')}</span>
              {compactionEnabled ? (
                <>
                  <span className={styles.caveatSep} aria-hidden="true">
                    ·
                  </span>
                  <button
                    type="button"
                    className={styles.compactTrigger}
                    onClick={() => openCompactionModal(session.id)}
                  >
                    {stats.compactedRounds > 0
                      ? t('compactionInlineActive', {
                          count: stats.compactedRounds,
                          level: activeTierLabel,
                        })
                      : t('compactionInlineIdle', { level: activeTierLabel })}
                  </button>
                </>
              ) : null}
            </div>
          </div>
        }
      />
      <CompactionModal sessionId={session.id} />
    </div>
  )
}
