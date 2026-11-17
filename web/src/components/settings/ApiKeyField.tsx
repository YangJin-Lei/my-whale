import { useState } from 'react'
import { IconEditOutline16 } from '../base/icons.js'
import { refreshBalance } from '../../services/balance.js'
import { readClipboardText } from '../../services/clipboard.js'
import { openExternal, PLATFORM_API_KEYS_URL } from '../../services/links.js'
import { setApiKey, useSettings } from '../../services/settings.js'
import { useIsMobile } from '../../app/viewport.js'
import { BalanceBadge } from '../balance/BalanceBadge.js'
import { Button } from '../base/Button.js'
import { IconButton } from '../base/IconButton.js'
import { Modal } from '../base/Modal.js'
import { openOnboarding } from '../onboarding/onboardingState.js'
import { closeSettings } from './settingsDialogState.js'
import { useApiKeyForm } from './useApiKeyForm.js'
import { useTranslate } from '../../i18n/index.js'
import styles from './Settings.module.css'

/** API Key 的编辑状态：输入框与移动端底部的「确定」按钮共用 */
export const useApiKeyEditor = () => {
  const apiKey = useSettings((state) => state.apiKey)
  const [editing, setEditing] = useState(false)
  const form = useApiKeyForm(() => {
    setEditing(false)
    void refreshBalance()
  })
  return { apiKey, editing, setEditing, form, showInput: !apiKey || editing }
}

type ApiKeyEditor = ReturnType<typeof useApiKeyEditor>

/** API Key：保存后只显示掩码，点编辑按钮才能重新输入 */
export const ApiKeyField = ({ editor }: { editor: ApiKeyEditor }) => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const { apiKey, editing, setEditing, form, showInput } = editor
  const [confirmLogout, setConfirmLogout] = useState(false)

  return (
    <div className={styles.cell}>
      <div className={styles.apiKey}>
        <div className={styles.apiKeyHeader}>
          <div className={styles.label}>{t('apiKeyStart')}</div>
          <button
            type="button"
            className={styles.apiKeyGetLink}
            onClick={() => openExternal(PLATFORM_API_KEYS_URL)}
          >
            {t('getApiKeyLink')} ↗
          </button>
        </div>
        {apiKey && !editing ? (
          <div className={styles.apiKeySaved}>
            <span className={styles.apiKeyMask}>{'*'.repeat(apiKey.length)}</span>
            <div className={styles.apiKeySavedActions}>
              <IconButton
                tone="primary"
                icon={<IconEditOutline16 />}
                tooltip={t('apiKeyEdit')}
                onClick={() => setEditing(true)}
              />
              <button
                type="button"
                className={styles.apiKeyLogoutBtn}
                onClick={() => setConfirmLogout(true)}
              >
                {t('apiKeyLogout')}
              </button>
            </div>
          </div>
        ) : (
          <div className={styles.apiKeyInput}>
            <input
              type="password"
              placeholder={t('apiKeyPlaceholder')}
              autoComplete="off"
              spellCheck={false}
              // 移动端打开设置时不弹键盘，点编辑后才聚焦
              autoFocus={!isMobile || editing}
              value={form.value}
              onChange={(event) => form.setValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                  void form.submit()
                }
              }}
              onBlur={() => {
                // 修改时没输入就离开，回到已保存的状态
                if (apiKey && !form.value.trim()) {
                  setEditing(false)
                }
              }}
            />
            <button
              type="button"
              className={styles.confirm}
              onMouseDown={(event) => event.preventDefault()}
              onClick={async () => {
                const text = await readClipboardText()
                if (text?.trim()) {
                  form.setValue(text.trim())
                }
              }}
            >
              {t('pasteFromClipboard')}
            </button>
            {!isMobile && form.value.trim() ? (
              <>
                <span className={styles.divider} />
                <button
                  type="button"
                  className={styles.confirm}
                  disabled={form.verifying}
                  // 保持输入框焦点
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => void form.submit()}
                >
                  {form.verifying ? t('apiKeyVerifying') : t('confirm')}
                </button>
              </>
            ) : null}
          </div>
        )}
        {showInput && form.error ? <div className={styles.error}>{form.error}</div> : null}
        <BalanceBadge variant="settings" />
      </div>
      {confirmLogout ? (
        <Modal
          title={t('apiKeyLogoutConfirmTitle')}
          onClose={() => setConfirmLogout(false)}
          footer={
            <>
              <Button variant="outlined" size="m" onClick={() => setConfirmLogout(false)}>
                {t('cancel')}
              </Button>
              <Button
                variant="danger"
                size="m"
                onClick={() => {
                  setConfirmLogout(false)
                  setEditing(false)
                  setApiKey(null)
                  closeSettings()
                  openOnboarding()
                }}
              >
                {t('apiKeyLogout')}
              </Button>
            </>
          }
        >
          {t('apiKeyLogoutConfirmDesc')}
        </Modal>
      ) : null}
    </div>
  )
}

/** 移动端：输入 API Key 时在选项下方显示整行「确定」 */
export const ApiKeyConfirm = ({ editor: { showInput, form } }: { editor: ApiKeyEditor }) => {
  const t = useTranslate()
  return showInput && form.value.trim() ? (
    <button
      type="button"
      className={styles.mobileConfirm}
      disabled={form.verifying}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => void form.submit()}
    >
      {form.verifying ? t('apiKeyVerifying') : t('confirm')}
    </button>
  ) : null
}
