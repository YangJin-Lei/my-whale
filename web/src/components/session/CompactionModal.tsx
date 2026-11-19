import clsx from 'clsx'
import { useTranslate, type TranslationKey } from '../../i18n/index.js'
import { closeCompactionModal, useCompactionStore } from '../../services/chat/compaction.js'
import {
  abortSessionCompaction,
  clearSessionCompaction,
  compactSessionNow,
  getSessionCompactionStats,
  useChatStore,
} from '../../services/chat/store.js'
import type { CompactionLevel } from '../../services/chat/types.js'
import { setCompactionAuto, setCompactionLevel, useSettings } from '../../services/settings.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import styles from './CompactionModal.module.css'

const TIER_ITEMS: ReadonlyArray<{
  level: CompactionLevel
  titleKey: TranslationKey
  descKey: TranslationKey
}> = [
  { level: 'light', titleKey: 'compactionLevelLightTag', descKey: 'compactionLevelLightDesc' },
  { level: 'medium', titleKey: 'compactionLevelMediumTag', descKey: 'compactionLevelMediumDesc' },
  { level: 'heavy', titleKey: 'compactionLevelHeavyTag', descKey: 'compactionLevelHeavyDesc' },
]

export const CompactionModal = ({ sessionId }: { sessionId: string }) => {
  const t = useTranslate()
  const modalSessionId = useCompactionStore((s) => s.modalSessionId)
  const runningSessionId = useCompactionStore((s) => s.runningSessionId)
  const lastError = useCompactionStore((s) => s.lastError)
  const compactionAuto = useSettings((s) => s.compactionAuto)
  const compactionLevel = useSettings((s) => s.compactionLevel)
  const isStreaming = useChatStore((s) => Boolean(s.streaming[sessionId]))
  // 订阅 session 变化以便实时刷新统计数值
  const sessionUpdatedAt = useChatStore((s) => s.sessionCache[sessionId]?.updatedAt ?? 0)

  if (modalSessionId !== sessionId) {
    return null
  }

  const stats = getSessionCompactionStats(sessionId)
  const isRunning = runningSessionId === sessionId

  const handleRun = async () => {
    if (isRunning || isStreaming) {
      return
    }
    const ok = await compactSessionNow(sessionId, compactionLevel)
    if (ok) {
      showToast(t('compactionDoneToast'))
    } else if (!useCompactionStore.getState().lastError) {
      showToast(t('compactionNothingToCompact'))
    }
  }

  const handleReset = () => {
    if (isRunning || isStreaming) {
      return
    }
    clearSessionCompaction(sessionId)
    showToast(t('compactionResetDoneToast'))
  }

  return (
    <Modal
      title={t('compactionTitle')}
      closable
      className={styles.modal}
      onClose={closeCompactionModal}
      footer={
        <div className={styles.footerRow}>
          {stats.compactedRounds > 0 ? (
            <Button
              variant="outlined"
              size="m"
              disabled={isRunning || isStreaming}
              onClick={handleReset}
            >
              {t('compactionReset')}
            </Button>
          ) : null}
          {isRunning ? (
            <Button
              variant="dangerOutlined"
              size="m"
              onClick={() => abortSessionCompaction(sessionId)}
            >
              {t('compactionStop')}
            </Button>
          ) : (
            <Button
              variant="primary"
              size="m"
              disabled={isStreaming || stats.totalRounds < 2}
              onClick={() => void handleRun()}
            >
              {t('compactionRunNow')}
            </Button>
          )}
        </div>
      }
    >
      <div className={styles.body} data-updated={sessionUpdatedAt}>
        <div className={styles.statusBox}>
          <div className={styles.statusMain}>
            {t('compactionStatusLine', {
              tokens: stats.estimatedTokens,
              total: stats.totalRounds,
              compacted: stats.compactedRounds,
              retained: stats.retainedRounds,
            })}
          </div>
          <div>
            {stats.compactedRounds > 0
              ? t('compactionMemoryLine', {
                  segments: stats.segmentCount,
                  records: stats.recordCount,
                })
              : t('compactionNotCompacted')}
          </div>
        </div>

        <div className={styles.tiers}>
          {TIER_ITEMS.map((item) => (
            <button
              key={item.level}
              type="button"
              className={clsx(styles.tierCard, compactionLevel === item.level && styles.tierActive)}
              onClick={() => setCompactionLevel(item.level)}
            >
              <span className={styles.tierTitle}>{t(item.titleKey)}</span>
              <span className={styles.tierDesc}>{t(item.descKey)}</span>
            </button>
          ))}
        </div>

        <label className={styles.autoRow}>
          <span>{t('compactionAutoLabel')}</span>
          <input
            type="checkbox"
            checked={compactionAuto}
            onChange={(event) => setCompactionAuto(event.target.checked)}
          />
        </label>

        <div className={styles.noticeBox}>
          <div className={styles.noticeTitle}>{t('compactionNoticeTitle')}</div>
          <div>{t('compactionNoticeCost')}</div>
          <div>{t('compactionNoticeLight')}</div>
          <div>{t('compactionNoticeMedium')}</div>
          <div>{t('compactionNoticeHeavy')}</div>
        </div>

        {lastError ? <div className={styles.errorText}>{lastError}</div> : null}
      </div>
    </Modal>
  )
}
