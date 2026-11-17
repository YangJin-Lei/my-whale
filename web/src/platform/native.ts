import { App } from '@capacitor/app'
import { Browser } from '@capacitor/browser'
import { Clipboard } from '@capacitor/clipboard'
import { Capacitor } from '@capacitor/core'
import { closeSearchPanel, useSearchPanel } from '../components/search/searchPanelState.js'
import { closeSettings, useSettingsDialog } from '../components/settings/settingsDialogState.js'
import { closeMobileSider, useMobileSider } from '../components/sider/mobileSiderState.js'
import { refreshBalance } from '../services/balance.js'
import { newChat, useChatStore } from '../services/chat/store.js'
import { extractApiKey, setClipboardReader } from '../services/clipboard.js'
import { setOpenExternal } from '../services/links.js'
import { flushPendingExtracts } from '../services/memory/extract.js'
import { useSettings } from '../services/settings.js'

const onReturnFromExternal = async () => {
  void refreshBalance()
  if (useSettings.getState().apiKey) {
    return
  }
  const { value } = await Clipboard.read().catch(() => ({ value: '' }))
  const key = extractApiKey(value)
  if (key) {
    window.dispatchEvent(new CustomEvent('mywhale:clipboard-key', { detail: key }))
  }
}

type TauriInternals = {
  invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>
}

export const setupNative = () => {
  const tauri = (window as Window & { __TAURI_INTERNALS__?: TauriInternals }).__TAURI_INTERNALS__
  if (tauri?.invoke) {
    setOpenExternal((url) => {
      void tauri.invoke?.('open_external_url', { url }).catch(() => {
        window.open(url, '_blank', 'noopener,noreferrer')
      })
    })
    return
  }

  if (!Capacitor.isNativePlatform()) {
    return
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
