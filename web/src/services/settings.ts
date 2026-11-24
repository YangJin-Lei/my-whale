import { create } from 'zustand'
import {
  API_KEY_SECRET_ID,
  CUSTOM_API_KEY_SECRET_ID,
  IFLYTEK_API_KEY_SECRET_ID,
  IFLYTEK_API_SECRET_ID,
  hasNativeSecureStorage,
  loadSecureSecret,
  saveSecureSecret,
} from './secureStorage.js'
import type { TtsVoice } from './api/speech.js'
import { DEFAULT_LOCAL_VOICE_ID, type TtsEngineId } from './speech/engines.js'
import type { IflytekVoiceId } from './speech/iflytekTts.js'
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
  ttsEngine: TtsEngineId
  localTtsVoiceId: string
  localTtsSpeakerId: number | null
  ttsVoice: TtsVoice
  iflytekAppId: string
  iflytekApiKey: string
  iflytekApiSecret: string
  iflytekVoice: IflytekVoiceId
  fontFollowSystem: boolean
  fontScale: number
  chatBgPreset: ChatBgPreset
  chatBgImage: string
  chatBgOpacity: number
  thinking: boolean
  search: boolean
  siderCollapsed: boolean
  profile: string
  memoryEnabled: boolean
  memoryAuto: boolean
  defaultPersonaId: string
  petEnabled: boolean
  activePetId: string
  desktopPetIds: string[]
  chatroomExtraPetIds: string[]
  petSize: number
  updateAccelerate: boolean
  updateMirror: string
  cacheModeEnabled: boolean
  builtinSearchEnabled: boolean
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
  ttsEngine: 'chat-demo:tts-engine',
  localTtsVoiceId: 'chat-demo:local-tts-voice-id',
  localTtsSpeakerId: 'chat-demo:local-tts-speaker-id',
  ttsVoice: 'chat-demo:tts-voice',
  iflytekAppId: 'chat-demo:iflytek-app-id',
  iflytekApiKey: 'chat-demo:iflytek-api-key',
  iflytekApiSecret: 'chat-demo:iflytek-api-secret',
  iflytekVoice: 'chat-demo:iflytek-voice',
  fontFollowSystem: 'chat-demo:font-follow-system',
  fontScale: 'chat-demo:font-scale',
  chatBgPreset: 'chat-demo:chat-bg-preset',
  chatBgImage: 'chat-demo:chat-bg-image',
  chatBgOpacity: 'chat-demo:chat-bg-opacity',
  thinking: 'chat-demo:thinking',
  search: 'chat-demo:search',
  siderCollapsed: 'chat-demo:sider-collapsed',
  profile: 'chat-demo:profile',
  memoryEnabled: 'chat-demo:memory-enabled',
  memoryAuto: 'chat-demo:memory-auto',
  defaultPersonaId: 'chat-demo:default-persona-id',
  petEnabled: 'chat-demo:pet-enabled',
  activePetId: 'chat-demo:active-pet-id',
  desktopPetIds: 'chat-demo:desktop-pet-ids',
  chatroomExtraPetIds: 'chat-demo:chatroom-extra-pet-ids',
  petSize: 'chat-demo:pet-size',
  updateAccelerate: 'chat-demo:update-accelerate',
  updateMirror: 'chat-demo:update-mirror',
  cacheModeEnabled: 'chat-demo:cache-mode',
  builtinSearchEnabled: 'chat-demo:builtin-search',
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

/** 默认使用系统零体积朗读；用户配置讯飞后自动优先用讯飞，或按需下载本地语音包 */
const initialTtsEngine = (): TtsEngineId => {
  const saved = read(KEYS.ttsEngine)
  if (
    saved === 'iflytek' ||
    saved === 'official' ||
    saved === 'system' ||
    saved === 'local-sherpa'
  ) {
    return saved
  }
  return 'system'
}

const initialLocalTtsVoiceId = (): string => {
  const saved = read(KEYS.localTtsVoiceId)
  if (!saved || saved === 'default-zh' || saved === 'melo-zh-en') {
    return DEFAULT_LOCAL_VOICE_ID
  }
  if (saved === 'kokoro-multi') {
    return 'kokoro-v1_1'
  }
  return saved
}

const initialIflytekVoice = (): IflytekVoiceId => {
  const saved = read(KEYS.iflytekVoice)
  if (
    saved === 'aisjiuxu' ||
    saved === 'aisxping' ||
    saved === 'aisjinger' ||
    saved === 'aisbabyxu'
  ) {
    return saved
  }
  return 'xiaoyan'
}

const initialLocalTtsSpeakerId = (): number | null => {
  const raw = read(KEYS.localTtsSpeakerId)
  if (raw === null || raw === '') {
    return null
  }
  const parsed = Number(raw)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null
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

export const PET_SIZE_MIN = 32
export const PET_MAX_DESKTOP = 3
export const PET_CHATROOM_MAX = 8

export const getMaxPetWidth = (
  viewportWidth = typeof window === 'undefined' ? 390 : window.innerWidth
) => Math.max(120, Math.round(viewportWidth / 2))

export const clampPetSize = (size: number, viewportWidth?: number) =>
  Math.max(PET_SIZE_MIN, Math.min(getMaxPetWidth(viewportWidth), Math.round(size)))

const initialChatBgOpacity = (): number => {
  const n = Number(read(KEYS.chatBgOpacity))
  return Number.isFinite(n) && n >= 0.05 && n <= 1 ? n : 0.24
}

const initialPetSize = (): number => {
  const n = Number(read(KEYS.petSize))
  if (Number.isFinite(n) && n >= PET_SIZE_MIN) {
    return clampPetSize(n)
  }
  return 72
}

const parseIdArray = (raw: string | null): string[] => {
  if (!raw) {
    return []
  }
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) {
      return []
    }
    return Array.from(
      new Set(
        parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      )
    )
  } catch {
    return []
  }
}

const initialDesktopPetIds = (fallbackActive: string): string[] => {
  const stored = parseIdArray(read(KEYS.desktopPetIds)).slice(0, PET_MAX_DESKTOP)
  return stored.length > 0 ? stored : [fallbackActive || 'nailong']
}

const initialChatroomExtraPetIds = (desktopIds: string[]): string[] => {
  const desktopSet = new Set(desktopIds)
  return parseIdArray(read(KEYS.chatroomExtraPetIds))
    .filter((id) => !desktopSet.has(id))
    .slice(0, Math.max(0, PET_CHATROOM_MAX - desktopIds.length))
}

const initialDesktopActive = read(KEYS.activePetId) || 'nailong'
const initialDesktopList = initialDesktopPetIds(initialDesktopActive)

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
  ttsEngine: initialTtsEngine(),
  localTtsVoiceId: initialLocalTtsVoiceId(),
  localTtsSpeakerId: initialLocalTtsSpeakerId(),
  ttsVoice: initialTtsVoice(),
  iflytekAppId: read(KEYS.iflytekAppId) ?? '',
  iflytekApiKey: read(KEYS.iflytekApiKey) ?? '',
  iflytekApiSecret: read(KEYS.iflytekApiSecret) ?? '',
  iflytekVoice: initialIflytekVoice(),
  fontFollowSystem: read(KEYS.fontFollowSystem) !== 'false',
  fontScale: initialFontScale(),
  chatBgPreset: initialChatBgPreset(),
  chatBgImage: read(KEYS.chatBgImage) ?? '',
  chatBgOpacity: initialChatBgOpacity(),
  thinking: read(KEYS.thinking) === 'true',
  search: read(KEYS.search) === 'true',
  siderCollapsed: read(KEYS.siderCollapsed) === 'true',
  profile: read(KEYS.profile) ?? '',
  memoryEnabled: read(KEYS.memoryEnabled) !== 'false',
  memoryAuto: read(KEYS.memoryAuto) !== 'false',
  defaultPersonaId: read(KEYS.defaultPersonaId) || 'builtin-default',
  petEnabled: read(KEYS.petEnabled) !== 'false',
  activePetId: initialDesktopList[0] ?? 'nailong',
  desktopPetIds: initialDesktopList,
  chatroomExtraPetIds: initialChatroomExtraPetIds(initialDesktopList),
  petSize: initialPetSize(),
  updateAccelerate:
    read(KEYS.updateAccelerate) !== null
      ? read(KEYS.updateAccelerate) === 'true'
      : isChineseBrowser(),
  updateMirror: read(KEYS.updateMirror) || 'https://ghfast.top/',
  cacheModeEnabled: read(KEYS.cacheModeEnabled) !== 'false',
  // 内置搜索默认关闭，联网搜索默认直走 DeepSeek 官方；需增强本地多源检索时在通用设置中打开
  builtinSearchEnabled: read(KEYS.builtinSearchEnabled) === 'true',
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

export const setTtsEngine = (ttsEngine: TtsEngineId) => {
  if (ttsEngine === 'nekospeak') {
    return
  }
  write(KEYS.ttsEngine, ttsEngine)
  useSettings.setState({ ttsEngine })
}

export const setLocalTtsVoiceId = (localTtsVoiceId: string) => {
  const next = localTtsVoiceId.trim() || DEFAULT_LOCAL_VOICE_ID
  const prev = useSettings.getState().localTtsVoiceId
  write(KEYS.localTtsVoiceId, next)
  if (prev !== next) {
    write(KEYS.localTtsSpeakerId, null)
    useSettings.setState({ localTtsVoiceId: next, localTtsSpeakerId: null })
  } else {
    useSettings.setState({ localTtsVoiceId: next })
  }
}

export const setLocalTtsSpeakerId = (localTtsSpeakerId: number | null) => {
  const next =
    typeof localTtsSpeakerId === 'number' &&
    Number.isInteger(localTtsSpeakerId) &&
    localTtsSpeakerId >= 0
      ? localTtsSpeakerId
      : null
  write(KEYS.localTtsSpeakerId, next === null ? null : String(next))
  useSettings.setState({ localTtsSpeakerId: next })
}

export const setTtsVoice = (ttsVoice: TtsVoice) => {
  write(KEYS.ttsVoice, ttsVoice)
  useSettings.setState({ ttsVoice })
}

export const setIflytekVoice = (iflytekVoice: IflytekVoiceId) => {
  write(KEYS.iflytekVoice, iflytekVoice)
  useSettings.setState({ iflytekVoice })
}

export const setIflytekCredentials = (creds: {
  appId: string
  apiKey?: string
  apiSecret?: string
}) => {
  const cleanAppId = creds.appId.trim()
  write(KEYS.iflytekAppId, cleanAppId || null)
  const patch: Partial<Settings> = { iflytekAppId: cleanAppId }

  if (creds.apiKey !== undefined) {
    const cleanKey = creds.apiKey.trim()
    if (hasNativeSecureStorage()) {
      write(KEYS.iflytekApiKey, null)
      void saveSecureSecret(IFLYTEK_API_KEY_SECRET_ID, cleanKey || null)
    } else {
      write(KEYS.iflytekApiKey, cleanKey || null)
    }
    patch.iflytekApiKey = cleanKey
  }

  if (creds.apiSecret !== undefined) {
    const cleanSecret = creds.apiSecret.trim()
    if (hasNativeSecureStorage()) {
      write(KEYS.iflytekApiSecret, null)
      void saveSecureSecret(IFLYTEK_API_SECRET_ID, cleanSecret || null)
    } else {
      write(KEYS.iflytekApiSecret, cleanSecret || null)
    }
    patch.iflytekApiSecret = cleanSecret
  }

  useSettings.setState(patch)
}

export const isIflytekConfigured = (state: Settings = useSettings.getState()): boolean =>
  Boolean(state.iflytekAppId.trim() && state.iflytekApiKey.trim() && state.iflytekApiSecret.trim())

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

export const setChatBgOpacity = (chatBgOpacity: number) => {
  const clamped = Math.max(0.05, Math.min(1, Number(chatBgOpacity.toFixed(2))))
  write(KEYS.chatBgOpacity, String(clamped))
  useSettings.setState({ chatBgOpacity: clamped })
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
    const [officialKey, customKey, iflyKey, iflySecret] = await Promise.all([
      hydrateSingleSecret(API_KEY_SECRET_ID, KEYS.apiKey),
      hydrateSingleSecret(CUSTOM_API_KEY_SECRET_ID, KEYS.customApiKey),
      hydrateSingleSecret(IFLYTEK_API_KEY_SECRET_ID, KEYS.iflytekApiKey),
      hydrateSingleSecret(IFLYTEK_API_SECRET_ID, KEYS.iflytekApiSecret),
    ])
    const patch: Partial<Settings> = {}
    if (officialKey) {
      patch.apiKey = officialKey
    }
    if (customKey) {
      patch.customApiKey = customKey
    }
    if (iflyKey) {
      patch.iflytekApiKey = iflyKey
    }
    if (iflySecret) {
      patch.iflytekApiSecret = iflySecret
    }
    if (Object.keys(patch).length > 0) {
      useSettings.setState(patch)
    }
  })()
  return apiKeyHydrationTask
}

export const waitForApiKeyHydration = (): Promise<void> =>
  apiKeyHydrationTask ?? hydrateNativeApiKey()

export type SettingsSnapshot = Omit<
  Settings,
  'apiKey' | 'customApiKey' | 'iflytekApiKey' | 'iflytekApiSecret'
>

export const exportSettingsSnapshot = (): SettingsSnapshot => {
  const state = useSettings.getState()
  return Object.fromEntries(
    Object.entries(state).filter(
      ([key]) =>
        key !== 'apiKey' &&
        key !== 'customApiKey' &&
        key !== 'iflytekApiKey' &&
        key !== 'iflytekApiSecret'
    )
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
  if (
    raw.ttsEngine === 'iflytek' ||
    raw.ttsEngine === 'local-sherpa' ||
    raw.ttsEngine === 'official' ||
    raw.ttsEngine === 'system'
  ) {
    setTtsEngine(raw.ttsEngine)
  }
  if (typeof raw.iflytekAppId === 'string') {
    setIflytekCredentials({ appId: raw.iflytekAppId })
  }
  if (
    raw.iflytekVoice === 'xiaoyan' ||
    raw.iflytekVoice === 'aisjiuxu' ||
    raw.iflytekVoice === 'aisxping' ||
    raw.iflytekVoice === 'aisjinger' ||
    raw.iflytekVoice === 'aisbabyxu'
  ) {
    setIflytekVoice(raw.iflytekVoice)
  }
  if (typeof raw.localTtsVoiceId === 'string' && raw.localTtsVoiceId.trim()) {
    setLocalTtsVoiceId(raw.localTtsVoiceId)
  }
  if (raw.localTtsSpeakerId === null || typeof raw.localTtsSpeakerId === 'number') {
    setLocalTtsSpeakerId(raw.localTtsSpeakerId)
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
  if (typeof raw.chatBgOpacity === 'number' && Number.isFinite(raw.chatBgOpacity)) {
    setChatBgOpacity(raw.chatBgOpacity)
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
  if (Array.isArray(raw.desktopPetIds)) {
    setDesktopPetIds(raw.desktopPetIds.filter((x): x is string => typeof x === 'string'))
  } else if (typeof raw.activePetId === 'string') {
    setActivePetId(raw.activePetId)
  }
  if (Array.isArray(raw.chatroomExtraPetIds)) {
    setChatroomExtraPetIds(
      raw.chatroomExtraPetIds.filter((x): x is string => typeof x === 'string')
    )
  }
  if (typeof raw.petSize === 'number' && Number.isFinite(raw.petSize)) {
    setPetSize(raw.petSize)
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
  if (typeof raw.builtinSearchEnabled === 'boolean') {
    setBuiltinSearchEnabled(raw.builtinSearchEnabled)
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

export const setDesktopPetIds = (rawIds: string[]) => {
  const unique = Array.from(new Set(rawIds.map((id) => id.trim()).filter(Boolean))).slice(
    0,
    PET_MAX_DESKTOP
  )
  const next = unique.length > 0 ? unique : ['nailong']
  const desktopSet = new Set(next)
  const prunedExtra = useSettings
    .getState()
    .chatroomExtraPetIds.filter((id) => !desktopSet.has(id))
    .slice(0, Math.max(0, PET_CHATROOM_MAX - next.length))
  write(KEYS.desktopPetIds, JSON.stringify(next))
  write(KEYS.activePetId, next[0])
  write(KEYS.chatroomExtraPetIds, JSON.stringify(prunedExtra))
  useSettings.setState({
    desktopPetIds: next,
    activePetId: next[0],
    chatroomExtraPetIds: prunedExtra,
  })
}

export const toggleDesktopPet = (petId: string): 'added' | 'removed' | 'full' | 'min' => {
  const current = useSettings.getState().desktopPetIds
  if (current.includes(petId)) {
    if (current.length <= 1) {
      return 'min'
    }
    setDesktopPetIds(current.filter((id) => id !== petId))
    return 'removed'
  }
  if (current.length >= PET_MAX_DESKTOP) {
    return 'full'
  }
  setDesktopPetIds([...current, petId])
  return 'added'
}

export const setActivePetId = (activePetId: string) => {
  const clean = activePetId || 'nailong'
  const current = useSettings.getState().desktopPetIds
  const next = [clean, ...current.filter((id) => id !== clean)].slice(0, PET_MAX_DESKTOP)
  setDesktopPetIds(next)
}

export const setChatroomExtraPetIds = (rawIds: string[]) => {
  const state = useSettings.getState()
  const desktopSet = new Set(state.desktopPetIds)
  const maxExtra = Math.max(0, PET_CHATROOM_MAX - state.desktopPetIds.length)
  const next = Array.from(new Set(rawIds.map((id) => id.trim()).filter(Boolean)))
    .filter((id) => !desktopSet.has(id))
    .slice(0, maxExtra)
  write(KEYS.chatroomExtraPetIds, JSON.stringify(next))
  useSettings.setState({ chatroomExtraPetIds: next })
}

export const getChatroomPetIds = (state: Settings = useSettings.getState()): string[] =>
  [...state.desktopPetIds, ...state.chatroomExtraPetIds].slice(0, PET_CHATROOM_MAX)

export const setPetSize = (petSize: number) => {
  const clamped = clampPetSize(petSize)
  write(KEYS.petSize, String(clamped))
  useSettings.setState({ petSize: clamped })
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

export const setBuiltinSearchEnabled = (builtinSearchEnabled: boolean) => {
  write(KEYS.builtinSearchEnabled, String(builtinSearchEnabled))
  useSettings.setState({ builtinSearchEnabled })
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
