import { App } from '@capacitor/app'
import { Browser } from '@capacitor/browser'
import { Clipboard } from '@capacitor/clipboard'
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import { closeSearchPanel, useSearchPanel } from '../components/search/searchPanelState.js'
import { closeSettings, useSettingsDialog } from '../components/settings/settingsDialogState.js'
import { closeMobileSider, useMobileSider } from '../components/sider/mobileSiderState.js'
import { refreshBalance } from '../services/balance.js'
import {
  setNativeCacheController,
  startNativeOrProbeCacheBackend,
} from '../services/cacheBackend.js'
import { newChat, useChatStore } from '../services/chat/store.js'
import { extractApiKey, setClipboardReader, setClipboardWriter } from '../services/clipboard.js'
import {
  DEEPSEEK_CHAT_URL,
  openExternal,
  setOpenDeepSeek,
  setOpenExternal,
} from '../services/links.js'
import { flushPendingExtracts } from '../services/memory/extract.js'
import { setNativeSecureStorage } from '../services/secureStorage.js'
import { hasConfiguredActiveApi, hydrateNativeApiKey, useSettings } from '../services/settings.js'
import {
  registerInAppUpdater,
  retryPendingInstall,
  setNativeAppInfo,
  useUpdateStore,
  type InAppUpdateOutcome,
  type NativeAppInfo,
} from '../services/update.js'

const onReturnFromExternal = async () => {
  if (useUpdateStore.getState().downloadStatus === 'needs_permission') {
    void retryPendingInstall()
  }
  void refreshBalance()
  if (hasConfiguredActiveApi()) {
    return
  }
  const { value } = await Clipboard.read().catch(() => ({ value: '' }))
  const key = extractApiKey(value)
  if (key) {
    window.dispatchEvent(new CustomEvent('mywhale:clipboard-key', { detail: key }))
  }
}

type TauriInternals = {
  invoke?: <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>
}

type AppUpdaterNativePlugin = {
  downloadAndInstall: (options: {
    tag?: string
    expectedSha256?: string
    urls: string[]
  }) => Promise<{ status: InAppUpdateOutcome }>
  installPending: () => Promise<{ status: InAppUpdateOutcome }>
  getAppInfo?: () => Promise<NativeAppInfo>
  openDeepSeekApp?: () => Promise<{ launched: boolean }>
  addListener: (
    eventName: 'downloadProgress',
    listener: (payload: { progress: number; received: number; total: number }) => void
  ) => Promise<PluginListenerHandle>
}

const AppUpdater = registerPlugin<AppUpdaterNativePlugin>('AppUpdater')

type SecureStorageNativePlugin = {
  getSecret: (options: { key: string }) => Promise<{ value: string | null; backend?: string }>
  setSecret: (options: { key: string; value: string | null }) => Promise<void>
  status?: () => Promise<{ available: boolean; backend?: string }>
}

const SecureStorage = registerPlugin<SecureStorageNativePlugin>('SecureStorage')

type CacheBackendNativePlugin = {
  start: (options?: { port?: number }) => Promise<{ running: boolean; url?: string }>
  stop: () => Promise<{ running: boolean }>
  status: () => Promise<{ running: boolean }>
}

const CacheBackend = registerPlugin<CacheBackendNativePlugin>('CacheBackend')

export const setupNative = () => {
  const tauri = (window as Window & { __TAURI_INTERNALS__?: TauriInternals }).__TAURI_INTERNALS__
  if (tauri?.invoke) {
    const invoke = tauri.invoke
    setNativeCacheController({
      start: async (port) => {
        const res = await invoke<{ running: boolean; url?: string }>('start_cache_server', { port })
        return res
      },
      stop: async () => {
        await invoke('stop_cache_server')
      },
      status: async () => invoke<{ running: boolean }>('get_cache_server_status'),
    })
    if (useSettings.getState().cacheModeEnabled) {
      void startNativeOrProbeCacheBackend()
    }
    setOpenExternal((url) => {
      void tauri.invoke?.('open_external_url', { url }).catch(() => {
        window.open(url, '_blank', 'noopener,noreferrer')
      })
    })
    registerInAppUpdater({
      downloadAndInstall: async ({ tag, assets }, onProgress) => {
        if (!invoke) {
          throw new Error('Tauri bridge unavailable')
        }
        const target = await invoke<string>('get_desktop_target').catch(() => 'windows')
        const urls = target === 'macos' ? assets.macosUrls : assets.windowsUrls
        const ver = tag.replace(/^v/i, '')
        const fileName =
          target === 'macos' ? `my-whale_${ver}_aarch64.dmg` : `my-whale_${ver}_x64-setup.exe`
        const pollTimer = window.setInterval(() => {
          void invoke<{ active: boolean; progress: number }>('get_update_progress')
            .then((info) => {
              if (info.active) {
                onProgress(info.progress >= 0 ? info.progress : null)
              }
            })
            .catch(() => {})
        }, 250)
        try {
          await invoke('download_and_install_update', { urls, fileName })
          onProgress(100)
          return 'installer_opened'
        } finally {
          window.clearInterval(pollTimer)
        }
      },
    })
    return
  }

  if (!Capacitor.isNativePlatform()) {
    return
  }

  if (Capacitor.getPlatform() === 'android') {
    setNativeSecureStorage({
      getSecret: (key) => SecureStorage.getSecret({ key }),
      setSecret: (key, value) => SecureStorage.setSecret({ key, value }),
      status: () =>
        SecureStorage.status ? SecureStorage.status() : Promise.resolve({ available: true }),
    })
    void hydrateNativeApiKey()
    void AppUpdater.getAppInfo?.()
      .then((info) => {
        if (info?.versionName) {
          setNativeAppInfo(info)
        }
      })
      .catch(() => {})
    setNativeCacheController({
      start: (port) => CacheBackend.start({ port }),
      stop: async () => {
        await CacheBackend.stop()
      },
      status: () => CacheBackend.status(),
    })
    if (useSettings.getState().cacheModeEnabled) {
      void startNativeOrProbeCacheBackend()
    }
    registerInAppUpdater({
      downloadAndInstall: async ({ tag, assets }, onProgress) => {
        const handle = await AppUpdater.addListener('downloadProgress', (payload) => {
          onProgress(payload.progress >= 0 ? payload.progress : null)
        })
        try {
          const res = await AppUpdater.downloadAndInstall({
            tag,
            ...(assets.androidSha256 ? { expectedSha256: assets.androidSha256 } : {}),
            urls: assets.androidUrls,
          })
          return res.status
        } finally {
          await handle.remove()
        }
      },
      installPending: async () => {
        const res = await AppUpdater.installPending()
        return res.status
      },
    })
    setOpenDeepSeek(async () => {
      const res = await AppUpdater.openDeepSeekApp?.().catch(() => ({ launched: false }))
      if (!res?.launched) {
        openExternal(DEEPSEEK_CHAT_URL)
      }
    })
  }

  setOpenExternal((url) => {
    void Browser.open({ url, presentationStyle: 'popover' }).catch(() => {
      window.open(url, '_blank', 'noopener,noreferrer')
    })
  })
  setClipboardReader(() =>
    Clipboard.read()
      .then((res) => res.value ?? null)
      .catch(() => null)
  )
  setClipboardWriter((string) => Clipboard.write({ string }))

  void Browser.addListener('browserFinished', () => void onReturnFromExternal())
  void App.addListener('resume', () => void onReturnFromExternal())
  void App.addListener('pause', () => {
    flushPendingExtracts()
  })

  void App.addListener('backButton', ({ canGoBack }) => {
    // 1. 优先关闭抽屉 / 搜索面板 / 设置弹窗 / 其他顶层 Modal
    if (useMobileSider.getState().open) {
      closeMobileSider()
      return
    }
    if (useSearchPanel.getState().entry !== null) {
      closeSearchPanel()
      return
    }
    if (useSettingsDialog.getState().open) {
      closeSettings()
      return
    }
    const openDialog = document.querySelector('[role="dialog"]')
    if (openDialog) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      return
    }
    // 2. 会话页返回欢迎页
    if (useChatStore.getState().activeId !== null) {
      newChat()
      return
    }
    if (canGoBack) {
      window.history.back()
      return
    }
    void App.exitApp()
  })
}
