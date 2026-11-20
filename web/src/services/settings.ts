import { create } from 'zustand'
import {
  API_KEY_SECRET_ID,
  CUSTOM_API_KEY_SECRET_ID,
  hasNativeSecureStorage,
  loadSecureSecret,
  saveSecureSecret,
} from './secureStorage.js'
import type { TtsVoice } from './api/speech.js'
import { normalizeLocation, type UserLocation } from './location.js'

export type Locale = 'zh-CN' | 'en-US'

/** 主题偏好；默认跟随系统 */
export type ThemePreference = 'light' | 'dark' | 'system'

export type ChatBgPreset = 'none' | 'ocean' | 'warm' | 'aurora' | 'mint' | 'custom'
export type ApiProvider = 'official' | 'custom'
export type CustomApiProtocol = 'openai' | 'anthropic'

export const FONT_SCALE_STEPS = [0.9, 0.95, 1, 1.08, 1.16, 1.25] as const

/** 本机设置，存 localStorage：API Key、自定义 API、语言、主题、位置、朗读音色、字体、背景等 */
type Settings = {
  apiKey: string | null
  apiProvider: ApiProvider
  customApiUrl: string
  customApiKey: string | null
  customApiModel: string
  customApiProtocol: CustomApiProtocol
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
  defaultPersonaId: string
  petEnabled: boolean
  activePetId: string
  updateAccelerate: boolean
  updateMirror: string
  cacheModeEnabled: boolean
  cacheBackendUrl: string
  compactionEnabled: boolean
  compactionAuto: boolean
  compactionLevel: 'light' | 'medium' | 'heavy'
  gameCacheEnabled: boolean
}

const KEYS = {
  apiKey: 'chat-demo:api-key',
  apiProvider: 'chat-demo:api-provider',
  customApiUrl: 'chat-demo:custom-api-url',
  customApiKey: 'chat-demo:custom-api-key',
  customApiModel: 'chat-demo:custom-api-model',
  customApiProtocol: 'chat-demo:custom-api-protocol',
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
  defaultPersonaId: 'chat-demo:default-persona-id',
  petEnabled: 'chat-demo:pet-enabled',
  activePetId: 'chat-demo:active-pet-id',
  updateAccelerate: 'chat-demo:update-accelerate',
  updateMirror: 'chat-demo:update-mirror',
  cacheModeEnabled: 'chat-demo:cache-mode',
  cacheBackendUrl: 'chat-demo:cache-backend-url',
  compactionEnabled: 'chat-demo:compaction-enabled',
  compactionAuto: 'chat-demo:compaction-auto',
  compactionLevel: 'chat-demo:compaction-level',
  gameCacheEnabled: 'chat-demo:game-cache-enabled',
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

const initialApiProvider = (): ApiProvider =>
  read(KEYS.apiProvider) === 'custom' ? 'custom' : 'official'

const initialCustomApiProtocol = (): CustomApiProtocol =>
  read(KEYS.customApiProtocol) === 'anthropic' ? 'anthropic' : 'openai'

export const useSettings = create<Settings>(() => ({
  apiKey: read(KEYS.apiKey),
  apiProvider: initialApiProvider(),
  customApiUrl: read(KEYS.customApiUrl) ?? '',
  customApiKey: read(KEYS.customApiKey),
  customApiModel: read(KEYS.customApiModel) ?? '',
  customApiProtocol: initialCustomApiProtocol(),
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
  // 默认关闭自动压缩：自动压缩会在回复前串行调用多次 API 提炼摘要（很慢），且会改写前缀导致缓存失效
  // 上下文压缩总开关：默认关闭，用户手动开启后才显示压缩入口与档位选择
  compactionEnabled: read(KEYS.compactionEnabled) === 'true',
  compactionAuto: read(KEYS.compactionAuto) === 'true',
  compactionLevel: (read(KEYS.compactionLevel) as 'light' | 'medium' | 'heavy' | null) || 'light',
  gameCacheEnabled: read(KEYS.gameCacheEnabled) !== 'false',
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
  const cleaned = apiKey ? apiKey.trim() || null : null
  if (hasNativeSecureStorage()) {
    write(KEYS.apiKey, null)
    void saveSecureSecret(API_KEY_SECRET_ID, cleaned)
  } else {
    write(KEYS.apiKey, cleaned)
  }
  useSettings.setState({ apiKey: cleaned })
}

export const setApiProvider = (apiProvider: ApiProvider) => {
  write(KEYS.apiProvider, apiProvider)
  useSettings.setState({ apiProvider })
}

export const setCustomApiConfig = (config: {
  url: string
  apiKey?: string | null
  model: string
  protocol: CustomApiProtocol
}) => {
  const cleanedUrl = config.url.trim().replace(/\/+$/, '')
  const cleanedModel = config.model.trim()
  write(KEYS.customApiUrl, cleanedUrl || null)
  write(KEYS.customApiModel, cleanedModel || null)
  write(KEYS.customApiProtocol, config.protocol)

  const patch: Partial<Settings> = {
    customApiUrl: cleanedUrl,
    customApiModel: cleanedModel,
    customApiProtocol: config.protocol,
  }
  if (config.apiKey !== undefined) {
    const cleanedKey = config.apiKey ? config.apiKey.trim() || null : null
    if (hasNativeSecureStorage()) {
      write(KEYS.customApiKey, null)
      void saveSecureSecret(CUSTOM_API_KEY_SECRET_ID, cleanedKey)
    } else {
      write(KEYS.customApiKey, cleanedKey)
    }
    patch.customApiKey = cleanedKey
  }
  useSettings.setState(patch)
}

export const isCustomApiConfigured = (state: Settings = useSettings.getState()): boolean =>
  Boolean(state.customApiUrl.trim() && state.customApiKey?.trim() && state.customApiModel.trim())

export const hasConfiguredActiveApi = (state: Settings = useSettings.getState()): boolean =>
  state.apiProvider === 'custom' ? isCustomApiConfigured(state) : Boolean(state.apiKey?.trim())

export const getActiveApiKey = (state: Settings = useSettings.getState()): string =>
  state.apiProvider === 'custom' ? (state.customApiKey?.trim() ?? '') : (state.apiKey?.trim() ?? '')

let apiKeyHydrationTask: Promise<void> | null = null

const hydrateSingleSecret = async (
  secretId: string,
  storageKey: string
): Promise<string | null> => {
  const secureKey = await loadSecureSecret(secretId)
  const legacyKey = read(storageKey)?.trim() || null
  if (secureKey) {
    if (legacyKey) {
      write(storageKey, null)
    }
    return secureKey
  }
  if (legacyKey) {
    await saveSecureSecret(secretId, legacyKey)
    write(storageKey, null)
    return legacyKey
  }
  return null
}

/**
 * 原生端初始化时调用：
 * 1) 优先从 Android Keystore 解密读取官方/自定义 API Key，并彻底清除旧版 localStorage 明文；
 * 2) 若 Keystore 尚无记录但旧版 localStorage 存在明文 Key，自动无缝迁入 Keystore 后删除明文。
 */
export const hydrateNativeApiKey = (): Promise<void> => {
  if (!hasNativeSecureStorage()) {
    return Promise.resolve()
  }
  if (apiKeyHydrationTask) {
    return apiKeyHydrationTask
  }
  apiKeyHydrationTask = (async () => {
    const [officialKey, customKey] = await Promise.all([
      hydrateSingleSecret(API_KEY_SECRET_ID, KEYS.apiKey),
      hydrateSingleSecret(CUSTOM_API_KEY_SECRET_ID, KEYS.customApiKey),
    ])
    const patch: Partial<Settings> = {}
    if (officialKey) {
      patch.apiKey = officialKey
    }
    if (customKey) {
      patch.customApiKey = customKey
    }
    if (Object.keys(patch).length > 0) {
      useSettings.setState(patch)
    }
  })()
  return apiKeyHydrationTask
}

export const waitForApiKeyHydration = (): Promise<void> =>
  apiKeyHydrationTask ?? hydrateNativeApiKey()

export type SettingsSnapshot = Omit<Settings, 'apiKey' | 'customApiKey'>

export const exportSettingsSnapshot = (): SettingsSnapshot => {
  const state = useSettings.getState()
  return Object.fromEntries(
    Object.entries(state).filter(([key]) => key !== 'apiKey' && key !== 'customApiKey')
  ) as SettingsSnapshot
}

export const applySettingsSnapshot = (raw: Partial<SettingsSnapshot>) => {
  if (raw.locale === 'zh-CN' || raw.locale === 'en-US') {
    setLocale(raw.locale)
  }
  if (raw.location === null || raw.location) {
    setLocation(raw.location)
  }
  if (
    raw.themePreference === 'light' ||
    raw.themePreference === 'dark' ||
    raw.themePreference === 'system'
  ) {
    setThemePreference(raw.themePreference)
  }
  if (typeof raw.voiceEnabled === 'boolean') {
    setVoiceEnabled(raw.voiceEnabled)
  }
  if (typeof raw.voiceAutoPlay === 'boolean') {
    setVoiceAutoPlay(raw.voiceAutoPlay)
  }
  if (raw.ttsVoice === 'stella' || raw.ttsVoice === 'tide') {
    setTtsVoice(raw.ttsVoice)
  }
  if (typeof raw.fontFollowSystem === 'boolean') {
    setFontFollowSystem(raw.fontFollowSystem)
  }
  if (typeof raw.fontScale === 'number') {
    setFontScale(raw.fontScale)
  }
  if (typeof raw.chatBgImage === 'string' && raw.chatBgImage) {
    setChatBgImage(raw.chatBgImage)
  } else if (
    raw.chatBgPreset === 'none' ||
    raw.chatBgPreset === 'ocean' ||
    raw.chatBgPreset === 'warm' ||
    raw.chatBgPreset === 'aurora' ||
    raw.chatBgPreset === 'mint'
  ) {
    setChatBgPreset(raw.chatBgPreset)
  }
  if (typeof raw.thinking === 'boolean') {
    setThinking(raw.thinking)
  }
  if (typeof raw.search === 'boolean') {
    setSearch(raw.search)
  }
  if (typeof raw.siderCollapsed === 'boolean') {
    setSiderCollapsed(raw.siderCollapsed)
  }
  if (typeof raw.profile === 'string') {
    setProfile(raw.profile)
  }
  if (typeof raw.memoryEnabled === 'boolean') {
    setMemoryEnabled(raw.memoryEnabled)
  }
  if (typeof raw.memoryAuto === 'boolean') {
    setMemoryAuto(raw.memoryAuto)
  }
  if (typeof raw.defaultPersonaId === 'string') {
    setDefaultPersonaId(raw.defaultPersonaId)
  }
  if (typeof raw.petEnabled === 'boolean') {
    setPetEnabled(raw.petEnabled)
  }
  if (typeof raw.activePetId === 'string') {
    setActivePetId(raw.activePetId)
  }
  if (typeof raw.updateAccelerate === 'boolean') {
    setUpdateAccelerate(raw.updateAccelerate)
  }
  if (typeof raw.updateMirror === 'string') {
    setUpdateMirror(raw.updateMirror)
  }
  if (typeof raw.cacheModeEnabled === 'boolean') {
    setCacheModeEnabled(raw.cacheModeEnabled)
  }
  if (typeof raw.cacheBackendUrl === 'string') {
    setCacheBackendUrl(raw.cacheBackendUrl)
  }
  if (typeof raw.compactionEnabled === 'boolean') {
    setCompactionEnabled(raw.compactionEnabled)
  }
  if (typeof raw.compactionAuto === 'boolean') {
    setCompactionAuto(raw.compactionAuto)
  }
  if (
    raw.compactionLevel === 'light' ||
    raw.compactionLevel === 'medium' ||
    raw.compactionLevel === 'heavy'
  ) {
    setCompactionLevel(raw.compactionLevel)
  }
  if (raw.apiProvider === 'official' || raw.apiProvider === 'custom') {
    setApiProvider(raw.apiProvider)
  }
  if (
    typeof raw.customApiUrl === 'string' ||
    typeof raw.customApiModel === 'string' ||
    raw.customApiProtocol === 'openai' ||
    raw.customApiProtocol === 'anthropic'
  ) {
    const cur = useSettings.getState()
    setCustomApiConfig({
      url: typeof raw.customApiUrl === 'string' ? raw.customApiUrl : cur.customApiUrl,
      model: typeof raw.customApiModel === 'string' ? raw.customApiModel : cur.customApiModel,
      protocol:
        raw.customApiProtocol === 'openai' || raw.customApiProtocol === 'anthropic'
          ? raw.customApiProtocol
          : cur.customApiProtocol,
    })
  }
  if (typeof raw.gameCacheEnabled === 'boolean') {
    setGameCacheEnabled(raw.gameCacheEnabled)
  }
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

export const setCompactionEnabled = (compactionEnabled: boolean) => {
  write(KEYS.compactionEnabled, String(compactionEnabled))
  useSettings.setState({ compactionEnabled })
}

export const setCompactionAuto = (compactionAuto: boolean) => {
  write(KEYS.compactionAuto, String(compactionAuto))
  useSettings.setState({ compactionAuto })
}

export const setCompactionLevel = (compactionLevel: CompactionLevel) => {
  write(KEYS.compactionLevel, compactionLevel)
  useSettings.setState({ compactionLevel })
}

export const setGameCacheEnabled = (gameCacheEnabled: boolean) => {
  write(KEYS.gameCacheEnabled, String(gameCacheEnabled))
  useSettings.setState({ gameCacheEnabled })
}
