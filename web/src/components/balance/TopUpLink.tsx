import clsx from 'clsx'
import { useTranslate } from '../../i18n/index.js'
import { openExternal, PLATFORM_TOP_UP_URL } from '../../services/links.js'
import styles from './BalanceBadge.module.css'

export const TopUpLink = ({ className }: { className?: string }) => {
  const t = useTranslate()
  return (
    <button
      type="button"
      className={clsx(styles.topUpLink, className)}
      onClick={() => openExternal(PLATFORM_TOP_UP_URL)}
    >
      {t('noBalanceCta')} ↗
    </button>
  )
}
