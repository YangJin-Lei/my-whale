import { create } from 'zustand'
import type { TtsVoice } from './api/speech.js'
import { normalizeLocation, type UserLocation } from './location.js'

export type Locale = 'zh-CN' | 'en-US'

/** 主题偏好；默认跟随系统 */
export type ThemePreference = 'light' | 'dark' | 'system'

/** 本机设置，存 localStorage：API Key、语言、主题、位置、朗读音色、深度思考与智能搜索开关、侧边栏收起状态、关于我、记忆开关、默认人设 */
type Settings = {
  apiKey: string | null
  locale: Locale
  themePreference: ThemePreference
  location: UserLocation | null
  voiceEnabled: boolean
  ttsVoice: TtsVoice
  thinking: boolean
  search: boolean
  siderCollapsed: boolean
  profile: string
  memoryEnabled: boolean
  memoryAuto: boolean
  memoryNoticeShown: boolean
  defaultPersonaId: string
  petEnabled: boolean
  activePetId: string
  updateAccelerate: boolean
  updateMirror: string
}

const KEYS = {
  apiKey: 'chat-demo:api-key',
  locale: 'chat-demo:locale',
  location: 'chat-demo:location',
  themePreference: 'chat-demo:theme-preference',
  voiceEnabled: 'chat-demo:voice-enabled',
  ttsVoice: 'chat-demo:tts-voice',
  thinking: 'chat-demo:thinking',
  search: 'chat-demo:search',
  siderCollapsed: 'chat-demo:sider-collapsed',
  profile: 'chat-demo:profile',
  memoryEnabled: 'chat-demo:memory-enabled',
  memoryAuto: 'chat-demo:memory-auto',
  memoryNoticeShown: 'chat-demo:memory-notice-shown',
  defaultPersonaId: 'chat-demo:default-persona-id',
  petEnabled: 'chat-demo:pet-enabled',
  activePetId: 'chat-demo:active-pet-id',
  updateAccelerate: 'chat-demo:update-accelerate',
  updateMirror: 'chat-demo:update-mirror',
} as const

const read = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const write = (key: string, value: string | null) => {
  try {
    if (value === null) {
      localStorage.removeItem(key)
    } else {
      localStorage.setItem(key, value)
    }
  } catch {
    // 存储不可用时只在内存中生效
  }
}

/** 位置选择模式跟随浏览器语言，与应用内选择的界面语言无关。 */
export const isChineseBrowser = (): boolean =>
  (typeof navigator === 'undefined' ? 'zh' : navigator.language).toLowerCase().startsWith('zh')

const initialLocale = (): Locale => {
  const saved = read(KEYS.locale)
  if (saved === 'zh-CN' || saved === 'en-US') {
    return saved
  }
  return isChineseBrowser() ? 'zh-CN' : 'en-US'
}

const initialLocation = (): UserLocation | null => {
  try {
    const location = normalizeLocation(JSON.parse(read(KEYS.location) ?? 'null'))
    if (!location) {
      return null
    }
    return isChineseBrowser()
      ? location.region === 'CN' && location.province
        ? location
        : null
      : { region: location.region }
  } catch {
    return null
  }
}

/** 未保存过时跟随系统 */
const initialThemePreference = (): ThemePreference => {
  const saved = read(KEYS.themePreference)
  return saved === 'light' || saved === 'dark' ? saved : 'system'
}

/** 未保存过时使用服务端默认音色 stella（海星） */
const initialTtsVoice = (): TtsVoice => (read(KEYS.ttsVoice) === 'tide' ? 'tide' : 'stella')

export const useSettings = create<Settings>(() => ({
  apiKey: read(KEYS.apiKey),
  locale: initialLocale(),
  location: initialLocation(),
  themePreference: initialThemePreference(),
  voiceEnabled: read(KEYS.voiceEnabled) === 'true',
  ttsVoice: initialTtsVoice(),
  thinking: read(KEYS.thinking) === 'true',
  search: read(KEYS.search) === 'true',
  siderCollapsed: read(KEYS.siderCollapsed) === 'true',
  profile: read(KEYS.profile) ?? '',
  memoryEnabled: read(KEYS.memoryEnabled) !== 'false',
  memoryAuto: read(KEYS.memoryAuto) !== 'false',
  memoryNoticeShown: read(KEYS.memoryNoticeShown) === 'true',
  defaultPersonaId: read(KEYS.defaultPersonaId) || 'builtin-default',
  petEnabled: read(KEYS.petEnabled) !== 'false',
  activePetId: read(KEYS.activePetId) || 'nailong',
  updateAccelerate:
    read(KEYS.updateAccelerate) !== null
      ? read(KEYS.updateAccelerate) === 'true'
      : isChineseBrowser(),
  updateMirror: read(KEYS.updateMirror) || 'https://ghfast.top/',
}))

export const setLocale = (locale: Locale) => {
  write(KEYS.locale, locale)
  useSettings.setState({ locale })
}

export const setLocation = (value: UserLocation | null) => {
  const location = normalizeLocation(value)
  write(KEYS.location, location ? JSON.stringify(location) : null)
  useSettings.setState({ location })
}

export const setThemePreference = (themePreference: ThemePreference) => {
  write(KEYS.themePreference, themePreference)
  useSettings.setState({ themePreference })
}

export const setVoiceEnabled = (voiceEnabled: boolean) => {
  write(KEYS.voiceEnabled, String(voiceEnabled))
  useSettings.setState({ voiceEnabled })
}

export const setTtsVoice = (ttsVoice: TtsVoice) => {
  write(KEYS.ttsVoice, ttsVoice)
  useSettings.setState({ ttsVoice })
}

export const setApiKey = (apiKey: string | null) => {
  write(KEYS.apiKey, apiKey)
  useSettings.setState({ apiKey })
}

export const setThinking = (thinking: boolean) => {
  write(KEYS.thinking, String(thinking))
  useSettings.setState({ thinking })
}

export const setSearch = (search: boolean) => {
  write(KEYS.search, String(search))
  useSettings.setState({ search })
}

export const setSiderCollapsed = (siderCollapsed: boolean) => {
  write(KEYS.siderCollapsed, String(siderCollapsed))
  useSettings.setState({ siderCollapsed })
}

export const setProfile = (profile: string) => {
  write(KEYS.profile, profile || null)
  useSettings.setState({ profile })
}

export const setMemoryEnabled = (memoryEnabled: boolean) => {
  write(KEYS.memoryEnabled, String(memoryEnabled))
  useSettings.setState({ memoryEnabled })
}

export const setMemoryAuto = (memoryAuto: boolean) => {
  write(KEYS.memoryAuto, String(memoryAuto))
  useSettings.setState({ memoryAuto })
}

export const setMemoryNoticeShown = (memoryNoticeShown: boolean) => {
  write(KEYS.memoryNoticeShown, String(memoryNoticeShown))
  useSettings.setState({ memoryNoticeShown })
}

export const setDefaultPersonaId = (defaultPersonaId: string) => {
  write(KEYS.defaultPersonaId, defaultPersonaId || 'builtin-default')
  useSettings.setState({ defaultPersonaId: defaultPersonaId || 'builtin-default' })
}

export const setPetEnabled = (petEnabled: boolean) => {
  write(KEYS.petEnabled, String(petEnabled))
  useSettings.setState({ petEnabled })
}

export const setActivePetId = (activePetId: string) => {
  write(KEYS.activePetId, activePetId || 'nailong')
  useSettings.setState({ activePetId: activePetId || 'nailong' })
}

export const setUpdateAccelerate = (updateAccelerate: boolean) => {
  write(KEYS.updateAccelerate, String(updateAccelerate))
  useSettings.setState({ updateAccelerate })
}

export const setUpdateMirror = (updateMirror: string) => {
  const cleaned = updateMirror.trim()
  write(KEYS.updateMirror, cleaned || null)
  useSettings.setState({ updateMirror: cleaned || 'https://ghfast.top/' })
}
