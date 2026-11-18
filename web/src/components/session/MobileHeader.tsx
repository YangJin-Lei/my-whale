import { IconGamepadOutline16, IconMenuOutline20, IconNewChatOutline20 } from '../base/icons.js'
import { useTranslate } from '../../i18n/index.js'
import { openGameDrawer } from '../../game/store.js'
import { newChat } from '../../services/chat/store.js'
import { BalanceBadge } from '../balance/BalanceBadge.js'
import { IconButton } from '../base/IconButton.js'
import { openMobileSider } from '../sider/mobileSiderState.js'
import styles from './MobileHeader.module.css'

/** 移动端顶栏：左侧菜单打开侧边栏；会话页再显示标题与开启新对话；右侧显示紧凑余额 */
export const MobileHeader = ({ title }: { title?: string }) => {
  const t = useTranslate()
  return (
    <div className={styles.header}>
      <IconButton
        size="xl"
        tone="primary"
        icon={<IconMenuOutline20 />}
        aria-label={t('expandSiderbarButton')}
        onClick={openMobileSider}
      />
      {title === undefined ? (
        <div className={styles.spacer} />
      ) : (
        <div className={styles.title}>{title}</div>
      )}
      <BalanceBadge variant="header" />
      <IconButton
        size="xl"
        tone="primary"
        icon={<IconGamepadOutline16 />}
        aria-label={t('miniGames')}
        onClick={openGameDrawer}
      />
      {title === undefined ? null : (
        <IconButton
          size="xl"
          tone="primary"
          icon={<IconNewChatOutline20 />}
          aria-label={t('newChat')}
          onClick={newChat}
        />
      )}
    </div>
  )
}
