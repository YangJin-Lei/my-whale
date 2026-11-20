import clsx from 'clsx'
import { useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { ApiError, verifyCustomApi } from '../../services/api/client.js'
import {
  isCustomApiConfigured,
  setApiProvider,
  setCustomApiConfig,
  useSettings,
  type CustomApiProtocol,
} from '../../services/settings.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import styles from './Settings.module.css'

export const CustomApiManagement = () => {
  const t = useTranslate()
  const apiProvider = useSettings((s) => s.apiProvider)
  const officialKey = useSettings((s) => s.apiKey)
  const customApiUrl = useSettings((s) => s.customApiUrl)
  const customApiKey = useSettings((s) => s.customApiKey)
  const customApiModel = useSettings((s) => s.customApiModel)
  const customApiProtocol = useSettings((s) => s.customApiProtocol)
  const customReady = Boolean(customApiUrl.trim() && customApiKey?.trim() && customApiModel.trim())

  const [modalOpen, setModalOpen] = useState(false)
  const [urlDraft, setUrlDraft] = useState('')
  const [keyDraft, setKeyDraft] = useState('')
  const [modelDraft, setModelDraft] = useState('')
  const [protocolDraft, setProtocolDraft] = useState<CustomApiProtocol>('openai')
  const [verifying, setVerifying] = useState(false)
  const [errorText, setErrorText] = useState<string | null>(null)

  const openModal = () => {
    const cur = useSettings.getState()
    setUrlDraft(cur.customApiUrl)
    setKeyDraft('')
    setModelDraft(cur.customApiModel)
    setProtocolDraft(cur.customApiProtocol)
    setErrorText(null)
    setModalOpen(true)
  }

  const handleSelectProvider = (next: 'official' | 'custom') => {
    if (next === 'custom' && !isCustomApiConfigured()) {
      openModal()
      return
    }
    setApiProvider(next)
  }

  const handleSave = async () => {
    const url = urlDraft.trim().replace(/\/+$/, '')
    const model = modelDraft.trim()
    const key = keyDraft.trim() || customApiKey?.trim() || ''
    if (!url || !key || !model) {
      setErrorText(t('customApiMissingFields'))
      return
    }
    setVerifying(true)
    setErrorText(null)
    try {
      await verifyCustomApi({ url, apiKey: key, model, protocol: protocolDraft })
      setCustomApiConfig({
        url,
        apiKey: key,
        model,
        protocol: protocolDraft,
      })
      setApiProvider('custom')
      setModalOpen(false)
      showToast({ key: 'customApiSavedToast' })
    } catch (error) {
      setErrorText(
        error instanceof ApiError && error.localMessage
          ? t(error.localMessage.key, error.localMessage.params)
          : error instanceof Error
            ? error.message
            : String(error)
      )
    } finally {
      setVerifying(false)
    }
  }

  const handleClear = () => {
    setCustomApiConfig({
      url: '',
      apiKey: null,
      model: '',
      protocol: 'openai',
    })
    if (apiProvider === 'custom') {
      setApiProvider('official')
    }
    setModalOpen(false)
  }

  const customStatusText = customReady
    ? `${customApiProtocol === 'anthropic' ? 'Anthropic' : 'OpenAI'} · ${customApiModel}`
    : t('customApiNotConfigured')

  return (
    <>
      <div className={styles.cell}>
        <div className={styles.row}>
          <div className={styles.label}>{t('apiProviderLabel')}</div>
          <div className={styles.providerSwitchGroup}>
            <button
              type="button"
              className={clsx(
                styles.bgPresetChip,
                apiProvider === 'official' && styles.bgPresetChipActive
              )}
              disabled={!officialKey && apiProvider !== 'official' && !customReady}
              onClick={() => handleSelectProvider('official')}
            >
              {t('apiProviderOfficial')}
            </button>
            <button
              type="button"
              className={clsx(
                styles.bgPresetChip,
                apiProvider === 'custom' && styles.bgPresetChipActive
              )}
              onClick={() => handleSelectProvider('custom')}
            >
              {t('apiProviderCustom')}
            </button>
          </div>
        </div>
      </div>

      <div className={styles.cell}>
        <div className={styles.row}>
          <div className={styles.label}>
            {t('apiProviderCustom')}
            <div className={styles.description}>{customStatusText}</div>
          </div>
          <Button variant="outlined" size="m" className={styles.cellButton} onClick={openModal}>
            {t('customApiButton')}
          </Button>
        </div>
      </div>

      {modalOpen ? (
        <Modal
          title={t('customApiModalTitle')}
          onClose={() => {
            if (!verifying) {
              setModalOpen(false)
            }
          }}
          footer={
            <>
              {customReady || customApiUrl || customApiModel ? (
                <Button
                  variant="dangerOutlined"
                  size="m"
                  disabled={verifying}
                  onClick={handleClear}
                >
                  {t('customApiClear')}
                </Button>
              ) : null}
              <Button
                variant="outlined"
                size="m"
                disabled={verifying}
                onClick={() => setModalOpen(false)}
              >
                {t('cancel')}
              </Button>
              <Button
                variant="primary"
                size="m"
                disabled={verifying}
                onClick={() => void handleSave()}
              >
                {verifying ? t('apiKeyVerifying') : t('customApiSaveAndUse')}
              </Button>
            </>
          }
        >
          <div className={styles.customApiForm}>
            <div className={styles.customApiField}>
              <span className={styles.customApiLabel}>{t('customApiProtocol')}</span>
              <div className={styles.providerSwitchGroup}>
                <button
                  type="button"
                  className={clsx(
                    styles.bgPresetChip,
                    protocolDraft === 'openai' && styles.bgPresetChipActive
                  )}
                  onClick={() => setProtocolDraft('openai')}
                >
                  {t('customApiProtocolOpenAi')}
                </button>
                <button
                  type="button"
                  className={clsx(
                    styles.bgPresetChip,
                    protocolDraft === 'anthropic' && styles.bgPresetChipActive
                  )}
                  onClick={() => setProtocolDraft('anthropic')}
                >
                  {t('customApiProtocolAnthropic')}
                </button>
              </div>
            </div>

            <div className={styles.customApiField}>
              <label className={styles.customApiLabel} htmlFor="custom-api-url">
                {t('customApiUrlLabel')}
              </label>
              <input
                id="custom-api-url"
                type="url"
                className={styles.mirrorInput}
                value={urlDraft}
                placeholder={t('customApiUrlPlaceholder')}
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => setUrlDraft(e.target.value)}
              />
            </div>

            <div className={styles.customApiField}>
              <label className={styles.customApiLabel} htmlFor="custom-api-key">
                {t('customApiKeyLabel')}
              </label>
              <input
                id="custom-api-key"
                type="password"
                className={styles.mirrorInput}
                value={keyDraft}
                placeholder={
                  customApiKey ? t('customApiKeySavedPlaceholder') : t('customApiKeyPlaceholder')
                }
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => setKeyDraft(e.target.value)}
              />
            </div>

            <div className={styles.customApiField}>
              <label className={styles.customApiLabel} htmlFor="custom-api-model">
                {t('customApiModelLabel')}
              </label>
              <input
                id="custom-api-model"
                type="text"
                className={styles.mirrorInput}
                value={modelDraft}
                placeholder={t('customApiModelPlaceholder')}
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => setModelDraft(e.target.value)}
              />
            </div>

            {errorText ? <div className={styles.error}>{errorText}</div> : null}
          </div>
        </Modal>
      ) : null}
    </>
  )
}
