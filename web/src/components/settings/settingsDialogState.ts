import { create } from 'zustand'
import { useSettings } from '../../services/settings.js'
import { openOnboarding } from '../onboarding/onboardingState.js'

/** 设置弹窗的分组：通用设置 / 人设 / 记忆 / 数据管理 */
export type SettingsSection = 'general' | 'persona' | 'memory' | 'data'

/** 设置弹窗：侧边栏底部、没有 API Key 时的操作与 401 提示都可以打开；section 为打开时选中的分组 */
export const useSettingsDialog = create(() => ({
  open: false,
  section: 'general' as SettingsSection,
}))

export const openSettings = (section: SettingsSection) =>
  useSettingsDialog.setState({ open: true, section })

export const closeSettings = () => useSettingsDialog.setState({ open: false })

/** 没有 API Key 时打开首次引导页，返回是否已有 Key */
export const ensureApiKey = () => {
  if (useSettings.getState().apiKey) {
    return true
  }
  openOnboarding()
  return false
}
