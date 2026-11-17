import { useTranslate } from '../../i18n/index.js'
import {
  dismissMemoryToast,
  undoMemoryToastBatch,
  useMemoryToast,
} from '../../services/memory/extract.js'
import { setMemoryNoticeShown } from '../../services/settings.js'
import { openSettings } from '../settings/settingsDialogState.js'
import styles from './Memory.module.css'

export const MemoryToast = () => {
  const t = useTranslate()
  const batch = useMemoryToast((state) => state.batch)

  if (!batch) {
    return null
  }

  const close = () => {
    if (batch.showCostNotice) {
      setMemoryNoticeShown(true)
    }
    dismissMemoryToast()
  }

  return (
    <div className={styles.memoryToastWrap} role="status" aria-live="polite">
      <div className={styles.memoryToastCard}>
        <div className={styles.memoryToastMain}>
          <span>{t('memoryAutoSavedToast', { count: batch.count })}</span>
          <div className={styles.memoryToastActions}>
            <button
              type="button"
              className={styles.linkBtn}
              onClick={() => {
                close()
                openSettings('memory')
              }}
            >
              {t('memoryToastView')}
            </button>
            <button
              type="button"
              className={styles.linkBtn}
              onClick={() => {
                if (batch.showCostNotice) {
                  setMemoryNoticeShown(true)
                }
                void undoMemoryToastBatch()
              }}
            >
              {t('memoryUndo')}
            </button>
            <button type="button" className={styles.toastCloseBtn} onClick={close}>
              {t('close')}
            </button>
          </div>
        </div>
        {batch.showCostNotice ? (
          <div className={styles.costNotice}>
            <span>{t('memoryFirstNotice')}</span>
            <div className={styles.costNoticeActions}>
              <button type="button" className={styles.linkBtn} onClick={close}>
                {t('memoryFirstNoticeAck')}
              </button>
              <button
                type="button"
                className={styles.linkBtn}
                onClick={() => {
                  close()
                  openSettings('memory')
                }}
              >
                {t('memoryFirstNoticeSettings')}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
