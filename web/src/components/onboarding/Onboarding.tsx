import clsx from 'clsx'
import { Capacitor } from '@capacitor/core'
import { useCallback, useEffect, useRef, useState } from 'react'
import logoUrl from '../../assets/logo.png'
import { useTranslate } from '../../i18n/index.js'
import { formatBalanceSummary, refreshBalance, useBalance } from '../../services/balance.js'
import { BackupError, exportHistory, importHistory } from '../../services/chat/backup.js'
import { useChatStore } from '../../services/chat/store.js'
import { extractApiKey, readClipboardApiKey, readClipboardText } from '../../services/clipboard.js'
import { exportBlobFile } from '../../services/fileExport.js'
import {
  openExternal,
  PLATFORM_API_KEYS_URL,
  PLATFORM_TOP_UP_URL,
  PLATFORM_USAGE_URL,
} from '../../services/links.js'
import { ApiError, verifyCustomApi } from '../../services/api/client.js'
import {
  setApiKey,
  setApiProvider,
  setCustomApiConfig,
  useSettings,
  type CustomApiProtocol,
} from '../../services/settings.js'
import { Button } from '../base/Button.js'
import { IconDownloadOutline16, IconUploadOutline14 } from '../base/icons.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import { useApiKeyForm } from '../settings/useApiKeyForm.js'
import {
  clearOnboardingSkipped,
  closeOnboarding,
  markOnboardingSkipped,
  useOnboarding,
} from './onboardingState.js'
import styles from './Onboarding.module.css'

export const Onboarding = () => {
  const open = useOnboarding((state) => state.open)
  return open ? <OnboardingContent /> : null
}

const OnboardingContent = () => {
  const t = useTranslate()
  const apiKey = useSettings((state) => state.apiKey)
  const apiProvider = useSettings((state) => state.apiProvider)
  const customApiUrl = useSettings((state) => state.customApiUrl)
  const customApiKey = useSettings((state) => state.customApiKey)
  const customApiModel = useSettings((state) => state.customApiModel)
  const customApiProtocol = useSettings((state) => state.customApiProtocol)
  const sessionsCount = useChatStore((state) => state.sessions.length)
  const importingHistory = useChatStore((state) => state.importingHistory)
  const balance = useBalance()

  const [providerTab, setProviderTab] = useState<'official' | 'custom'>(apiProvider)
  const [urlDraft, setUrlDraft] = useState(customApiUrl)
  const [customKeyDraft, setCustomKeyDraft] = useState('')
  const [modelDraft, setModelDraft] = useState(customApiModel)
  const [protocolDraft, setProtocolDraft] = useState<CustomApiProtocol>(customApiProtocol)
  const [customVerifying, setCustomVerifying] = useState(false)
  const [customError, setCustomError] = useState<string | null>(null)

  const [awaitingKey, setAwaitingKey] = useState(false)
  const [detected, setDetected] = useState(false)
  const [clipboardFailed, setClipboardFailed] = useState(false)

  const [historyBusy, setHistoryBusy] = useState(false)
  const [pendingImportFile, setPendingImportFile] = useState<File | null>(null)
  const [historyStatus, setHistoryStatus] = useState<{ text: string; error?: boolean } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const form = useApiKeyForm(() => {
    setAwaitingKey(false)
    setDetected(false)
    clearOnboardingSkipped()
    void refreshBalance()
  })

  const handleDismiss = () => {
    markOnboardingSkipped()
    closeOnboarding()
  }

  const handleCustomSubmit = async () => {
    const url = urlDraft.trim().replace(/\/+$/, '')
    const model = modelDraft.trim()
    const key = customKeyDraft.trim() || customApiKey?.trim() || ''
    if (!url || !key || !model) {
      setCustomError(t('customApiMissingFields'))
      return
    }
    setCustomVerifying(true)
    setCustomError(null)
    try {
      await verifyCustomApi({ url, apiKey: key, model, protocol: protocolDraft })
      setCustomApiConfig({ url, apiKey: key, model, protocol: protocolDraft })
      setApiProvider('custom')
      clearOnboardingSkipped()
      closeOnboarding()
      showToast({ key: 'customApiSavedToast' })
    } catch (error) {
      setCustomError(
        error instanceof ApiError && error.localMessage
          ? t(error.localMessage.key, error.localMessage.params)
          : error instanceof Error
            ? error.message
            : String(error)
      )
    } finally {
      setCustomVerifying(false)
    }
  }

  const tryAutoDetectClipboard = useCallback(async () => {
    if (!awaitingKey || apiKey) {
      return
    }
    const key = await readClipboardApiKey()
    if (key) {
      form.setValue(key)
      setDetected(true)
      setClipboardFailed(false)
    }
  }, [awaitingKey, apiKey, form])

  useEffect(() => {
    if (!awaitingKey || apiKey) {
      return
    }
    const onFocus = () => {
      void tryAutoDetectClipboard()
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void tryAutoDetectClipboard()
      }
    }
    const onNativeKey = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail
      if (detail && !apiKey) {
        form.setValue(detail)
        setDetected(true)
        setClipboardFailed(false)
      }
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('mywhale:clipboard-key', onNativeKey)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('mywhale:clipboard-key', onNativeKey)
    }
  }, [awaitingKey, apiKey, tryAutoDetectClipboard, form])

  const handlePaste = async () => {
    setClipboardFailed(false)
    const text = await readClipboardText()
    if (text === null) {
      setClipboardFailed(true)
      return
    }
    const trimmed = text.trim()
    if (!trimmed) {
      return
    }
    form.setValue(trimmed)
    setDetected(Boolean(extractApiKey(trimmed)))
  }

  const runImport = async (file: File) => {
    setHistoryBusy(true)
    setHistoryStatus(null)
    try {
      const count = await importHistory(file)
      const key = count === 1 ? 'historyImportedOne' : 'historyImported'
      const params = { count }
      setHistoryStatus({ text: t(key, params) })
      showToast({ key, params })
    } catch {
      setHistoryStatus({ text: t('historyImportFailed'), error: true })
      showToast({ key: 'historyImportFailed', type: 'error' })
    } finally {
      setHistoryBusy(false)
    }
  }

  const handleSelectImport = (file: File) => {
    if (sessionsCount > 0) {
      setPendingImportFile(file)
    } else {
      void runImport(file)
    }
  }

  const handleExport = async () => {
    setHistoryBusy(true)
    setHistoryStatus(null)
    try {
      const { name, blob } = await exportHistory()
      await exportBlobFile(name, blob)
    } catch (error) {
      const msg =
        error instanceof BackupError
          ? t(error.key)
          : error instanceof Error
            ? error.message
            : String(error)
      setHistoryStatus({ text: t('historyExportFailed', { message: msg }), error: true })
    } finally {
      setHistoryBusy(false)
    }
  }

  return (
    <>
      <Modal
        title={
          <div className={styles.titleRow}>
            <img src={logoUrl} alt={t('appName')} className={styles.logoImg} />
            <span>{t('onboardingTitle')}</span>
          </div>
        }
        closable
        className={styles.modal}
        mainClassName={styles.main}
        onClose={handleDismiss}
      >
        <p className={styles.desc}>{t('onboardingDesc')}</p>

        <div className={styles.providerTabs}>
          <button
            type="button"
            className={clsx(
              styles.providerTab,
              providerTab === 'official' && styles.providerTabActive
            )}
            onClick={() => setProviderTab('official')}
          >
            {t('apiProviderOfficial')}
          </button>
          <button
            type="button"
            className={clsx(
              styles.providerTab,
              providerTab === 'custom' && styles.providerTabActive
            )}
            onClick={() => setProviderTab('custom')}
          >
            {t('apiProviderCustom')}
          </button>
        </div>

        {providerTab === 'custom' ? (
          <div className={styles.customBox}>
            <div className={styles.customField}>
              <span className={styles.customLabel}>{t('customApiProtocol')}</span>
              <div className={styles.protocolRow}>
                <button
                  type="button"
                  className={clsx(
                    styles.protocolChip,
                    protocolDraft === 'openai' && styles.protocolChipActive
                  )}
                  onClick={() => setProtocolDraft('openai')}
                >
                  {t('customApiProtocolOpenAi')}
                </button>
                <button
                  type="button"
                  className={clsx(
                    styles.protocolChip,
                    protocolDraft === 'anthropic' && styles.protocolChipActive
                  )}
                  onClick={() => setProtocolDraft('anthropic')}
                >
                  {t('customApiProtocolAnthropic')}
                </button>
              </div>
            </div>
            <div className={styles.customField}>
              <label className={styles.customLabel} htmlFor="onboarding-custom-url">
                {t('customApiUrlLabel')}
              </label>
              <input
                id="onboarding-custom-url"
                type="url"
                className={styles.input}
                placeholder={t('customApiUrlPlaceholder')}
                value={urlDraft}
                onChange={(e) => setUrlDraft(e.target.value)}
              />
            </div>
            <div className={styles.customField}>
              <label className={styles.customLabel} htmlFor="onboarding-custom-key">
                {t('customApiKeyLabel')}
              </label>
              <input
                id="onboarding-custom-key"
                type="password"
                className={styles.input}
                placeholder={
                  customApiKey ? t('customApiKeySavedPlaceholder') : t('customApiKeyPlaceholder')
                }
                value={customKeyDraft}
                onChange={(e) => setCustomKeyDraft(e.target.value)}
              />
            </div>
            <div className={styles.customField}>
              <label className={styles.customLabel} htmlFor="onboarding-custom-model">
                {t('customApiModelLabel')}
              </label>
              <input
                id="onboarding-custom-model"
                type="text"
                className={styles.input}
                placeholder={t('customApiModelPlaceholder')}
                value={modelDraft}
                onChange={(e) => setModelDraft(e.target.value)}
              />
            </div>
            {customError ? <div className={styles.error}>{customError}</div> : null}
            <Button
              variant="primary"
              size="l"
              block
              disabled={customVerifying}
              onClick={() => void handleCustomSubmit()}
            >
              {customVerifying ? t('apiKeyVerifying') : t('customApiSaveAndUse')}
            </Button>
          </div>
        ) : !apiKey ? (
          <div className={styles.steps}>
            <div className={styles.step}>
              <span className={styles.stepNum}>1</span>
              <div className={styles.stepBody}>
                <Button
                  variant="primary"
                  size="m"
                  block
                  onClick={() => {
                    setAwaitingKey(true)
                    openExternal(PLATFORM_API_KEYS_URL)
                  }}
                >
                  {t('noApiKeyCta')}
                </Button>
                <div className={styles.hint}>{t('noApiKeyHint')}</div>
              </div>
            </div>

            <div className={styles.step}>
              <span className={styles.stepNum}>2</span>
              <div className={styles.stepBody}>
                <div className={styles.stepText}>{t('onboardingStep2')}</div>
              </div>
            </div>

            <div className={styles.step}>
              <span className={styles.stepNum}>3</span>
              <div className={styles.stepBody}>
                <div className={styles.stepText}>{t('onboardingStep3')}</div>
                <div className={styles.inputRow}>
                  <input
                    type="password"
                    className={styles.input}
                    placeholder={t('apiKeyPlaceholder')}
                    autoComplete="off"
                    spellCheck={false}
                    value={form.value}
                    onChange={(event) => {
                      form.setValue(event.target.value)
                      setDetected(false)
                      setClipboardFailed(false)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                        void form.submit()
                      }
                    }}
                  />
                  <Button variant="outlined" size="m" onClick={() => void handlePaste()}>
                    {t('pasteFromClipboard')}
                  </Button>
                  <Button
                    variant="primary"
                    size="m"
                    disabled={!form.value.trim() || form.verifying}
                    onClick={() => void form.submit()}
                  >
                    {form.verifying ? t('apiKeyVerifying') : t('confirm')}
                  </Button>
                </div>
                {detected ? (
                  <div className={styles.detected}>{t('clipboardKeyDetected')}</div>
                ) : null}
                {clipboardFailed ? (
                  <div className={styles.hint}>{t('clipboardReadFailed')}</div>
                ) : null}
                {form.error ? <div className={styles.error}>{form.error}</div> : null}
              </div>
            </div>
          </div>
        ) : (
          <div className={styles.verifiedBox}>
            <div className={styles.savedRow}>
              <span className={styles.savedLabel}>{t('apiKeyVerified')}</span>
              <button
                type="button"
                className={styles.changeKeyBtn}
                onClick={() => {
                  setApiKey(null)
                }}
              >
                {t('changeApiKey')}
              </button>
            </div>

            <div
              className={clsx(
                styles.balanceCard,
                balance.status === 'insufficient' && styles.balanceInsufficient
              )}
            >
              <div className={styles.balanceHeader}>
                <span>{t('balanceLabel')}</span>
                <span className={styles.balanceAmount}>
                  {balance.status === 'loading' || balance.status === 'idle'
                    ? t('balanceLoading')
                    : balance.status === 'error'
                      ? t('balanceLoadFailed')
                      : balance.status === 'unauthorized'
                        ? t('apiKeyInvalid')
                        : formatBalanceSummary(balance.data) || '--'}
                </span>
              </div>

              {balance.status === 'insufficient' ? (
                <div className={styles.insufficientActions}>
                  <div className={styles.error}>{t('balanceInsufficient')}</div>
                  <Button
                    variant="primary"
                    size="m"
                    block
                    onClick={() => openExternal(PLATFORM_TOP_UP_URL)}
                  >
                    {t('noBalanceCta')}
                  </Button>
                </div>
              ) : null}

              {balance.status === 'error' ? (
                <div className={styles.retryRow}>
                  <Button variant="outlined" size="s" onClick={() => void refreshBalance()}>
                    {t('retry')}
                  </Button>
                </div>
              ) : null}

              <div className={styles.usageHintRow}>
                <span className={styles.hint}>{t('balanceLeakHint')}</span>
                <button
                  type="button"
                  className={styles.changeKeyBtn}
                  onClick={() => openExternal(PLATFORM_USAGE_URL)}
                >
                  {t('viewUsageLink')} ↗
                </button>
              </div>
            </div>

            <div className={styles.footerActions}>
              {balance.status === 'insufficient' ? (
                <Button variant="outlined" size="l" block onClick={closeOnboarding}>
                  {t('skipTopUp')}
                </Button>
              ) : (
                <Button
                  variant="primary"
                  size="l"
                  block
                  disabled={balance.status === 'loading' || balance.status === 'unauthorized'}
                  onClick={closeOnboarding}
                >
                  {t('startChatting')}
                </Button>
              )}
            </div>
          </div>
        )}

        {!apiKey ? (
          <Button variant="outlined" size="m" block onClick={handleDismiss}>
            {t('onboardingSkip')}
          </Button>
        ) : null}

        <div className={styles.historyBox}>
          <div className={styles.historyTitle}>{t('onboardingHistoryTitle')}</div>
          <div className={styles.hint}>{t('onboardingHistoryGuide')}</div>
          <div className={styles.historyActions}>
            <Button
              variant="outlined"
              size="s"
              disabled={historyBusy || importingHistory}
              onClick={() => fileInputRef.current?.click()}
            >
              <IconUploadOutline14 />
              {t('historyImport')}
            </Button>
            <Button
              variant="outlined"
              size="s"
              disabled={historyBusy || importingHistory || sessionsCount === 0}
              onClick={() => void handleExport()}
            >
              <IconDownloadOutline16 />
              {t('exportAllLabel')}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept={
                Capacitor.isNativePlatform()
                  ? '*/*'
                  : '.zip,.json,application/zip,application/x-zip-compressed,application/json'
              }
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (file) {
                  handleSelectImport(file)
                }
              }}
            />
          </div>
          {historyStatus ? (
            <div className={historyStatus.error ? styles.error : styles.detected}>
              {historyStatus.text}
            </div>
          ) : null}
        </div>
      </Modal>

      {pendingImportFile ? (
        <Modal
          title={t('historyImportConfirmTitle')}
          onClose={() => setPendingImportFile(null)}
          footer={
            <>
              <Button variant="outlined" size="m" onClick={() => setPendingImportFile(null)}>
                {t('cancel')}
              </Button>
              <Button
                variant="dangerOutlined"
                size="m"
                onClick={() => {
                  const file = pendingImportFile
                  setPendingImportFile(null)
                  void runImport(file)
                }}
              >
                {t('historyImportConfirm')}
              </Button>
            </>
          }
        >
          {t('historyImportConfirmDescription')}
        </Modal>
      ) : null}
    </>
  )
}
