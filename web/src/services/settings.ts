import { create } from 'zustand'
import type { TtsVoice } from './api/speech.js'
import { normalizeLocation, type UserLocation } from './location.js'

export type Locale = 'zh-CN' | 'en-US'

/** 主题偏好；默认跟随系统 */
export type ThemePreference = 'light' | 'dark' | 'system'

export type ChatBgPreset = 'none' | 'ocean' | 'warm' | 'aurora' | 'mint' | 'custom'

export const FONT_SCALE_STEPS = [0.9, 0.95, 1, 1.08, 1.16, 1.25] as const

/** 本机设置，存 localStorage：API Key、语言、主题、位置、朗读音色、字体、背景等 */
type Settings = {
  apiKey: string | null
  locale: Locale
  themePreference: ThemePreference
  location: UserLocation | null
  voiceEnabled: boolean
  voiceAutoPlay: boolean
  ttsVoice: TtsVoice
  fontFollowSystem: boolean
  fontScale: number
  chatBgPreset: ChatBgPreset
  chatBgImage: string
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
  cacheModeEnabled: boolean
  cacheBackendUrl: string
  compactionAuto: boolean
  compactionLevel: 'light' | 'medium' | 'heavy'
}

const KEYS = {
  apiKey: 'chat-demo:api-key',
  locale: 'chat-demo:locale',
  location: 'chat-demo:location',
  themePreference: 'chat-demo:theme-preference',
  voiceEnabled: 'chat-demo:voice-enabled',
  voiceAutoPlay: 'chat-demo:voice-auto-play',
  ttsVoice: 'chat-demo:tts-voice',
  fontFollowSystem: 'chat-demo:font-follow-system',
  fontScale: 'chat-demo:font-scale',
  chatBgPreset: 'chat-demo:chat-bg-preset',
  chatBgImage: 'chat-demo:chat-bg-image',
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
  cacheModeEnabled: 'chat-demo:cache-mode',
  cacheBackendUrl: 'chat-demo:cache-backend-url',
  compactionAuto: 'chat-demo:compaction-auto',
  compactionLevel: 'chat-demo:compaction-level',
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

const initialFontScale = (): number => {
  const n = Number(read(KEYS.fontScale))
  return FONT_SCALE_STEPS.includes(n as (typeof FONT_SCALE_STEPS)[number]) ? n : 1
}

const initialChatBgPreset = (): ChatBgPreset => {
  const saved = read(KEYS.chatBgPreset)
  if (
    saved === 'ocean' ||
    saved === 'warm' ||
    saved === 'aurora' ||
    saved === 'mint' ||
    saved === 'custom'
  ) {
    return saved
  }
  return 'none'
}

export const useSettings = create<Settings>(() => ({
  apiKey: read(KEYS.apiKey),
  locale: initialLocale(),
  location: initialLocation(),
  themePreference: initialThemePreference(),
  voiceEnabled: read(KEYS.voiceEnabled) === 'true',
  voiceAutoPlay: read(KEYS.voiceAutoPlay) === 'true',
  ttsVoice: initialTtsVoice(),
  fontFollowSystem: read(KEYS.fontFollowSystem) !== 'false',
  fontScale: initialFontScale(),
  chatBgPreset: initialChatBgPreset(),
  chatBgImage: read(KEYS.chatBgImage) ?? '',
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
  cacheModeEnabled: read(KEYS.cacheModeEnabled) !== 'false',
  cacheBackendUrl: read(KEYS.cacheBackendUrl) || 'http://127.0.0.1:8787',
  compactionAuto: read(KEYS.compactionAuto) !== 'false',
  compactionLevel: (read(KEYS.compactionLevel) as 'light' | 'medium' | 'heavy' | null) || 'light',
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

export const setVoiceAutoPlay = (voiceAutoPlay: boolean) => {
  write(KEYS.voiceAutoPlay, String(voiceAutoPlay))
  useSettings.setState({ voiceAutoPlay })
}

export const setTtsVoice = (ttsVoice: TtsVoice) => {
  write(KEYS.ttsVoice, ttsVoice)
  useSettings.setState({ ttsVoice })
}

export const applyFontScale = (scale: number) => {
  if (typeof document === 'undefined') {
    return
  }
  document.documentElement.style.setProperty('--ds-font-scale', String(scale))
  const body = document.body
  body.style.setProperty('--ds-font-size-m', `${Math.round(14 * scale)}px`)
  body.style.setProperty(
    '--dsw-font-markdown-base',
    `${Math.round(16 * scale)}px/${Math.round(28 * scale)}px var(--dsw-font-family)`
  )
  body.style.setProperty(
    '--dsw-font-markdown-base-strong',
    `600 ${Math.round(16 * scale)}px/${Math.round(28 * scale)}px var(--dsw-font-family)`
  )
  body.style.setProperty(
    '--dsw-font-markdown-h1',
    `700 ${Math.round(24 * scale)}px/${Math.round(34 * scale)}px var(--dsw-font-family)`
  )
  body.style.setProperty(
    '--dsw-font-markdown-h2',
    `700 ${Math.round(22 * scale)}px/${Math.round(32 * scale)}px var(--dsw-font-family)`
  )
  body.style.setProperty(
    '--dsw-font-markdown-h3',
    `700 ${Math.round(20 * scale)}px/${Math.round(30 * scale)}px var(--dsw-font-family)`
  )
  body.style.setProperty(
    '--dsw-font-markdown-h4',
    `600 ${Math.round(16 * scale)}px/${Math.round(28 * scale)}px var(--dsw-font-family)`
  )
  body.style.setProperty(
    '--dsw-font-markdown-small',
    `${Math.round(14 * scale)}px/${Math.round(24 * scale)}px var(--dsw-font-family)`
  )
}

export const setupFontScale = () => {
  const sync = () => {
    const { fontFollowSystem, fontScale } = useSettings.getState()
    applyFontScale(fontFollowSystem ? 1 : fontScale)
  }
  sync()
  useSettings.subscribe(sync)
}

export const setFontFollowSystem = (fontFollowSystem: boolean) => {
  write(KEYS.fontFollowSystem, String(fontFollowSystem))
  useSettings.setState({ fontFollowSystem })
}

export const setFontScale = (fontScale: number) => {
  write(KEYS.fontScale, String(fontScale))
  useSettings.setState({ fontFollowSystem: false, fontScale })
  write(KEYS.fontFollowSystem, 'false')
}

export const setChatBgPreset = (chatBgPreset: ChatBgPreset) => {
  write(KEYS.chatBgPreset, chatBgPreset)
  useSettings.setState({ chatBgPreset })
}

export const setChatBgImage = (chatBgImage: string) => {
  write(KEYS.chatBgImage, chatBgImage || null)
  if (chatBgImage) {
    write(KEYS.chatBgPreset, 'custom')
    useSettings.setState({ chatBgPreset: 'custom', chatBgImage })
  } else {
    write(KEYS.chatBgPreset, 'none')
    useSettings.setState({ chatBgPreset: 'none', chatBgImage: '' })
  }
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

export const setCacheModeEnabled = (cacheModeEnabled: boolean) => {
  write(KEYS.cacheModeEnabled, String(cacheModeEnabled))
  useSettings.setState({ cacheModeEnabled })
}

export const setCacheBackendUrl = (cacheBackendUrl: string) => {
  const cleaned = cacheBackendUrl.trim().replace(/\/+$/, '')
  write(KEYS.cacheBackendUrl, cleaned || null)
  useSettings.setState({ cacheBackendUrl: cleaned || 'http://127.0.0.1:8787' })
}

export type CompactionLevel = 'light' | 'medium' | 'heavy'

export const setCompactionAuto = (compactionAuto: boolean) => {
  write(KEYS.compactionAuto, String(compactionAuto))
  useSettings.setState({ compactionAuto })
}

export const setCompactionLevel = (compactionLevel: CompactionLevel) => {
  write(KEYS.compactionLevel, compactionLevel)
  useSettings.setState({ compactionLevel })
}
