import { Capacitor } from '@capacitor/core'
import { useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { exportBlobFile } from '../../services/fileExport.js'
import {
  exportFullBackup,
  FullBackupError,
  inspectFullBackup,
  restoreFullBackup,
  type FullBackupInspection,
  type FullBackupProgress,
} from '../../services/fullBackup.js'
import { getSecureStorageBackendName } from '../../services/secureStorage.js'
import { Button } from '../base/Button.js'
import { IconDownloadOutline16, IconUploadOutline14 } from '../base/icons.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import styles from './Settings.module.css'

export const FullBackupSection = ({ disabled }: { disabled?: boolean }) => {
  const t = useTranslate()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [exportPassword, setExportPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<FullBackupProgress | null>(null)
  const [inspection, setInspection] = useState<{
    file: File
    info: FullBackupInspection
  } | null>(null)
  const [restoreMode, setRestoreMode] = useState<'merge' | 'replace'>('merge')
  const [restorePassword, setRestorePassword] = useState('')
  const [skipSecrets, setSkipSecrets] = useState(false)
  const [restoreError, setRestoreError] = useState<string | null>(null)

  const currentOrigin = typeof window !== 'undefined' ? window.location.origin : ''
  const backendName = getSecureStorageBackendName()

  const handleRunExport = async () => {
    if (busy) {
      return
    }
    setBusy(true)
    try {
      const result = await exportFullBackup({
        password: exportPassword,
        onProgress: setProgress,
      })
      await exportBlobFile(result.name, result.blob)
      setExportOpen(false)
      setExportPassword('')
      showToast(t('fullBackupExportSuccess'))
    } catch (err) {
      showToast({
        type: 'error',
        key: 'historyExportFailed',
        params: { message: err instanceof Error ? err.message : String(err) },
      })
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  const handlePickRestoreFile = async (file: File) => {
    setBusy(true)
    setRestoreError(null)
    try {
      const info = await inspectFullBackup(file)
      setInspection({ file, info })
      setRestoreMode('merge')
      setRestorePassword('')
      setSkipSecrets(false)
    } catch {
      showToast({ key: 'fullBackupCorrupted', type: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const handleConfirmRestore = async () => {
    if (!inspection || busy) {
      return
    }
    setBusy(true)
    setRestoreError(null)
    try {
      const res = await restoreFullBackup(inspection.file, {
        mode: restoreMode,
        password: restorePassword,
        skipSecrets,
        onProgress: setProgress,
      })
      setInspection(null)
      setRestorePassword('')
      showToast(
        t('fullBackupRestoreSuccess', {
          sessions: res.sessionsCount,
          attachments: res.attachmentsCount,
        })
      )
    } catch (err) {
      if (err instanceof FullBackupError && err.code === 'wrongPassword') {
        setRestoreError(t('fullBackupWrongPassword'))
      } else if (err instanceof FullBackupError && err.code === 'passwordRequired') {
        setRestoreError(t('fullBackupPasswordRequired'))
      } else {
        setRestoreError(t('fullBackupCorrupted'))
      }
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  return (
    <>
      <div className={styles.cellCard}>
        <div className={styles.row}>
          <div className={styles.text}>
            <div className={styles.label}>{t('fullBackupSectionTitle')}</div>
            <div className={styles.exportGuide}>
              {t('fullBackupSecurityLine', {
                origin: currentOrigin || 'localhost',
                backend: backendName,
              })}
            </div>
          </div>
          <div className={styles.bgActions}>
            <Button
              variant="outlined"
              size="s"
              className={styles.bgActionBtn}
              disabled={disabled || busy}
              onClick={() => setExportOpen(true)}
            >
              <IconDownloadOutline16 />
              {t('fullBackupExportBtn')}
            </Button>
            <Button
              variant="outlined"
              size="s"
              className={styles.bgActionBtn}
              disabled={disabled || busy}
              onClick={() => fileInputRef.current?.click()}
            >
              <IconUploadOutline14 />
              {t('fullBackupRestoreBtn')}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept={Capacitor.isNativePlatform() ? '*/*' : '.zip,application/zip'}
              hidden
              onChange={(event) => {
                const f = event.target.files?.[0]
                event.target.value = ''
                if (f) {
                  void handlePickRestoreFile(f)
                }
              }}
            />
          </div>
        </div>
      </div>

      {exportOpen ? (
        <Modal
          title={t('fullBackupExportTitle')}
          closable
          className={styles.importConfirm}
          onClose={() => {
            if (!busy) {
              setExportOpen(false)
            }
          }}
          footer={
            <>
              <Button
                variant="outlined"
                size="m"
                disabled={busy}
                onClick={() => setExportOpen(false)}
              >
                {t('cancel')}
              </Button>
              <Button
                variant="primary"
                size="m"
                disabled={busy}
                onClick={() => void handleRunExport()}
              >
                {busy && progress
                  ? `${progress.current}/${progress.total}`
                  : t('fullBackupExportConfirm')}
              </Button>
            </>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
            <label style={{ fontWeight: 500 }}>{t('fullBackupExportPasswordLabel')}</label>
            <input
              type="password"
              className={styles.mirrorInput}
              style={{ width: '100%' }}
              value={exportPassword}
              placeholder={t('fullBackupExportPasswordPlaceholder')}
              onChange={(e) => setExportPassword(e.target.value)}
            />
            {!exportPassword.trim() ? (
              <div style={{ fontSize: 12, opacity: 0.8 }}>{t('fullBackupExportNoPwWarn')}</div>
            ) : null}
          </div>
        </Modal>
      ) : null}

      {inspection ? (
        <Modal
          title={t('fullBackupRestoreTitle')}
          closable
          className={styles.importConfirm}
          onClose={() => {
            if (!busy) {
              setInspection(null)
            }
          }}
          footer={
            <>
              <Button
                variant="outlined"
                size="m"
                disabled={busy}
                onClick={() => setInspection(null)}
              >
                {t('cancel')}
              </Button>
              <Button
                variant={restoreMode === 'replace' ? 'dangerOutlined' : 'primary'}
                size="m"
                disabled={busy}
                onClick={() => void handleConfirmRestore()}
              >
                {busy && progress
                  ? `${progress.current}/${progress.total}`
                  : t('fullBackupRestoreConfirm')}
              </Button>
            </>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
            <div style={{ fontWeight: 500 }}>
              {t('fullBackupInspectSummary', {
                appVersion: inspection.info.manifest.appVersion,
                sessions: inspection.info.manifest.stats.sessions,
                attachments: inspection.info.manifest.stats.attachments,
                personas: inspection.info.manifest.stats.personas,
                memories: inspection.info.manifest.stats.memories,
              })}
            </div>
            {inspection.info.originChanged ? (
              <div style={{ fontSize: 12, color: 'var(--dsw-alias-brand-primary)' }}>
                {t('fullBackupOriginNotice', {
                  from: inspection.info.manifest.origin,
                  to: inspection.info.currentOrigin,
                })}
              </div>
            ) : null}
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="radio"
                checked={restoreMode === 'merge'}
                onChange={() => setRestoreMode('merge')}
              />
              <span>{t('fullBackupModeMerge')}</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="radio"
                checked={restoreMode === 'replace'}
                onChange={() => setRestoreMode('replace')}
              />
              <span>{t('fullBackupModeReplace')}</span>
            </label>
            {inspection.info.hasEncryptedSecrets ? (
              <>
                <label style={{ fontWeight: 500 }}>{t('fullBackupPasswordLabel')}</label>
                <input
                  type="password"
                  className={styles.mirrorInput}
                  style={{ width: '100%' }}
                  disabled={skipSecrets}
                  value={restorePassword}
                  placeholder={t('fullBackupPasswordPlaceholder')}
                  onChange={(e) => {
                    setRestorePassword(e.target.value)
                    setRestoreError(null)
                  }}
                />
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                  <input
                    type="checkbox"
                    checked={skipSecrets}
                    onChange={(e) => {
                      setSkipSecrets(e.target.checked)
                      setRestoreError(null)
                    }}
                  />
                  <span>{t('fullBackupSkipSecrets')}</span>
                </label>
              </>
            ) : null}
            {restoreError ? (
              <div className={styles.error} style={{ fontSize: 12 }}>
                {restoreError}
              </div>
            ) : null}
          </div>
        </Modal>
      ) : null}
    </>
  )
}
