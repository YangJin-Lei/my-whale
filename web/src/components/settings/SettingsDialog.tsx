import clsx from 'clsx'
import { Capacitor } from '@capacitor/core'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  IconDarkOutline16,
  IconDataOutline16,
  IconDownloadOutline16,
  IconFollowsystemOutline16,
  IconLightOutline16,
  IconMemoryOutline16,
  IconPersonaOutline16,
  IconPetOutline16,
  IconSettingsOutline16,
  IconUploadOutline14,
} from '../base/icons.js'
import {
  BackupError,
  clearHistory,
  exportHistory,
  importHistory,
} from '../../services/chat/backup.js'
import { exportBlobFile } from '../../services/fileExport.js'
import { clearDrawGuessCache, clearGameDecisionCache } from '../../game/history.js'
import { useIsMobile } from '../../app/viewport.js'
import { useChatStore } from '../../services/chat/store.js'
import { regionCodes, getRegionName, provinces } from '../../services/location.js'
import { openDeepSeekDataExport, openExternal } from '../../services/links.js'
import {
  clearRemoteCacheBackend,
  hasNativeCacheController,
  pingCacheBackend,
  startNativeOrProbeCacheBackend,
  stopNativeCacheBackend,
  type CacheBackendStats,
} from '../../services/cacheBackend.js'
import {
  checkForUpdates,
  CURRENT_VERSION,
  startInAppUpdate,
  useUpdateStore,
} from '../../services/update.js'
import {
  FONT_SCALE_STEPS,
  isChineseBrowser,
  isIflytekConfigured,
  setCacheBackendUrl,
  setCacheModeEnabled,
  setCompactionEnabled,
  setGameCacheEnabled,
  setChatBgImage,
  setChatBgOpacity,
  setChatBgPreset,
  setFontFollowSystem,
  setFontScale,
  setIflytekCredentials,
  setIflytekVoice,
  setLocalTtsSpeakerId,
  setLocalTtsVoiceId,
  setLocale,
  setLocation,
  setThemePreference,
  setTtsEngine,
  setTtsVoice,
  setUpdateAccelerate,
  setUpdateMirror,
  setVoiceAutoPlay,
  setVoiceEnabled,
  useSettings,
  type ChatBgPreset,
  type ThemePreference,
} from '../../services/settings.js'
import { stopReadAloud, unlockReadAloudAudio } from '../../services/speech/readAloud.js'
import {
  DEFAULT_LOCAL_VOICE_ID,
  LOCAL_VOICE_PACKS,
  TTS_ENGINES,
  findLocalVoicePack,
  resolveLocalVoiceSpeakerId,
} from '../../services/speech/engines.js'
import {
  IFLYTEK_CONSOLE_URL,
  IFLYTEK_VOICES,
  type IflytekVoiceId,
} from '../../services/speech/iflytekTts.js'
import {
  deleteLocalVoicePack,
  downloadLocalVoicePack,
  getLocalTtsStatus,
  hasNativeLocalTts,
  prewarmLocalTts,
} from '../../services/speech/localTts.js'
import { useTranslate, type TranslationKey, type TranslationMessage } from '../../i18n/index.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { Select } from '../base/Select.js'
import { showToast } from '../base/toastState.js'
import { MemorySettings } from '../memory/MemorySettings.js'
import { PersonaSettings } from '../persona/PersonaSettings.js'
import { PetSettings } from './PetSettings.js'
import { ApiKeyConfirm, ApiKeyField, useApiKeyEditor } from './ApiKeyField.js'
import { CustomApiManagement } from './CustomApiSection.js'
import { FullBackupSection } from './FullBackupSection.js'
import { closeSettings, useSettingsDialog, type SettingsSection } from './settingsDialogState.js'
import styles from './Settings.module.css'

/**
 * 设置弹窗：分「通用设置」（主题、语言、朗读音色、位置）与「数据管理」（API Key、导入、导出、删除）。
 * 桌面端为居中弹窗、左侧导航；移动端为底部弹层、导航横排在内容上方
 */
export const SettingsDialog = () => {
  const open = useSettingsDialog((state) => state.open)
  return open ? <SettingsContent /> : null
}

const sections: { value: SettingsSection; label: TranslationKey; icon: ReactNode }[] = [
  {
    value: 'general',
    label: 'settingDialogAsideGeneralOptionLabel',
    icon: <IconSettingsOutline16 />,
  },
  {
    value: 'pet',
    label: 'settingDialogAsidePetOptionLabel',
    icon: <IconPetOutline16 />,
  },
  {
    value: 'persona',
    label: 'settingDialogAsidePersonaOptionLabel',
    icon: <IconPersonaOutline16 />,
  },
  {
    value: 'memory',
    label: 'settingDialogAsideMemoryOptionLabel',
    icon: <IconMemoryOutline16 />,
  },
  { value: 'data', label: 'settingDialogAsideDataOptionLabel', icon: <IconDataOutline16 /> },
]

const SettingsContent = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  // 打开时按调用方指定的分组选中，之后在弹窗内切换
  const [section, setSection] = useState(() => useSettingsDialog.getState().section)
  // 移动端从常规入口打开时先显示竖屏分类列表，确保「数据管理」等入口直观可见
  const [mobileMenuOpen, setMobileMenuOpen] = useState(
    () => useSettingsDialog.getState().section === 'general'
  )
  // 切换分组不丢失正在输入的 API Key 与导入状态
  const apiKeyEditor = useApiKeyEditor()
  const historyImport = useHistoryImport()
  const historyDelete = useHistoryDelete()
  const replacingHistory = useChatStore((state) => state.importingHistory)
  const historyBusy = historyImport.busy || historyDelete.busy || replacingHistory
  const activeSectionItem = sections.find((item) => item.value === section) ?? sections[0]
  return (
    <>
      <Modal
        title={t('settings')}
        closable
        className={styles.dialog}
        mainClassName={styles.dialogMain}
        onClose={() => {
          if (!historyDelete.busy) {
            closeSettings()
          }
        }}
      >
        {isMobile ? (
          mobileMenuOpen ? (
            <div role="tablist" className={styles.mobileSectionList}>
              {sections.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  role="tab"
                  aria-selected={section === item.value}
                  className={styles.mobileSectionRow}
                  onClick={() => {
                    setSection(item.value)
                    setMobileMenuOpen(false)
                  }}
                >
                  <span className={styles.mobileSectionLeft}>
                    {item.icon}
                    <span>{t(item.label)}</span>
                  </span>
                  <span className={styles.mobileSectionArrow} aria-hidden>
                    ›
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className={styles.mobileSubHeader}>
              <button
                type="button"
                className={styles.mobileBackBtn}
                onClick={() => setMobileMenuOpen(true)}
              >
                ‹ {t('settings')}
              </button>
              <span className={styles.mobileSubTitle}>{t(activeSectionItem.label)}</span>
            </div>
          )
        ) : (
          <div role="tablist" className={styles.navigation}>
            {sections.map((item) => (
              <button
                key={item.value}
                type="button"
                role="tab"
                aria-selected={section === item.value}
                className={clsx(styles.navItem, section === item.value && styles.navItemActive)}
                onClick={() => setSection(item.value)}
              >
                {item.icon}
                {t(item.label)}
              </button>
            ))}
          </div>
        )}
        {!isMobile || !mobileMenuOpen ? (
          <div role="tabpanel" className={styles.content}>
            {section === 'general' ? (
              <>
                <ThemeSetting />
                <FontSizeSetting />
                <ChatBackgroundSetting />
                <LocaleSetting />
                <VoiceModeSetting />
                <LocationSetting />
                <CacheModeSetting />
                <CompactionSetting />
                <UpdateSetting />
                <UpdateAccelerateSetting />
                <GameCacheSetting />
                <AppNotice />
              </>
            ) : section === 'pet' ? (
              <PetSettings />
            ) : section === 'persona' ? (
              <PersonaSettings />
            ) : section === 'memory' ? (
              <MemorySettings />
            ) : (
              <>
                <CustomApiManagement />
                <ApiKeyField editor={apiKeyEditor} />
                <FullBackupSection disabled={historyBusy} />
                <DeepSeekExportSetting />
                <ImportHistory historyImport={historyImport} disabled={historyBusy} />
                <ExportHistory disabled={historyBusy} />
                <SettingCell
                  label={t('deleteAllSessions')}
                  status={null}
                  action={
                    <Button
                      variant="dangerOutlined"
                      size="m"
                      className={styles.cellButton}
                      disabled={historyBusy}
                      onClick={historyDelete.open}
                    >
                      {t('delete')}
                    </Button>
                  }
                />
                {isMobile ? <ApiKeyConfirm editor={apiKeyEditor} /> : null}
              </>
            )}
          </div>
        ) : null}
      </Modal>
      {historyImport.file ? <ImportConfirm historyImport={historyImport} /> : null}
      {historyDelete.opened ? <DeleteAllConfirm historyDelete={historyDelete} /> : null}
    </>
  )
}

/** 删除确认保留在设置之上；失败可重试，成功只关闭确认弹窗。 */
const DeleteAllConfirm = ({
  historyDelete,
}: {
  historyDelete: ReturnType<typeof useHistoryDelete>
}) => {
  const t = useTranslate()
  return (
    <Modal
      title={t('deleteAllSessionsModalTitle')}
      className={styles.deleteConfirm}
      onClose={historyDelete.cancel}
      footer={
        <div className={styles.deleteActions} aria-busy={historyDelete.busy}>
          <Button
            variant="outlined"
            autoFocus
            disabled={historyDelete.busy}
            onClick={historyDelete.cancel}
          >
            {t('cancel')}
          </Button>
          <Button
            variant="danger"
            disabled={historyDelete.busy}
            onClick={() => void historyDelete.confirm()}
          >
            {t(historyDelete.busy ? 'historyDeleting' : 'deleteAllSessions')}
          </Button>
        </div>
      }
    >
      {t('deleteAllSessionsModalDescription')}
    </Modal>
  )
}

const useHistoryDelete = () => {
  const [opened, setOpened] = useState(false)
  const [busy, setBusy] = useState(false)
  const deleting = useRef(false)

  const confirm = async () => {
    if (deleting.current) {
      return
    }
    deleting.current = true
    setBusy(true)
    try {
      await clearHistory()
      setOpened(false)
      showToast({ key: 'historyDeleted' })
    } catch {
      showToast({ key: 'historyDeleteFailed', type: 'error' })
    } finally {
      deleting.current = false
      setBusy(false)
    }
  }

  return {
    opened,
    busy,
    open: () => setOpened(true),
    cancel: () => {
      if (!deleting.current) {
        setOpened(false)
      }
    },
    confirm,
  }
}

const LocationSetting = () => {
  const t = useTranslate()
  const locale = useSettings((state) => state.locale)
  const location = useSettings((state) => state.location)
  const province =
    location?.region === 'CN'
      ? provinces.find((item) => item.code === location.province)
      : undefined

  return (
    <SettingCell
      label={t('settingsLocation')}
      status={null}
      className={styles.locationCell}
      action={
        <div className={styles.locationSelectors}>
          {isChineseBrowser() ? (
            <>
              <Select
                ariaLabel={t('settingsLocationProvince')}
                className={styles.provinceSelect}
                value={province?.code ?? ''}
                placeholder={t('settingsLocationProvince')}
                options={provinces.map((item) => ({ value: item.code, label: item.name }))}
                onChange={(value) => {
                  if (value !== province?.code) {
                    setLocation({ region: 'CN', province: value })
                  }
                }}
              />
              <Select
                ariaLabel={t('settingsLocationCity')}
                className={styles.citySelect}
                value={province ? (location?.city ?? '') : ''}
                disabled={!province?.cities.length}
                placeholder={t('settingsLocationCity')}
                options={
                  province?.cities.map((item) => ({ value: item.code, label: item.name })) ?? []
                }
                onChange={(value) => {
                  if (province) {
                    setLocation({ region: 'CN', province: province.code, city: value })
                  }
                }}
              />
            </>
          ) : (
            <Select
              ariaLabel={t('settingsLocationRegion')}
              className={styles.regionSelect}
              value={location?.region ?? ''}
              placeholder={t('settingsLocationRegion')}
              options={regionCodes
                .map((code) => ({ value: code, label: getRegionName(code, locale) }))
                .sort((a, b) => a.label.localeCompare(b.label, locale))}
              onChange={(value) => setLocation({ region: value })}
            />
          )}
        </div>
      }
    />
  )
}

const LocaleSetting = () => {
  const t = useTranslate()
  const locale = useSettings((state) => state.locale)
  return (
    <SettingCell
      label={t('settingsLocalePreference')}
      status={null}
      action={
        <Select
          ariaLabel={t('settingsLocalePreference')}
          value={locale}
          options={[
            { value: 'zh-CN', label: t('settingsLocaleZhCN'), lang: 'zh-CN' },
            { value: 'en-US', label: t('settingsLocaleEnUS'), lang: 'en' },
          ]}
          onChange={setLocale}
        />
      }
    />
  )
}

const UpdateSetting = () => {
  const t = useTranslate()
  const status = useUpdateStore((state) => state.status)
  const latestVersion = useUpdateStore((state) => state.latestVersion)
  const releaseUrl = useUpdateStore((state) => state.releaseUrl)
  const hasInAppUpdater = useUpdateStore((state) => state.hasInAppUpdater)
  const downloadStatus = useUpdateStore((state) => state.downloadStatus)
  const downloadProgress = useUpdateStore((state) => state.downloadProgress)
  const downloadError = useUpdateStore((state) => state.downloadError)

  const actionLabel =
    downloadStatus === 'downloading'
      ? downloadProgress !== null
        ? t('settingsDownloadingPercent', { percent: downloadProgress })
        : t('settingsDownloading')
      : downloadStatus === 'installing'
        ? t('settingsInstalling')
        : downloadStatus === 'needs_permission'
          ? t('settingsContinueInstall')
          : downloadStatus === 'error'
            ? t('settingsRetryDownload')
            : hasInAppUpdater
              ? latestVersion
                ? `${t('settingsUpdateNow')} v${latestVersion}`
                : t('settingsUpdateNow')
              : t('settingsGoUpdate')

  const updateCellStatus: Status =
    downloadStatus === 'error' && downloadError
      ? { key: 'updateDownloadErrorDetail', params: { message: downloadError }, error: true }
      : status === 'error'
        ? { key: 'settingsUpdateFailedDesc', error: true }
        : null

  return (
    <SettingCell
      label={`${t('settingsVersionLabel')} v${CURRENT_VERSION}`}
      status={updateCellStatus}
      action={
        status === 'available' ? (
          hasInAppUpdater ? (
            <Button
              variant="primary"
              size="m"
              className={styles.cellButton}
              disabled={downloadStatus === 'downloading' || downloadStatus === 'installing'}
              onClick={() => void startInAppUpdate()}
            >
              {actionLabel}
            </Button>
          ) : (
            <Button
              variant="primary"
              size="m"
              className={styles.cellButton}
              onClick={() => openExternal(releaseUrl)}
            >
              {t('settingsGoUpdate')}
            </Button>
          )
        ) : (
          <Button
            variant="outlined"
            size="m"
            className={styles.cellButton}
            disabled={status === 'checking'}
            onClick={() => void checkForUpdates(true)}
          >
            {status === 'checking' ? t('settingsCheckingUpdate') : t('settingsCheckUpdate')}
          </Button>
        )
      }
    />
  )
}

const UpdateAccelerateSetting = () => {
  const t = useTranslate()
  const updateAccelerate = useSettings((state) => state.updateAccelerate)
  const updateMirror = useSettings((state) => state.updateMirror)

  return (
    <>
      <SettingCell
        label={t('settingsUpdateAccelerate')}
        status={null}
        action={
          <input
            type="checkbox"
            aria-label={t('settingsUpdateAccelerate')}
            checked={updateAccelerate}
            onChange={(event) => setUpdateAccelerate(event.target.checked)}
          />
        }
      />
      {updateAccelerate ? (
        <SettingCell
          label={t('settingsUpdateMirror')}
          status={null}
          action={
            <input
              type="url"
              aria-label={t('settingsUpdateMirror')}
              className={styles.mirrorInput}
              value={updateMirror}
              placeholder="https://ghfast.top/"
              onChange={(event) => setUpdateMirror(event.target.value)}
            />
          }
        />
      ) : null}
    </>
  )
}

const CompactionSetting = () => {
  const t = useTranslate()
  const compactionEnabled = useSettings((state) => state.compactionEnabled)
  return (
    <div className={styles.cellCard}>
      <div className={styles.row}>
        <span className={styles.label}>{t('settingsCompaction')}</span>
        <input
          type="checkbox"
          aria-label={t('settingsCompaction')}
          checked={compactionEnabled}
          onChange={(event) => setCompactionEnabled(event.target.checked)}
        />
      </div>
      <div className={styles.cacheSubLabel}>{t('settingsCompactionHint')}</div>
    </div>
  )
}

const CacheModeSetting = () => {
  const t = useTranslate()
  const cacheModeEnabled = useSettings((state) => state.cacheModeEnabled)
  const cacheBackendUrl = useSettings((state) => state.cacheBackendUrl)
  const [busy, setBusy] = useState(false)
  const [stats, setStats] = useState<CacheBackendStats>({
    online: false,
    searchCached: 0,
    fetchCached: 0,
    searchHits: 0,
    fetchHits: 0,
    upstreamCalls: 0,
    prefixReadTokens: 0,
    prefixCreateTokens: 0,
    prefixInputTokens: 0,
  })
  const totalPrefix = stats.prefixReadTokens + stats.prefixCreateTokens + stats.prefixInputTokens
  const prefixHitRate =
    totalPrefix > 0 ? Math.round((stats.prefixReadTokens / totalPrefix) * 100) : 0

  const refreshStatus = async (url?: string) => {
    const res = await pingCacheBackend(url)
    setStats(res)
    return res
  }

  useEffect(() => {
    if (cacheModeEnabled) {
      void refreshStatus(cacheBackendUrl)
    }
  }, [cacheModeEnabled, cacheBackendUrl])

  const handleToggle = async (next: boolean) => {
    setCacheModeEnabled(next)
    if (!next) {
      await stopNativeCacheBackend()
      setStats((prev) => ({ ...prev, online: false }))
      return
    }
    setBusy(true)
    try {
      const res = await startNativeOrProbeCacheBackend(cacheBackendUrl)
      setStats(res)
      if (!res.online) {
        showToast({ key: 'settingsCacheConnectFailed', type: 'error' })
      }
    } finally {
      setBusy(false)
    }
  }

  const handleStartBackend = async () => {
    setBusy(true)
    try {
      const res = await startNativeOrProbeCacheBackend(cacheBackendUrl)
      setStats(res)
      if (!res.online) {
        showToast({ key: 'settingsCacheConnectFailed', type: 'error' })
      }
    } finally {
      setBusy(false)
    }
  }

  const handleClearCache = async () => {
    clearGameDecisionCache()
    clearDrawGuessCache()
    const ok = await clearRemoteCacheBackend(cacheBackendUrl).catch(() => false)
    if (ok) {
      showToast({ key: 'settingsCacheCleared' })
      await refreshStatus(cacheBackendUrl)
    }
  }

  return (
    <div className={styles.cellCard}>
      <div className={styles.row}>
        <span className={styles.label}>{t('settingsCacheMode')}</span>
        <div className={styles.cacheToggleRight}>
          {cacheModeEnabled ? (
            <span className={stats.online ? styles.cacheOnlinePill : styles.cacheOfflinePill}>
              {busy
                ? t('settingsCacheStarting')
                : stats.online
                  ? t('settingsCacheRunning')
                  : t('settingsCacheStopped')}
            </span>
          ) : null}
          <input
            type="checkbox"
            aria-label={t('settingsCacheMode')}
            checked={cacheModeEnabled}
            disabled={busy}
            onChange={(event) => void handleToggle(event.target.checked)}
          />
        </div>
      </div>
      {cacheModeEnabled ? (
        <div className={styles.cacheDetail}>
          <div className={styles.cacheUrlRow}>
            <span className={styles.cacheSubLabel}>{t('settingsCacheUrl')}</span>
            <input
              type="url"
              aria-label={t('settingsCacheUrl')}
              className={styles.mirrorInput}
              value={cacheBackendUrl}
              placeholder="http://127.0.0.1:8787"
              onChange={(event) => setCacheBackendUrl(event.target.value)}
            />
          </div>
          <div className={styles.cacheActionRow}>
            <Button
              variant="outlined"
              size="s"
              className={styles.bgActionBtn}
              disabled={busy}
              onClick={() => void handleStartBackend()}
            >
              {hasNativeCacheController() && !stats.online ? t('settingsCacheStart') : t('retry')}
            </Button>
            {stats.online ? (
              <>
                {hasNativeCacheController() ? (
                  <Button
                    variant="outlined"
                    size="s"
                    className={styles.bgActionBtn}
                    onClick={() => {
                      void stopNativeCacheBackend().then(() =>
                        setStats((prev) => ({ ...prev, online: false }))
                      )
                    }}
                  >
                    {t('settingsCacheStop')}
                  </Button>
                ) : null}
                <Button
                  variant="outlined"
                  size="s"
                  className={styles.bgActionBtn}
                  onClick={() => void handleClearCache()}
                >
                  {t('settingsCacheClear')}
                </Button>
                <span className={styles.cacheStatsText}>
                  {t('settingsCacheStats', {
                    rate: prefixHitRate,
                    search: stats.searchCached,
                    fetch: stats.fetchCached,
                  })}
                </span>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}

const GameCacheSetting = () => {
  const t = useTranslate()
  const gameCacheEnabled = useSettings((state) => state.gameCacheEnabled)
  return (
    <SettingCell
      label={t('settingsGameCache')}
      status={null}
      action={
        <input
          type="checkbox"
          aria-label={t('settingsGameCache')}
          checked={gameCacheEnabled}
          onChange={(e) => setGameCacheEnabled(e.target.checked)}
        />
      }
    />
  )
}

const AppNotice = () => {
  const t = useTranslate()
  return (
    <div className={styles.noticeBox}>
      <div className={styles.noticeTitle}>{t('settingsNoticeTitle')}</div>
      <ul className={styles.noticeList}>
        <li>{t('settingsNoticeItem1')}</li>
        <li>{t('settingsNoticeItem2')}</li>
        <li>{t('settingsNoticeItem3')}</li>
        <li>{t('settingsNoticeItem4')}</li>
        <li>{t('settingsNoticeItem5')}</li>
        <li>{t('settingsNoticeItem6')}</li>
      </ul>
    </div>
  )
}

const VoiceModeSetting = () => {
  const t = useTranslate()
  const voiceEnabled = useSettings((state) => state.voiceEnabled)
  const voiceAutoPlay = useSettings((state) => state.voiceAutoPlay)
  const ttsEngine = useSettings((state) => state.ttsEngine)
  return (
    <>
      <SettingCell
        label={t('settingsVoiceMode')}
        status={null}
        action={
          <input
            type="checkbox"
            aria-label={t('settingsVoiceMode')}
            checked={voiceEnabled}
            onChange={(event) => {
              const next = event.target.checked
              if (!next) {
                stopReadAloud()
              } else if (useSettings.getState().ttsEngine === 'local-sherpa') {
                void prewarmLocalTts(useSettings.getState().localTtsVoiceId)
              }
              setVoiceEnabled(next)
            }}
          />
        }
      />
      {voiceEnabled ? (
        <>
          <SettingCell
            label={t('settingsVoiceAutoPlay')}
            status={null}
            action={
              <input
                type="checkbox"
                aria-label={t('settingsVoiceAutoPlay')}
                checked={voiceAutoPlay}
                onChange={(event) => {
                  const next = event.target.checked
                  if (next) {
                    unlockReadAloudAudio()
                  } else {
                    stopReadAloud()
                  }
                  setVoiceAutoPlay(next)
                }}
              />
            }
          />
          <TtsEngineSetting />
          {ttsEngine === 'iflytek' ? <IflytekTtsSetting /> : null}
          {ttsEngine === 'official' ? <TtsVoiceSetting /> : null}
          {ttsEngine === 'local-sherpa' ? <LocalTtsVoiceSetting /> : null}
        </>
      ) : null}
    </>
  )
}

/** 字体大小调节：支持跟随系统与 6 档滑块实时预览 */
const FontSizeSetting = () => {
  const t = useTranslate()
  const fontFollowSystem = useSettings((state) => state.fontFollowSystem)
  const fontScale = useSettings((state) => state.fontScale)
  const effectiveScale = fontFollowSystem ? 1 : fontScale
  const matchedIdx = FONT_SCALE_STEPS.findIndex((step) => step === fontScale)
  const sliderIndex = matchedIdx >= 0 ? matchedIdx : 2
  const stopLabel =
    effectiveScale === 1
      ? t('settingsFontStandard')
      : effectiveScale < 1
        ? `${t('settingsFontSmall')} (${Math.round(effectiveScale * 100)}%)`
        : `${t('settingsFontLarge')} (${Math.round(effectiveScale * 100)}%)`

  return (
    <div className={styles.cellCard}>
      <div className={styles.row}>
        <span className={styles.label}>{t('settingsFontSize')}</span>
        <label className={styles.inlineSwitch}>
          <span>{t('settingsFontFollowSystem')}</span>
          <input
            type="checkbox"
            aria-label={t('settingsFontFollowSystem')}
            checked={fontFollowSystem}
            onChange={(event) => setFontFollowSystem(event.target.checked)}
          />
        </label>
      </div>
      <div className={styles.fontPreviewWrap}>
        <div
          className={styles.fontPreviewBubble}
          style={{ fontSize: `${Math.round(16 * effectiveScale)}px` }}
        >
          {t('settingsFontPreview')}
        </div>
      </div>
      <div className={styles.fontSliderMeta}>
        <span className={styles.fontEdgeSmall}>A</span>
        <span className={styles.fontStopLabel}>{stopLabel}</span>
        <span className={styles.fontEdgeLarge}>A</span>
      </div>
      <input
        type="range"
        aria-label={t('settingsFontSize')}
        className={styles.fontSlider}
        min={0}
        max={FONT_SCALE_STEPS.length - 1}
        step={1}
        value={sliderIndex}
        onChange={(event) => {
          const idx = Number(event.target.value)
          const next = FONT_SCALE_STEPS[idx] ?? 1
          setFontScale(next)
        }}
      />
    </div>
  )
}

const bgPresets: { value: ChatBgPreset; label: TranslationKey }[] = [
  { value: 'none', label: 'settingsChatBgNone' },
  { value: 'ocean', label: 'settingsChatBgOcean' },
  { value: 'warm', label: 'settingsChatBgWarm' },
  { value: 'aurora', label: 'settingsChatBgAurora' },
  { value: 'mint', label: 'settingsChatBgMint' },
]

const compressImageToDataUrl = async (file: File): Promise<string> => {
  const objectUrl = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('Image decode failed'))
      el.src = objectUrl
    })
    const maxSide = 1280
    const scale = Math.min(1, maxSide / Math.max(img.width || 1, img.height || 1))
    const width = Math.max(1, Math.round(img.width * scale))
    const height = Math.max(1, Math.round(img.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      throw new Error('Canvas unavailable')
    }
    ctx.drawImage(img, 0, 0, width, height)
    return canvas.toDataURL('image/jpeg', 0.78)
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

/** 聊天背景：内置渐变预设 + 本地上传自定义图片 */
const ChatBackgroundSetting = () => {
  const t = useTranslate()
  const chatBgPreset = useSettings((state) => state.chatBgPreset)
  const chatBgImage = useSettings((state) => state.chatBgImage)
  const chatBgOpacity = useSettings((state) => state.chatBgOpacity)
  const fileRef = useRef<HTMLInputElement>(null)

  const handleUploadBg = async (file: File) => {
    try {
      const dataUrl = await compressImageToDataUrl(file)
      setChatBgImage(dataUrl)
    } catch {
      showToast({ key: 'settingsChatBgInvalid', type: 'error' })
    }
  }

  return (
    <div className={styles.cellCard}>
      <div className={styles.row}>
        <span className={styles.label}>{t('settingsChatBg')}</span>
        <div className={styles.bgActions}>
          <Button
            variant="outlined"
            size="s"
            className={styles.bgActionBtn}
            onClick={() => fileRef.current?.click()}
          >
            {t('settingsChatBgUpload')}
          </Button>
          {chatBgPreset !== 'none' || chatBgImage ? (
            <Button
              variant="outlined"
              size="s"
              className={styles.bgActionBtn}
              onClick={() => setChatBgImage('')}
            >
              {t('settingsChatBgClear')}
            </Button>
          ) : null}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) {
                void handleUploadBg(file)
              }
            }}
          />
        </div>
      </div>
      <div className={styles.bgPresetList}>
        {bgPresets.map((item) => (
          <button
            key={item.value}
            type="button"
            className={clsx(
              styles.bgPresetChip,
              chatBgPreset === item.value && styles.bgPresetChipActive
            )}
            onClick={() => setChatBgPreset(item.value)}
          >
            {t(item.label)}
          </button>
        ))}
        {chatBgImage ? (
          <button
            type="button"
            className={clsx(
              styles.bgPresetChip,
              chatBgPreset === 'custom' && styles.bgPresetChipActive
            )}
            onClick={() => setChatBgPreset('custom')}
          >
            {t('settingsChatBgCustom')}
          </button>
        ) : null}
      </div>
      {chatBgImage ? (
        <div className={styles.cacheUrlRow}>
          <span className={styles.cacheSubLabel}>
            {t('settingsChatBgOpacity')} ({Math.round(chatBgOpacity * 100)}%)
          </span>
          <input
            type="range"
            min={5}
            max={100}
            step={1}
            aria-label={t('settingsChatBgOpacity')}
            className={styles.fontSlider}
            value={Math.round(chatBgOpacity * 100)}
            onChange={(event) => setChatBgOpacity(Number(event.target.value) / 100)}
          />
        </div>
      ) : null}
    </div>
  )
}

const DeepSeekExportSetting = () => {
  const t = useTranslate()
  return (
    <div className={styles.cellCard}>
      <div className={styles.row}>
        <div className={styles.text}>
          <div className={styles.label}>{t('settingsDeepSeekExport')}</div>
        </div>
        <Button
          variant="outlined"
          size="m"
          className={styles.cellButton}
          onClick={() => void openDeepSeekDataExport()}
        >
          {t('settingsOpenDeepSeek')}
        </Button>
      </div>
      <div className={styles.exportGuide}>{t('settingsDeepSeekExportGuide')}</div>
    </div>
  )
}

const TtsEngineSetting = () => {
  const t = useTranslate()
  const ttsEngine = useSettings((state) => state.ttsEngine)
  const locale = useSettings((state) => state.locale)
  const isEn = locale === 'en-US'
  return (
    <SettingCell
      label={t('settingsTtsEngine')}
      status={null}
      action={
        <Select
          ariaLabel={t('settingsTtsEngine')}
          value={ttsEngine}
          options={TTS_ENGINES.map((engine) => ({
            value: engine.id,
            label: isEn ? engine.labelEn : engine.labelZh,
            disabled: !engine.available,
          }))}
          onChange={(next) => {
            setTtsEngine(next)
            if (next === 'local-sherpa') {
              void prewarmLocalTts(useSettings.getState().localTtsVoiceId)
            }
          }}
        />
      }
    />
  )
}

const IflytekTtsSetting = () => {
  const t = useTranslate()
  const locale = useSettings((state) => state.locale)
  const iflytekAppId = useSettings((state) => state.iflytekAppId)
  const iflytekApiKey = useSettings((state) => state.iflytekApiKey)
  const iflytekApiSecret = useSettings((state) => state.iflytekApiSecret)
  const iflytekVoice = useSettings((state) => state.iflytekVoice)
  const configured = isIflytekConfigured()
  const isEn = locale === 'en-US'

  const [appIdDraft, setAppIdDraft] = useState(iflytekAppId)
  const [apiKeyDraft, setApiKeyDraft] = useState('')
  const [apiSecretDraft, setApiSecretDraft] = useState('')

  useEffect(() => {
    setAppIdDraft(iflytekAppId)
  }, [iflytekAppId])

  const handleSave = () => {
    const cleanAppId = appIdDraft.trim()
    const cleanKey = apiKeyDraft.trim() || iflytekApiKey.trim()
    const cleanSecret = apiSecretDraft.trim() || iflytekApiSecret.trim()
    if (!cleanAppId || !cleanKey || !cleanSecret) {
      showToast(t('customApiMissingFields'))
      return
    }
    setIflytekCredentials({
      appId: cleanAppId,
      apiKey: cleanKey,
      apiSecret: cleanSecret,
    })
    setApiKeyDraft('')
    setApiSecretDraft('')
    showToast({ key: 'settingsTtsIflytekSaved' })
  }

  return (
    <>
      <SettingCell
        label={t('settingsTtsIflytekVoice')}
        status={null}
        action={
          <Select
            ariaLabel={t('settingsTtsIflytekVoice')}
            value={iflytekVoice}
            options={IFLYTEK_VOICES.map((voice) => ({
              value: voice.id,
              label: isEn ? voice.labelEn : voice.labelZh,
            }))}
            onChange={(val) => setIflytekVoice(val as IflytekVoiceId)}
          />
        }
      />
      <div className={styles.cell}>
        <div className={styles.apiKeyHeader}>
          <span className={configured ? styles.cacheOnlinePill : styles.cacheOfflinePill}>
            {configured ? t('settingsTtsIflytekConfigured') : t('settingsTtsIflytekUnconfigured')}
          </span>
          <button
            type="button"
            className={styles.apiKeyGetLink}
            onClick={() => openExternal(IFLYTEK_CONSOLE_URL)}
          >
            {t('settingsTtsIflytekOpenConsole')}
          </button>
        </div>
        <div className={styles.exportGuide} style={{ marginTop: 6, marginBottom: 10 }}>
          {t('settingsTtsIflytekGuide')}
        </div>
        <div className={styles.customApiForm}>
          <div className={styles.customApiField}>
            <label className={styles.customApiLabel} htmlFor="iflytek-app-id">
              APPID
            </label>
            <input
              id="iflytek-app-id"
              type="text"
              className={styles.mirrorInput}
              value={appIdDraft}
              placeholder="例如 5f3axxxx"
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setAppIdDraft(e.target.value)}
            />
          </div>
          <div className={styles.customApiField}>
            <label className={styles.customApiLabel} htmlFor="iflytek-api-key">
              APIKey
            </label>
            <input
              id="iflytek-api-key"
              type="password"
              className={styles.mirrorInput}
              value={apiKeyDraft}
              placeholder={iflytekApiKey ? '已保存（留空保持不变）' : '请输入 APIKey'}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setApiKeyDraft(e.target.value)}
            />
          </div>
          <div className={styles.customApiField}>
            <label className={styles.customApiLabel} htmlFor="iflytek-api-secret">
              APISecret
            </label>
            <input
              id="iflytek-api-secret"
              type="password"
              className={styles.mirrorInput}
              value={apiSecretDraft}
              placeholder={iflytekApiSecret ? '已保存（留空保持不变）' : '请输入 APISecret'}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setApiSecretDraft(e.target.value)}
            />
          </div>
          <div className={styles.cacheActionRow}>
            <Button size="s" variant="primary" onClick={handleSave}>
              {t('settingsTtsIflytekSave')}
            </Button>
          </div>
        </div>
      </div>
    </>
  )
}

const LocalTtsVoiceSetting = () => {
  const t = useTranslate()
  const locale = useSettings((state) => state.locale)
  const localTtsVoiceId = useSettings((state) => state.localTtsVoiceId)
  const localTtsSpeakerId = useSettings((state) => state.localTtsSpeakerId)
  const isEn = locale === 'en-US'
  const nativeSupported = hasNativeLocalTts()
  const [installedIds, setInstalledIds] = useState<string[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const activePack = findLocalVoicePack(localTtsVoiceId)
  const activeInstalled = installedIds.includes(activePack.id)
  const activeSpeakerId = resolveLocalVoiceSpeakerId(activePack, localTtsSpeakerId)

  useEffect(() => {
    if (!nativeSupported) {
      return
    }
    let active = true
    void getLocalTtsStatus().then((status) => {
      if (!active) {
        return
      }
      setInstalledIds(status.installedIds)
      if (status.error) {
        setErrorMsg(status.error)
      }
    })
    return () => {
      active = false
    }
  }, [nativeSupported])

  const handleDownload = async (packId: string) => {
    if (busyId) {
      return
    }
    setBusyId(packId)
    setErrorMsg(null)
    try {
      const next = await downloadLocalVoicePack(packId)
      setInstalledIds(next)
      setLocalTtsVoiceId(packId)
      void prewarmLocalTts(packId)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      setErrorMsg(msg)
      showToast(msg)
    } finally {
      setBusyId(null)
    }
  }

  const handleDelete = async (packId: string) => {
    if (busyId) {
      return
    }
    setBusyId(packId)
    setErrorMsg(null)
    try {
      const next = await deleteLocalVoicePack(packId)
      setInstalledIds(next)
      if (localTtsVoiceId === packId) {
        setLocalTtsVoiceId(next[0] ?? DEFAULT_LOCAL_VOICE_ID)
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      setErrorMsg(msg)
      showToast(msg)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <>
      {activeInstalled && activePack.speakers && activePack.speakers.length > 0 ? (
        <SettingCell
          label={t('settingsTtsSpeaker')}
          status={null}
          action={
            <Select
              ariaLabel={t('settingsTtsSpeaker')}
              value={String(activeSpeakerId)}
              options={activePack.speakers.map((sp) => ({
                value: String(sp.sid),
                label: isEn ? sp.labelEn : sp.labelZh,
              }))}
              onChange={(val) => {
                const sid = Number(val)
                if (Number.isInteger(sid)) {
                  setLocalTtsSpeakerId(sid)
                }
              }}
            />
          }
        />
      ) : null}
      <div className={styles.cell}>
        <div className={styles.text}>
          <span>{t('settingsTtsLocalVoice')}</span>
          {!nativeSupported ? (
            <div className={styles.description}>{t('settingsTtsBrowserHint')}</div>
          ) : null}
          {errorMsg ? <div className={styles.error}>{errorMsg}</div> : null}
        </div>
        <div className={styles.ttsPackList}>
          {LOCAL_VOICE_PACKS.map((pack) => {
            const installed = installedIds.includes(pack.id)
            const selected = localTtsVoiceId === pack.id && installed
            const downloading = busyId === pack.id
            return (
              <div key={pack.id} className={styles.ttsPackItem}>
                <div className={styles.ttsPackInfo}>
                  <span className={styles.ttsPackName}>{isEn ? pack.nameEn : pack.nameZh}</span>
                  <span className={styles.ttsPackMeta}>
                    {pack.sizeMb} MB ·{' '}
                    {installed ? t('settingsTtsInstalledTag') : t('settingsTtsDownload')}
                  </span>
                </div>
                <div className={styles.ttsPackActions}>
                  {installed ? (
                    <Button
                      size="s"
                      variant={selected ? 'primary' : 'outlined'}
                      disabled={selected}
                      onClick={() => {
                        setLocalTtsVoiceId(pack.id)
                        void prewarmLocalTts(pack.id)
                      }}
                    >
                      {selected ? t('settingsTtsActiveTag') : t('settingsTtsUse')}
                    </Button>
                  ) : (
                    <Button
                      size="s"
                      variant="outlined"
                      disabled={!nativeSupported || Boolean(busyId)}
                      onClick={() => void handleDownload(pack.id)}
                    >
                      {downloading ? t('settingsTtsDownloading') : t('settingsTtsDownload')}
                    </Button>
                  )}
                  {installed ? (
                    <Button
                      size="s"
                      variant="outlined"
                      disabled={Boolean(busyId)}
                      onClick={() => void handleDelete(pack.id)}
                    >
                      {t('settingsTtsDelete')}
                    </Button>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}

/** 朗读音色：stella（海星，女声）/ tide（暗潮，男声） */
const TtsVoiceSetting = () => {
  const t = useTranslate()
  const ttsVoice = useSettings((state) => state.ttsVoice)
  return (
    <SettingCell
      label={t('settingsTtsVoice')}
      status={null}
      action={
        <Select
          ariaLabel={t('settingsTtsVoice')}
          value={ttsVoice}
          options={[
            { value: 'stella', label: t('settingsTtsVoiceStella') },
            { value: 'tide', label: t('settingsTtsVoiceTide') },
          ]}
          onChange={setTtsVoice}
        />
      }
    />
  )
}

/** 覆盖导入的二次确认，叠在设置弹窗上 */
const ImportConfirm = ({
  historyImport,
}: {
  historyImport: ReturnType<typeof useHistoryImport>
}) => {
  const t = useTranslate()
  return (
    <Modal
      title={t('historyImportConfirmTitle')}
      className={styles.importConfirm}
      onClose={historyImport.cancel}
      footer={
        <>
          <Button variant="outlined" size="m" autoFocus onClick={historyImport.cancel}>
            {t('cancel')}
          </Button>
          <Button variant="dangerOutlined" size="m" onClick={() => void historyImport.confirm()}>
            {t('historyImportConfirm')}
          </Button>
        </>
      }
    >
      <div className={styles.importConfirmText}>{t('historyImportConfirmDescription')}</div>
    </Modal>
  )
}

const themeOptions: { value: ThemePreference; label: TranslationKey; icon: ReactNode }[] = [
  {
    value: 'light',
    label: 'avatarMenuSettingsDialogThemeSelectLightOption',
    icon: <IconLightOutline16 />,
  },
  {
    value: 'dark',
    label: 'avatarMenuSettingsDialogThemeSelectDarkOption',
    icon: <IconDarkOutline16 />,
  },
  {
    value: 'system',
    label: 'avatarMenuSettingsDialogThemeSelectSystemOption',
    icon: <IconFollowsystemOutline16 />,
  },
]

/**
 * 主题项：标题下方浅色 / 深色 / 跟随系统三个选块。
 * 与下方语言选项连续排列。
 */
const ThemeSetting = () => {
  const t = useTranslate()
  const themePreference = useSettings((state) => state.themePreference)
  const label = t('avatarMenuSettingsDialogThemeItemLabel')
  return (
    <div className={styles.theme}>
      {label}
      <div role="radiogroup" aria-label={label} className={styles.themeOptions}>
        {themeOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={themePreference === option.value}
            className={clsx(
              styles.themeOption,
              themePreference === option.value && styles.themeOptionSelected
            )}
            onClick={() => setThemePreference(option.value)}
          >
            {option.icon}
            {t(option.label)}
          </button>
        ))}
      </div>
    </div>
  )
}

/** `reason` 为失败原因的文案 key，展示时按当前语言翻译后填入 `message` 参数。 */
type Status = (TranslationMessage & { error?: boolean; reason?: TranslationKey }) | null

/** 导出失败附带原因：预期的错误用对应文案作原因，其他错误用错误信息。 */
const errorStatus = (key: TranslationKey, error: unknown): Status => ({
  key,
  ...(error instanceof BackupError
    ? { reason: error.key }
    : { params: { message: error instanceof Error ? error.message : String(error) } }),
  error: true,
})

const SettingCell = ({
  label,
  status,
  action,
  className,
}: {
  label: string
  status: Status
  action: ReactNode
  className?: string
}) => {
  const t = useTranslate()
  return (
    <div className={clsx(styles.cell, styles.row, className)}>
      <div className={styles.text}>
        <div className={styles.label}>{label}</div>
        {status ? (
          <div className={clsx(styles.description, status.error && styles.error)}>
            {t(status.key, status.reason ? { message: t(status.reason) } : status.params)}
          </div>
        ) : null}
      </div>
      {action}
    </div>
  )
}

/** 选文件后先提示覆盖；确认后才检查文件并执行导入，任何错误都提示导入失败。 */
const useHistoryImport = () => {
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status>(null)
  const importing = useRef(false)

  const confirm = async () => {
    if (!file || importing.current) {
      return
    }
    importing.current = true
    setFile(null)
    setBusy(true)
    setStatus(null)
    try {
      const count = await importHistory(file)
      const key = count === 1 ? 'historyImportedOne' : 'historyImported'
      const params = { count }
      setStatus({ key, params })
      showToast({ key, params })
    } catch {
      setStatus({ key: 'historyImportFailed', error: true })
      showToast({ key: 'historyImportFailed', type: 'error' })
    } finally {
      importing.current = false
      setBusy(false)
    }
  }

  return { file, busy, status, select: setFile, cancel: () => setFile(null), confirm }
}

/** 导入 = 覆盖：用选中文件替换本地全部会话与附件。 */
const ImportHistory = ({
  historyImport,
  disabled,
}: {
  historyImport: ReturnType<typeof useHistoryImport>
  disabled: boolean
}) => {
  const t = useTranslate()
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <SettingCell
      label={t('historyImport')}
      status={historyImport.status}
      action={
        <>
          <Button
            variant="outlined"
            size="m"
            className={clsx(styles.cellButton, styles.uploadButton)}
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
          >
            <IconUploadOutline14 />
            {t('upload')}
          </Button>
          <input
            ref={inputRef}
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
                historyImport.select(file)
              }
            }}
          />
        </>
      }
    />
  )
}

/** 将全部会话及图片导出为 ZIP 文件并下载 */
const ExportHistory = ({ disabled }: { disabled: boolean }) => {
  const t = useTranslate()
  const empty = useChatStore((state) => state.sessions.length === 0)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status>(null)

  const onExport = async () => {
    setBusy(true)
    setStatus(null)
    try {
      const { name, blob } = await exportHistory()
      await exportBlobFile(name, blob)
    } catch (error) {
      setStatus(errorStatus('historyExportFailed', error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingCell
      label={t('exportAllLabel')}
      status={status}
      action={
        <Button
          variant="outlined"
          size="m"
          className={styles.cellButton}
          disabled={disabled || busy || empty}
          onClick={() => void onExport()}
        >
          <IconDownloadOutline16 />
          {t('exportAllDownload')}
        </Button>
      }
    />
  )
}
