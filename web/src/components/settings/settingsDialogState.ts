import { create } from 'zustand'
import { flushPendingExtracts } from '../../services/memory/extract.js'
import { hasConfiguredActiveApi, useSettings } from '../../services/settings.js'
import { openOnboarding } from '../onboarding/onboardingState.js'

/** 设置弹窗的分组：通用设置 / 桌宠 / 人设 / 记忆 / 数据管理 */
export type SettingsSection = 'general' | 'pet' | 'persona' | 'memory' | 'data'

/** 设置弹窗：侧边栏底部、没有 API Key 时的操作与 401 提示都可以打开；section 为打开时选中的分组 */
export const useSettingsDialog = create(() => ({
  open: false,
  section: 'general' as SettingsSection,
}))

export const openSettings = (section: SettingsSection) => {
  flushPendingExtracts()
  useSettingsDialog.setState({ open: true, section })
}

export const closeSettings = () => useSettingsDialog.setState({ open: false })

/** 没有配置当前启用的接口密钥时，自定义模式跳转到数据设置，官方模式打开首次引导页 */
export const ensureApiKey = () => {
  if (hasConfiguredActiveApi()) {
    return true
  }
  if (useSettings.getState().apiProvider === 'custom') {
    openSettings('data')
    return false
  }
  openOnboarding()
  return false
}
