import { useEffect, type CSSProperties } from 'react'
import { useTranslate } from '../i18n/index.js'
import { useSettings, waitForApiKeyHydration, type ChatBgPreset } from '../services/settings.js'
import { useIsMobile, useMobileViewport, usePreventPageScroll } from './viewport.js'
import {
  bindChatPersistence,
  initChat,
  retrySaveSessions,
  selectSession,
  useChatStore,
} from '../services/chat/store.js'
import { SearchPanel } from '../components/search/SearchPanel.js'
import { closeSearchPanel } from '../components/search/searchPanelState.js'
import { GameDrawer } from '../game/GameDrawer.js'
import { useGameStore } from '../game/store.js'
import { PetOverlay } from '../pet/PetOverlay.js'
import { PetChatroomDrawer } from '../pet/PetChatroomDrawer.js'
import { SessionView } from '../components/session/SessionView.js'
import { MobileHeader } from '../components/session/MobileHeader.js'
import { Welcome } from '../components/session/Welcome.js'
import { ensureApiKey } from '../components/settings/settingsDialogState.js'
import { Onboarding } from '../components/onboarding/Onboarding.js'
import { hasSkippedOnboarding } from '../components/onboarding/onboardingState.js'
import { SettingsDialog } from '../components/settings/SettingsDialog.js'
import { bindBalanceAutoRefresh } from '../services/balance.js'
import { checkForUpdates } from '../services/update.js'
import { Toast } from '../components/base/Toast.js'
import { showToast } from '../components/base/toastState.js'
import { onUploadNotice } from '../services/attachments.js'
import { Button } from '../components/base/Button.js'
import { prewarmLocalTts } from '../services/speech/localTts.js'
import { stopReadAloud } from '../services/speech/readAloud.js'
import { CollapsedSider } from '../components/sider/CollapsedSider.js'
import { closeMobileSider } from '../components/sider/mobileSiderState.js'
import { MobileSider, Sider } from '../components/sider/Sider.js'
import styles from './App.module.css'

const PRESET_BG_STYLES: Record<Exclude<ChatBgPreset, 'none' | 'custom'>, string> = {
  ocean:
    'radial-gradient(circle at 20% 20%, rgba(56, 189, 248, 0.16), transparent 55%), radial-gradient(circle at 80% 75%, rgba(77, 107, 254, 0.16), transparent 60%)',
  warm: 'linear-gradient(145deg, rgba(251, 191, 36, 0.14) 0%, rgba(244, 114, 182, 0.10) 100%)',
  aurora:
    'radial-gradient(circle at 75% 20%, rgba(52, 211, 153, 0.16), transparent 55%), radial-gradient(circle at 25% 80%, rgba(167, 139, 250, 0.16), transparent 55%)',
  mint: 'linear-gradient(160deg, rgba(16, 185, 129, 0.13) 0%, rgba(59, 130, 246, 0.08) 100%)',
}

const resolveChatBgStyle = (
  preset: ChatBgPreset,
  image: string,
  opacity: number
): CSSProperties | null => {
  if (preset === 'none') {
    return null
  }
  if (preset === 'custom') {
    if (!image) {
      return null
    }
    return {
      backgroundImage: `url(${image})`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      opacity,
    }
  }
  return { backgroundImage: PRESET_BG_STYLES[preset] }
}

export const App = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const locale = useSettings((state) => state.locale)
  const chatBgPreset = useSettings((state) => state.chatBgPreset)
  const chatBgImage = useSettings((state) => state.chatBgImage)
  const chatBgOpacity = useSettings((state) => state.chatBgOpacity)
  const chatBgStyle = resolveChatBgStyle(chatBgPreset, chatBgImage, chatBgOpacity)
  // 移动端侧边栏以独立抽屉管理开合状态
  const siderCollapsed = useSettings((state) => state.siderCollapsed) && !isMobile
  const ready = useChatStore((state) => state.ready)
  const initError = useChatStore((state) => state.initError)
  const saveError = useChatStore((state) => Object.values(state.sessionSaveErrors).some(Boolean))
  const importingHistory = useChatStore((state) => state.importingHistory)
  const session = useChatStore((state) =>
    state.activeId !== null && Object.hasOwn(state.sessionCache, state.activeId)
      ? state.sessionCache[state.activeId]
      : undefined
  )
  const sessionLoadError = useChatStore((state) =>
    state.activeId === null ? false : state.sessionLoadErrors[state.activeId] === true
  )
  const frameRef = useMobileViewport(isMobile)
  const streaming = useChatStore((state) =>
    state.activeId === null ? false : Object.hasOwn(state.streaming, state.activeId)
  )
  const activeId = useChatStore((state) => state.activeId)
  const gameDrawerOpen = useGameStore((state) => state.drawerOpen)

  usePreventPageScroll(isMobile)

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  // 文件数、存储空间达到上限时，附件上只显示「上传失败」，原因用 toast 说明
  useEffect(() => onUploadNotice(showToast), [])
  useEffect(bindChatPersistence, [])
  useEffect(bindBalanceAutoRefresh, [])

  // 搜索结果面板只属于当前会话
  useEffect(closeSearchPanel, [activeId])
  useEffect(() => {
    if (gameDrawerOpen) {
      closeSearchPanel()
    }
  }, [gameDrawerOpen])
  // 切换会话时停止朗读
  useEffect(stopReadAloud, [activeId])
  // 移动端选中会话、切换布局后收起抽屉
  useEffect(closeMobileSider, [activeId, isMobile])

  useEffect(() => {
    void initChat()
    // 原生端先等待 Android Keystore 读取/迁移 API Key 完成，再判断是否需要弹出引导
    void waitForApiKeyHydration().then(() => {
      if (!hasSkippedOnboarding()) {
        ensureApiKey()
      }
    })
    void checkForUpdates(false)
    const prewarmTimer = window.setTimeout(() => {
      const { voiceEnabled, ttsEngine, localTtsVoiceId } = useSettings.getState()
      if (voiceEnabled && ttsEngine === 'local-sherpa') {
        void prewarmLocalTts(localTtsVoiceId)
      }
    }, 800)
    return () => {
      window.clearTimeout(prewarmTimer)
    }
  }, [])

  return (
    <>
      <div ref={frameRef} className={styles.frame}>
        {isMobile ? <MobileSider /> : siderCollapsed ? null : <Sider />}
        <main className={styles.main}>
          {saveError ? (
            <div className={styles.saveError} role="alert">
              <span>{t('sessionSaveFailed')}</span>
              <Button
                variant="outlined"
                size="s"
                disabled={importingHistory}
                onClick={retrySaveSessions}
              >
                {t('retry')}
              </Button>
            </div>
          ) : null}
          <div className={styles.content}>
            {chatBgStyle ? (
              <div className={styles.chatBgLayer} style={chatBgStyle} aria-hidden="true" />
            ) : null}
            {siderCollapsed ? <CollapsedSider /> : null}
            {!ready || (activeId !== null && !session) ? (
              <div className={styles.loadingView}>
                {isMobile ? <MobileHeader /> : null}
                <div className={styles.loadingState} role="status" aria-live="polite">
                  <span>
                    {(!ready ? initError : sessionLoadError)
                      ? t(!ready ? 'sessionListLoadFailed' : 'sessionLoadFailed')
                      : t('sessionLoading')}
                  </span>
                  {(!ready ? initError : sessionLoadError) ? (
                    <Button
                      variant="outlined"
                      size="m"
                      onClick={() => {
                        if (!ready) {
                          void initChat()
                        } else if (activeId !== null) {
                          selectSession(activeId)
                        }
                      }}
                    >
                      {t('retry')}
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : session ? (
              <SessionView
                session={session}
                streaming={streaming}
                siderCollapsed={siderCollapsed}
              />
            ) : (
              <Welcome />
            )}
          </div>
        </main>
        <SearchPanel />
        <GameDrawer />
      </div>
      <Onboarding />
      <SettingsDialog />
      <PetOverlay />
      <PetChatroomDrawer />
      <Toast />
    </>
  )
}
