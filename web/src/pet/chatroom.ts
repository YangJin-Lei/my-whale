import { create } from 'zustand'
import { ensureApiKey } from '../components/settings/settingsDialogState.js'
import {
  streamMessage,
  verifyApiKey,
  verifyCustomApi,
  type StreamApiOverride,
} from '../services/api/client.js'
import type { MessageParam, MessageUsage } from '../services/api/types.js'
import {
  savePetChatroomSession,
  selectSession,
  type PetChatroomSaveEntry,
} from '../services/chat/store.js'
import {
  hasNativeSecureStorage,
  loadSecureSecret,
  saveSecureSecret,
} from '../services/secureStorage.js'
import {
  getActiveApiKey,
  getChatroomPetIds,
  PET_CHATROOM_MAX,
  setChatroomExtraPetIds,
  setDesktopPetIds,
  toggleDesktopPet,
  useSettings,
} from '../services/settings.js'
import { createId } from '../utils/id.js'
import { findPetById } from './catalog.js'
import { setPetMood } from './store.js'

const ROOM_STORAGE_KEY = 'mywhale_pet_chatroom_v1'
const PET_API_CONFIG_KEY = 'mywhale_pet_api_configs_v1'
const PET_SECRET_PREFIX = 'pet-api-key:'

export type PetApiMode = 'global' | 'official' | 'custom'

export type PetApiConfig = {
  mode: PetApiMode
  protocol: 'openai' | 'anthropic'
  url: string
  apiKey: string | null
  model: string
  thinking: boolean
  customPrompt: string
}

export type PetDebugStats = {
  lastLatencyMs: number | null
  inputTokens: number
  cacheReadTokens: number
  outputTokens: number
  endpointLabel: string
  errorText: string | null
  updatedAt: number | null
}

export type PetChatroomMessage = {
  id: string
  senderType: 'user' | 'pet' | 'system'
  petId?: string
  senderName: string
  content: string
  createdAt: number
}

type StoredRoomState = {
  roomId: string
  linkedSessionId: string | null
  autoIntervalSec: number
  messages: PetChatroomMessage[]
}

type PetChatroomStoreState = {
  drawerOpen: boolean
  running: boolean
  autoIntervalSec: number
  countdownSec: number | null
  roomId: string
  linkedSessionId: string | null
  messages: PetChatroomMessage[]
  streamingPetId: string | null
  streamingText: string
  errorText: string | null
  debugModalPetId: string | null
  petApiConfigs: Record<string, PetApiConfig>
  petDebugStats: Record<string, PetDebugStats>
}

export const defaultPetApiConfig = (): PetApiConfig => ({
  mode: 'global',
  protocol: 'openai',
  url: '',
  apiKey: null,
  model: '',
  thinking: false,
  customPrompt: '',
})

const readStoredRoom = (): StoredRoomState => {
  const fallback: StoredRoomState = {
    roomId: createId(),
    linkedSessionId: null,
    autoIntervalSec: 12,
    messages: [],
  }
  if (typeof window === 'undefined') {
    return fallback
  }
  try {
    const raw = window.localStorage.getItem(ROOM_STORAGE_KEY)
    if (!raw) {
      return fallback
    }
    const parsed = JSON.parse(raw) as Partial<StoredRoomState>
    const messages = Array.isArray(parsed.messages)
      ? parsed.messages
          .filter(
            (m): m is PetChatroomMessage =>
              typeof m === 'object' &&
              m !== null &&
              typeof m.id === 'string' &&
              (m.senderType === 'user' || m.senderType === 'pet' || m.senderType === 'system') &&
              typeof m.senderName === 'string' &&
              typeof m.content === 'string'
          )
          .slice(-120)
      : []
    return {
      roomId: typeof parsed.roomId === 'string' && parsed.roomId ? parsed.roomId : createId(),
      linkedSessionId: typeof parsed.linkedSessionId === 'string' ? parsed.linkedSessionId : null,
      autoIntervalSec:
        typeof parsed.autoIntervalSec === 'number' && parsed.autoIntervalSec >= 5
          ? Math.min(300, Math.round(parsed.autoIntervalSec))
          : 12,
      messages,
    }
  } catch {
    return fallback
  }
}

const sanitizePetApiConfig = (raw: unknown): PetApiConfig | null => {
  if (typeof raw !== 'object' || raw === null) {
    return null
  }
  const obj = raw as Record<string, unknown>
  const mode: PetApiMode = obj.mode === 'official' || obj.mode === 'custom' ? obj.mode : 'global'
  return {
    mode,
    protocol: obj.protocol === 'anthropic' ? 'anthropic' : 'openai',
    url: typeof obj.url === 'string' ? obj.url.trim().replace(/\/+$/, '') : '',
    apiKey: typeof obj.apiKey === 'string' && obj.apiKey.trim() ? obj.apiKey.trim() : null,
    model: typeof obj.model === 'string' ? obj.model.trim() : '',
    thinking: Boolean(obj.thinking),
    customPrompt: typeof obj.customPrompt === 'string' ? obj.customPrompt.trim() : '',
  }
}

const readStoredPetApiConfigs = (): Record<string, PetApiConfig> => {
  if (typeof window === 'undefined') {
    return {}
  }
  try {
    const raw = window.localStorage.getItem(PET_API_CONFIG_KEY)
    if (!raw) {
      return {}
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (typeof parsed !== 'object' || parsed === null) {
      return {}
    }
    const out: Record<string, PetApiConfig> = {}
    for (const [petId, val] of Object.entries(parsed)) {
      const cfg = sanitizePetApiConfig(val)
      if (cfg) {
        out[petId] = cfg
      }
    }
    return out
  } catch {
    return {}
  }
}

const writeStoredRoom = (state: PetChatroomStoreState) => {
  if (typeof window === 'undefined') {
    return
  }
  try {
    const payload: StoredRoomState = {
      roomId: state.roomId,
      linkedSessionId: state.linkedSessionId,
      autoIntervalSec: state.autoIntervalSec,
      messages: state.messages.slice(-120),
    }
    window.localStorage.setItem(ROOM_STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // 忽略存储限制
  }
}

const writeStoredPetApiConfigs = (configs: Record<string, PetApiConfig>) => {
  if (typeof window === 'undefined') {
    return
  }
  const native = hasNativeSecureStorage()
  const serializable: Record<string, PetApiConfig> = {}
  for (const [petId, cfg] of Object.entries(configs)) {
    serializable[petId] = native ? { ...cfg, apiKey: null } : cfg
  }
  try {
    window.localStorage.setItem(PET_API_CONFIG_KEY, JSON.stringify(serializable))
  } catch {
    // 忽略存储限制
  }
}

const initialRoom = readStoredRoom()

export const usePetChatroom = create<PetChatroomStoreState>(() => ({
  drawerOpen: false,
  running: false,
  autoIntervalSec: initialRoom.autoIntervalSec,
  countdownSec: null,
  roomId: initialRoom.roomId,
  linkedSessionId: initialRoom.linkedSessionId,
  messages: initialRoom.messages,
  streamingPetId: null,
  streamingText: '',
  errorText: null,
  debugModalPetId: null,
  petApiConfigs: readStoredPetApiConfigs(),
  petDebugStats: {},
}))

let loopTimerId: number | null = null
let activeTurnController: AbortController | null = null
let lastSpeakerIdx = -1

const clearLoopTimer = () => {
  if (loopTimerId !== null) {
    window.clearInterval(loopTimerId)
    loopTimerId = null
  }
}

const abortActiveTurn = () => {
  if (activeTurnController) {
    activeTurnController.abort()
    activeTurnController = null
  }
}

export const openPetChatroom = () => {
  usePetChatroom.setState({ drawerOpen: true, errorText: null })
}

export const closePetChatroom = () => {
  clearLoopTimer()
  abortActiveTurn()
  usePetChatroom.setState({
    drawerOpen: false,
    running: false,
    countdownSec: null,
    streamingPetId: null,
    streamingText: '',
  })
}

export const openPetDebugModal = (petId: string | null) => {
  usePetChatroom.setState({ debugModalPetId: petId })
}

export const getPetApiConfig = (petId: string): PetApiConfig =>
  usePetChatroom.getState().petApiConfigs[petId] ?? defaultPetApiConfig()

export const savePetApiConfig = (petId: string, next: PetApiConfig) => {
  const clean: PetApiConfig = {
    mode: next.mode,
    protocol: next.protocol,
    url: next.url.trim().replace(/\/+$/, ''),
    apiKey: next.apiKey ? next.apiKey.trim() || null : null,
    model: next.model.trim(),
    thinking: next.thinking,
    customPrompt: next.customPrompt.trim(),
  }
  if (hasNativeSecureStorage()) {
    void saveSecureSecret(`${PET_SECRET_PREFIX}${petId}`, clean.apiKey)
  }
  usePetChatroom.setState((prev) => {
    const updated = { ...prev.petApiConfigs, [petId]: clean }
    writeStoredPetApiConfigs(updated)
    return { petApiConfigs: updated }
  })
}

export const hydratePetApiSecrets = async (): Promise<void> => {
  if (!hasNativeSecureStorage()) {
    return
  }
  const configs = usePetChatroom.getState().petApiConfigs
  const ids = Object.keys(configs)
  if (ids.length === 0) {
    return
  }
  const updates: Record<string, PetApiConfig> = {}
  await Promise.all(
    ids.map(async (petId) => {
      const cfg = configs[petId]
      const secureKey = await loadSecureSecret(`${PET_SECRET_PREFIX}${petId}`)
      if (secureKey) {
        updates[petId] = { ...cfg, apiKey: secureKey }
      } else if (cfg.apiKey) {
        await saveSecureSecret(`${PET_SECRET_PREFIX}${petId}`, cfg.apiKey)
      }
    })
  )
  if (Object.keys(updates).length > 0) {
    usePetChatroom.setState((prev) => {
      const merged = { ...prev.petApiConfigs, ...updates }
      writeStoredPetApiConfigs(merged)
      return { petApiConfigs: merged }
    })
  }
}

export const testPetApiConfig = async (petId: string, draft: PetApiConfig): Promise<void> => {
  if (draft.mode === 'custom') {
    const url = draft.url.trim().replace(/\/+$/, '')
    const key = draft.apiKey?.trim() || getPetApiConfig(petId).apiKey?.trim() || ''
    const model = draft.model.trim()
    if (!url || !key || !model) {
      throw new Error('Missing URL / API Key / Model')
    }
    await verifyCustomApi({ url, apiKey: key, model, protocol: draft.protocol })
    return
  }
  if (draft.mode === 'official') {
    const key =
      draft.apiKey?.trim() ||
      getPetApiConfig(petId).apiKey?.trim() ||
      useSettings.getState().apiKey?.trim() ||
      ''
    if (!key) {
      throw new Error('Missing API Key')
    }
    await verifyApiKey(key)
    return
  }
  const globalSettings = useSettings.getState()
  if (globalSettings.apiProvider === 'custom') {
    await verifyCustomApi({
      url: globalSettings.customApiUrl,
      apiKey: globalSettings.customApiKey ?? '',
      model: globalSettings.customApiModel,
      protocol: globalSettings.customApiProtocol,
    })
  } else {
    await verifyApiKey(globalSettings.apiKey ?? '')
  }
}

export const exportPetApiConfigsSnapshot = (): Record<string, Omit<PetApiConfig, 'apiKey'>> => {
  const configs = usePetChatroom.getState().petApiConfigs
  const out: Record<string, Omit<PetApiConfig, 'apiKey'>> = {}
  for (const [id, cfg] of Object.entries(configs)) {
    out[id] = {
      mode: cfg.mode,
      protocol: cfg.protocol,
      url: cfg.url,
      model: cfg.model,
      thinking: cfg.thinking,
      customPrompt: cfg.customPrompt,
    }
  }
  return out
}

export const exportPetApiSecretsMap = (): Record<string, string> => {
  const out: Record<string, string> = {}
  for (const [id, cfg] of Object.entries(usePetChatroom.getState().petApiConfigs)) {
    if (cfg.apiKey?.trim()) {
      out[id] = cfg.apiKey.trim()
    }
  }
  return out
}

export const restorePetApiBackup = (
  configsSnapshot: unknown,
  secretsMap?: Record<string, string> | null
) => {
  const next: Record<string, PetApiConfig> = { ...usePetChatroom.getState().petApiConfigs }
  if (typeof configsSnapshot === 'object' && configsSnapshot !== null) {
    for (const [id, val] of Object.entries(configsSnapshot as Record<string, unknown>)) {
      const cfg = sanitizePetApiConfig(val)
      if (cfg) {
        const key = secretsMap && typeof secretsMap[id] === 'string' ? secretsMap[id].trim() : null
        next[id] = { ...cfg, apiKey: key || next[id]?.apiKey || null }
        if (hasNativeSecureStorage() && next[id].apiKey) {
          void saveSecureSecret(`${PET_SECRET_PREFIX}${id}`, next[id].apiKey)
        }
      }
    }
  }
  writeStoredPetApiConfigs(next)
  usePetChatroom.setState({ petApiConfigs: next })
}

const appendRoomMessage = (msg: PetChatroomMessage) => {
  usePetChatroom.setState((prev) => {
    const nextState: PetChatroomStoreState = {
      ...prev,
      messages: [...prev.messages, msg].slice(-120),
    }
    writeStoredRoom(nextState)
    return { messages: nextState.messages }
  })
}

/** 将成员加入/剔除记录写入聊天室对话流，让所有其他桌宠持久记住阵容变更 */
export const recordChatroomRosterChange = (addedIds: string[], removedIds: string[]) => {
  const locale = useSettings.getState().locale
  const currentState = usePetChatroom.getState()
  if (addedIds.length === 0 && removedIds.length === 0) {
    return
  }
  // 全新空房间且仅初始化桌面时不必刷屏
  if (currentState.messages.length === 0 && !currentState.drawerOpen && removedIds.length === 0) {
    return
  }
  const parts: string[] = []
  if (addedIds.length > 0) {
    const names = addedIds.map((id) => findPetById(id).name[locale]).join('、')
    parts.push(locale === 'zh-CN' ? `${names} 加入了聊天室` : `${names} joined the chatroom`)
  }
  if (removedIds.length > 0) {
    const names = removedIds.map((id) => findPetById(id).name[locale]).join('、')
    parts.push(locale === 'zh-CN' ? `${names} 离开了聊天室` : `${names} left the chatroom`)
  }
  appendRoomMessage({
    id: createId(),
    senderType: 'system',
    senderName: locale === 'zh-CN' ? '系统' : 'System',
    content: `【${parts.join('；')}】`,
    createdAt: Date.now(),
  })
}

export const toggleDesktopPetWithMemory = (petId: string): 'added' | 'removed' | 'full' | 'min' => {
  const before = new Set(getChatroomPetIds())
  const result = toggleDesktopPet(petId)
  const after = new Set(getChatroomPetIds())
  const added = [...after].filter((id) => !before.has(id))
  const removed = [...before].filter((id) => !after.has(id))
  recordChatroomRosterChange(added, removed)
  return result
}

export const removeDesktopPetWithMemory = (petId: string) => {
  const before = new Set(getChatroomPetIds())
  const desktop = useSettings.getState().desktopPetIds
  if (desktop.length <= 1 || !desktop.includes(petId)) {
    return
  }
  setDesktopPetIds(desktop.filter((id) => id !== petId))
  const after = new Set(getChatroomPetIds())
  const removed = [...before].filter((id) => !after.has(id))
  recordChatroomRosterChange([], removed)
}

export const addChatroomPet = (petId: string): boolean => {
  const settings = useSettings.getState()
  const members = getChatroomPetIds(settings)
  if (members.includes(petId) || members.length >= PET_CHATROOM_MAX) {
    return false
  }
  setChatroomExtraPetIds([...settings.chatroomExtraPetIds, petId])
  recordChatroomRosterChange([petId], [])
  return true
}

export const removeChatroomPet = (petId: string): boolean => {
  const settings = useSettings.getState()
  if (settings.desktopPetIds.includes(petId)) {
    return false
  }
  if (!settings.chatroomExtraPetIds.includes(petId)) {
    return false
  }
  setChatroomExtraPetIds(settings.chatroomExtraPetIds.filter((id) => id !== petId))
  recordChatroomRosterChange([], [petId])
  return true
}

const buildPetStaticSystemPrompt = (petId: string): string => {
  const locale = useSettings.getState().locale
  const pet = findPetById(petId)
  const cfg = getPetApiConfig(petId)
  const baseHint = pet.promptHint[locale]
  const custom = cfg.customPrompt ? `\n${cfg.customPrompt}` : ''
  if (locale === 'zh-CN') {
    return `${baseHint}${custom}\n你现在正在多桌宠聊天室里和大家实时群聊。规则：1）严格保持自己的性格和口吻发言；2）每次只说 1~3 句简短口语的话，自然接话、吐槽或互动，不要长篇大论，不要带「${pet.name['zh-CN']}:」前缀；3）能记住聊天室里加入、离开的成员以及所有历史话题。`
  }
  return `${baseHint}${custom}\nYou are chatting live in the multi-pet chatroom. Rules: 1) Stay in character; 2) Keep replies natural and short (1-3 sentences) without prefixing your own name; 3) Remember members joining/leaving and prior topics.`
}

const WINDOW_STEP = 20
const MAX_WINDOW_MESSAGES = 60

const buildPetLaneMessages = (petId: string, allMessages: PetChatroomMessage[]): MessageParam[] => {
  // 按 20 条固定分块步进裁剪，确保两次分块之间消息前缀逐字节稳定以命中 KV Prefix Cache
  const overflow = Math.max(0, allMessages.length - MAX_WINDOW_MESSAGES)
  const startIdx = overflow > 0 ? Math.ceil(overflow / WINDOW_STEP) * WINDOW_STEP : 0
  const slice = allMessages.slice(startIdx)
  const locale = useSettings.getState().locale

  const out: MessageParam[] = []
  const pushUserLine = (line: string) => {
    const prev = out[out.length - 1]
    if (prev && prev.role === 'user' && typeof prev.content === 'string') {
      prev.content = `${prev.content}\n${line}`
    } else {
      out.push({ role: 'user', content: line })
    }
  }

  for (const msg of slice) {
    if (msg.senderType === 'pet' && msg.petId === petId) {
      if (out.length === 0) {
        pushUserLine(locale === 'zh-CN' ? '[聊天室开场]' : '[Chatroom started]')
      }
      const prev = out[out.length - 1]
      if (prev && prev.role === 'assistant') {
        const prevText = prev.content
          .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
          .map((b) => b.text)
          .join('\n')
        prev.content = [{ type: 'text', text: `${prevText}\n${msg.content}` }]
      } else {
        out.push({ role: 'assistant', content: [{ type: 'text', text: msg.content }] })
      }
      continue
    }
    const label =
      msg.senderType === 'user'
        ? locale === 'zh-CN'
          ? '主人'
          : 'User'
        : msg.senderType === 'system'
          ? locale === 'zh-CN'
            ? '系统通知'
            : 'System'
          : msg.senderName
    pushUserLine(`[${label}]: ${msg.content}`)
  }

  const last = out[out.length - 1]
  if (!last || last.role === 'assistant') {
    const members = getChatroomPetIds()
      .map((id) => findPetById(id).name[locale])
      .join('、')
    pushUserLine(
      locale === 'zh-CN'
        ? `[当前在场: ${members}] 请接一句自然的群聊发言。`
        : `[Present: ${members}] Say one natural line in the chatroom.`
    )
  }

  return out
}

const resolvePetApiOverride = (
  petId: string
): {
  apiKey: string
  thinking: boolean
  override?: StreamApiOverride
  endpointLabel: string
} | null => {
  const cfg = getPetApiConfig(petId)
  const settings = useSettings.getState()
  if (cfg.mode === 'custom') {
    if (!cfg.url.trim() || !cfg.apiKey?.trim() || !cfg.model.trim()) {
      return null
    }
    return {
      apiKey: cfg.apiKey.trim(),
      thinking: cfg.thinking,
      endpointLabel: `${cfg.protocol === 'anthropic' ? 'Anthropic' : 'OpenAI'} · ${cfg.model}`,
      override: {
        provider: 'custom',
        protocol: cfg.protocol,
        url: cfg.url.trim(),
        apiKey: cfg.apiKey.trim(),
        model: cfg.model.trim(),
      },
    }
  }
  if (cfg.mode === 'official') {
    const key = cfg.apiKey?.trim() || settings.apiKey?.trim() || ''
    if (!key) {
      return null
    }
    const model = cfg.model.trim() || 'deepseek-flash'
    return {
      apiKey: key,
      thinking: cfg.thinking,
      endpointLabel: `DeepSeek · ${model}`,
      override: {
        provider: 'official',
        apiKey: key,
        model,
      },
    }
  }
  const activeKey = getActiveApiKey(settings)
  if (!activeKey) {
    return null
  }
  const modelLabel =
    settings.apiProvider === 'custom'
      ? settings.customApiModel.trim() || 'custom'
      : 'deepseek-flash'
  return {
    apiKey: activeKey,
    thinking: cfg.thinking,
    endpointLabel:
      settings.apiProvider === 'custom' ? `全局自定义 · ${modelLabel}` : `全局 · ${modelLabel}`,
  }
}

const pickNextSpeakerId = (preferredPetId?: string): string | null => {
  const members = getChatroomPetIds()
  if (members.length === 0) {
    return null
  }
  if (preferredPetId && members.includes(preferredPetId)) {
    return preferredPetId
  }
  const latest = usePetChatroom.getState().messages.at(-1)
  if (latest?.senderType === 'user') {
    const matched = members.find((id) => {
      const def = findPetById(id)
      return (
        latest.content.includes(`@${def.name['zh-CN']}`) ||
        latest.content.toLowerCase().includes(`@${def.name['en-US'].toLowerCase()}`) ||
        latest.content.includes(def.name['zh-CN'])
      )
    })
    if (matched) {
      return matched
    }
  }
  if (members.length === 1) {
    return members[0]
  }
  lastSpeakerIdx = (lastSpeakerIdx + 1) % members.length
  let candidate = members[lastSpeakerIdx]
  if (latest?.senderType === 'pet' && latest.petId === candidate) {
    lastSpeakerIdx = (lastSpeakerIdx + 1) % members.length
    candidate = members[lastSpeakerIdx]
  }
  return candidate
}

export const triggerPetChatroomTurn = async (preferredPetId?: string): Promise<void> => {
  const current = usePetChatroom.getState()
  if (current.streamingPetId) {
    return
  }
  const petId = pickNextSpeakerId(preferredPetId)
  if (!petId) {
    return
  }
  const resolved = resolvePetApiOverride(petId)
  const locale = useSettings.getState().locale
  if (!resolved) {
    if (!ensureApiKey()) {
      pauseChatroomLoop()
      return
    }
    const petName = findPetById(petId).name[locale]
    usePetChatroom.setState({
      errorText:
        locale === 'zh-CN'
          ? `「${petName}」的独立自定义 API 未填写完整`
          : `Incomplete custom API for ${petName}`,
    })
    pauseChatroomLoop()
    return
  }

  const controller = new AbortController()
  activeTurnController = controller
  const startedAt = Date.now()
  const pet = findPetById(petId)
  const petName = pet.name[locale]
  const roomMessages = usePetChatroom.getState().messages

  usePetChatroom.setState({
    streamingPetId: petId,
    streamingText: '',
    errorText: null,
  })
  setPetMood('think', petId)

  let accumulated = ''
  let latestUsage: MessageUsage | undefined

  try {
    const events = streamMessage(
      resolved.apiKey,
      {
        model: 'deepseek-flash',
        system: buildPetStaticSystemPrompt(petId),
        messages: buildPetLaneMessages(petId, roomMessages),
        thinking: { type: resolved.thinking ? 'enabled' : 'disabled' },
        safety_check: { level: 'high' },
      },
      controller.signal,
      `mywhale-petroom-${current.roomId}-${petId}`,
      resolved.override
    )

    for await (const ev of events) {
      if (controller.signal.aborted) {
        return
      }
      if (ev.type === 'message_start' && ev.message.usage) {
        latestUsage = ev.message.usage
      } else if (ev.type === 'message_delta' && ev.usage) {
        latestUsage = ev.usage
      } else if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
        accumulated += ev.delta.text
        usePetChatroom.setState({ streamingText: accumulated })
        setPetMood('speak', petId)
      }
    }

    const replyText = accumulated.trim()
    const latency = Date.now() - startedAt
    if (replyText) {
      appendRoomMessage({
        id: createId(),
        senderType: 'pet',
        petId,
        senderName: petName,
        content: replyText,
        createdAt: Date.now(),
      })
    }

    usePetChatroom.setState((prev) => ({
      streamingPetId: null,
      streamingText: '',
      petDebugStats: {
        ...prev.petDebugStats,
        [petId]: {
          lastLatencyMs: latency,
          inputTokens: latestUsage?.input_tokens ?? 0,
          cacheReadTokens: latestUsage?.cache_read_input_tokens ?? 0,
          outputTokens: latestUsage?.output_tokens ?? 0,
          endpointLabel: resolved.endpointLabel,
          errorText: null,
          updatedAt: Date.now(),
        },
      },
    }))
    setPetMood('laugh', petId)
    window.setTimeout(() => setPetMood('idle', petId), 1800)
  } catch (error) {
    if (controller.signal.aborted) {
      setPetMood('idle', petId)
      return
    }
    const msg = error instanceof Error ? error.message : String(error)
    usePetChatroom.setState((prev) => ({
      streamingPetId: null,
      streamingText: '',
      errorText: `${petName}: ${msg}`,
      petDebugStats: {
        ...prev.petDebugStats,
        [petId]: {
          lastLatencyMs: Date.now() - startedAt,
          inputTokens: 0,
          cacheReadTokens: 0,
          outputTokens: 0,
          endpointLabel: resolved.endpointLabel,
          errorText: msg,
          updatedAt: Date.now(),
        },
      },
    }))
    setPetMood('sad', petId)
  } finally {
    if (activeTurnController === controller) {
      activeTurnController = null
    }
  }
}

const armCountdown = () => {
  clearLoopTimer()
  const sec = usePetChatroom.getState().autoIntervalSec
  usePetChatroom.setState({ countdownSec: sec })
  loopTimerId = window.setInterval(() => {
    const st = usePetChatroom.getState()
    if (!st.running) {
      clearLoopTimer()
      return
    }
    if (st.streamingPetId) {
      return
    }
    const next = (st.countdownSec ?? st.autoIntervalSec) - 1
    if (next <= 0) {
      usePetChatroom.setState({ countdownSec: st.autoIntervalSec })
      void triggerPetChatroomTurn()
    } else {
      usePetChatroom.setState({ countdownSec: next })
    }
  }, 1000)
}

export const startChatroomLoop = () => {
  if (!ensureApiKey()) {
    return
  }
  usePetChatroom.setState({ running: true, errorText: null })
  armCountdown()
  if (!usePetChatroom.getState().streamingPetId) {
    void triggerPetChatroomTurn()
  }
}

export const pauseChatroomLoop = () => {
  clearLoopTimer()
  abortActiveTurn()
  usePetChatroom.setState({
    running: false,
    countdownSec: null,
    streamingPetId: null,
    streamingText: '',
  })
}

export const toggleChatroomRunning = () => {
  if (usePetChatroom.getState().running) {
    pauseChatroomLoop()
  } else {
    startChatroomLoop()
  }
}

export const setChatroomIntervalSec = (seconds: number) => {
  const clamped = Math.max(5, Math.min(300, Math.round(seconds)))
  usePetChatroom.setState((prev) => {
    const nextState: PetChatroomStoreState = {
      ...prev,
      autoIntervalSec: clamped,
      countdownSec: prev.running ? clamped : null,
    }
    writeStoredRoom(nextState)
    return {
      autoIntervalSec: clamped,
      countdownSec: nextState.countdownSec,
    }
  })
}

export const sendUserToPetChatroom = (rawText: string) => {
  const text = rawText.trim()
  if (!text) {
    return
  }
  const locale = useSettings.getState().locale
  appendRoomMessage({
    id: createId(),
    senderType: 'user',
    senderName: locale === 'zh-CN' ? '我' : 'Me',
    content: text,
    createdAt: Date.now(),
  })
  if (usePetChatroom.getState().running) {
    usePetChatroom.setState({ countdownSec: usePetChatroom.getState().autoIntervalSec })
  }
  if (!usePetChatroom.getState().streamingPetId) {
    void triggerPetChatroomTurn()
  }
}

export const saveChatroomToMainSession = (openAfterSave = false): string | null => {
  const st = usePetChatroom.getState()
  if (st.messages.length === 0) {
    return null
  }
  const locale = useSettings.getState().locale
  const memberNames = getChatroomPetIds()
    .map((id) => findPetById(id).name[locale])
    .slice(0, 3)
    .join('·')
  const title =
    locale === 'zh-CN'
      ? `桌宠聊天室${memberNames ? ` (${memberNames})` : ''}`
      : `Pet Chatroom${memberNames ? ` (${memberNames})` : ''}`

  const entries: PetChatroomSaveEntry[] = st.messages.map((msg) =>
    msg.senderType === 'pet'
      ? {
          id: msg.id,
          role: 'assistant',
          content: msg.content,
          createdAt: msg.createdAt,
          personaName: msg.senderName,
        }
      : {
          id: msg.id,
          role: 'user',
          content: msg.senderType === 'system' ? msg.content : msg.content,
          createdAt: msg.createdAt,
        }
  )

  const savedId = savePetChatroomSession({
    sessionId: st.linkedSessionId,
    title,
    entries,
  })
  if (savedId) {
    usePetChatroom.setState((prev) => {
      const next = { ...prev, linkedSessionId: savedId }
      writeStoredRoom(next)
      return { linkedSessionId: savedId }
    })
    if (openAfterSave) {
      selectSession(savedId)
      closePetChatroom()
    }
  }
  return savedId
}

export const resetPetChatroom = () => {
  pauseChatroomLoop()
  usePetChatroom.setState((prev) => {
    const next: PetChatroomStoreState = {
      ...prev,
      roomId: createId(),
      linkedSessionId: null,
      messages: [],
      errorText: null,
    }
    writeStoredRoom(next)
    return {
      roomId: next.roomId,
      linkedSessionId: null,
      messages: [],
      errorText: null,
    }
  })
}
