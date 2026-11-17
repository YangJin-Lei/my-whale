import clsx from 'clsx'
import { useTranslate } from '../../i18n/index.js'
import {
  formatBalanceSummary,
  formatBalanceValue,
  formatCompactBalance,
  refreshBalance,
  useBalance,
} from '../../services/balance.js'
import { openExternal, PLATFORM_TOP_UP_URL, PLATFORM_USAGE_URL } from '../../services/links.js'
import { useSettings } from '../../services/settings.js'
import { IconRefreshOutline16 } from '../base/icons.js'
import { TopUpLink } from './TopUpLink.js'
import styles from './BalanceBadge.module.css'

const formatClock = (timestamp: number | null): string => {
  if (!timestamp) {
    return ''
  }
  const date = new Date(timestamp)
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

export const BalanceBadge = ({ variant }: { variant: 'sider' | 'header' | 'settings' }) => {
  const t = useTranslate()
  const apiKey = useSettings((state) => state.apiKey)
  const { status, data, updatedAt } = useBalance()

  if (!apiKey) {
    return null
  }

  const summary = formatBalanceSummary(data)
  const compact = formatCompactBalance(data)
  const primary =
    data?.balance_infos.find((info) => info.currency === 'CNY') ?? data?.balance_infos[0]
  const timeText = formatClock(updatedAt)

  const tooltip = primary
    ? [
        t('balanceDetail', {
          granted: formatBalanceValue(primary, 'granted_balance'),
          toppedUp: formatBalanceValue(primary, 'topped_up_balance'),
        }),
        timeText ? t('balanceUpdatedAt', { time: timeText }) : '',
      ]
        .filter(Boolean)
        .join(' · ')
    : undefined

  if (variant === 'header') {
    const label =
      status === 'insufficient'
        ? t('balanceInsufficientShort')
        : status === 'loading'
          ? '...'
          : compact || '--'
    return (
      <button
        type="button"
        className={clsx(styles.headerBadge, status === 'insufficient' && styles.insufficient)}
        title={tooltip}
        onClick={() => {
          if (status === 'insufficient') {
            openExternal(PLATFORM_TOP_UP_URL)
          } else {
            void refreshBalance()
          }
        }}
      >
        {label}
      </button>
    )
  }

  if (variant === 'settings') {
    return (
      <div className={styles.settingsBox}>
        <div className={styles.settingsRow}>
          <span className={styles.settingsLabel}>{t('balanceLabel')}</span>
          <span
            className={clsx(
              styles.settingsValue,
              status === 'insufficient' && styles.insufficientText
            )}
          >
            {status === 'loading'
              ? t('balanceLoading')
              : status === 'error'
                ? t('balanceLoadFailed')
                : status === 'unauthorized'
                  ? t('apiKeyInvalid')
                  : summary || '--'}
          </span>
          <button
            type="button"
            className={styles.refreshBtn}
            aria-label={t('refreshBalance')}
            title={t('refreshBalance')}
            onClick={() => void refreshBalance()}
          >
            <IconRefreshOutline16 />
          </button>
          <button
            type="button"
            className={styles.topUpInline}
            onClick={() => openExternal(PLATFORM_TOP_UP_URL)}
          >
            {t('topUp')} ↗
          </button>
        </div>
        {tooltip ? <div className={styles.settingsHint}>{tooltip}</div> : null}
        <div className={styles.leakHintRow}>
          <span className={styles.settingsHint}>{t('balanceLeakHint')}</span>
          <button
            type="button"
            className={styles.topUpInline}
            onClick={() => openExternal(PLATFORM_USAGE_URL)}
          >
            {t('viewUsageLink')} ↗
          </button>
        </div>
        {status === 'insufficient' ? <TopUpLink className={styles.settingsTopUp} /> : null}
      </div>
    )
  }

  // sider
  return (
    <div className={styles.siderWrap}>
      <div
        className={clsx(styles.siderBadge, status === 'insufficient' && styles.insufficient)}
        title={tooltip}
      >
        <span className={styles.siderText}>
          {t('balanceLabel')}{' '}
          {status === 'loading'
            ? '...'
            : status === 'error'
              ? t('balanceLoadFailed')
              : status === 'unauthorized'
                ? '--'
                : summary || '--'}
        </span>
        <div className={styles.siderActions}>
          <button
            type="button"
            className={styles.usageMicroBtn}
            title={t('balanceLeakHint')}
            onClick={() => openExternal(PLATFORM_USAGE_URL)}
          >
            {t('viewUsageLink')} ↗
          </button>
          <button
            type="button"
            className={styles.refreshBtn}
            aria-label={t('refreshBalance')}
            title={t('refreshBalance')}
            onClick={() => void refreshBalance()}
          >
            <IconRefreshOutline16 />
          </button>
        </div>
      </div>
      {status === 'insufficient' ? <TopUpLink className={styles.siderTopUp} /> : null}
    </div>
  )
}
