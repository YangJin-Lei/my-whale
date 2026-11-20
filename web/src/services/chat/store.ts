import { create } from 'zustand'
import { createId } from '../../utils/id.js'
import { ApiError, streamMessage } from '../api/client.js'
import type { ChatModel, CreateMessageRequest } from '../api/types.js'
import {
  classifyApiError,
  extractFileIds,
  getFileErrorCode,
  isContextLengthError,
  isRetryableApiError,
} from '../api/errors.js'
import { cancelUpload, describeUploadError, uploadAttachment, useUploads } from '../attachments.js'
import { debouncedRefreshBalance, markInsufficient } from '../balance.js'
import {
  COMPACTION_PRESETS,
  abortCompaction,
  clearCompactionController,
  estimateHistoryTokens,
  fitRequestHistory,
  formatCompactionRecordsBlock,
  recallCompactedEvidence,
  registerCompactionController,
  runCompactionPass,
} from './compaction.js'
import {
  flushPendingExtracts,
  registerLocalMemorySink,
  runExtractNow,
  scheduleExtract,
  seedExtractedBaseline,
} from '../memory/extract.js'
import { selectMemories } from '../memory/select.js'
import { initMemories, markMemoriesUsed, useMemoryStore } from '../memory/store.js'
import type { Memory } from '../memory/types.js'
import { DEFAULT_PERSONA_ID, MY_WHALE_ASSISTANT_ID } from '../persona/builtin.js'
import { buildSystemPrompt } from '../persona/prompt.js'
import { findPersona, initPersonas, toPersonaSnapshot, usePersonaStore } from '../persona/store.js'
import {
  SESSION_NOTE_MAX,
  type MemoryScope,
  type Persona,
  type SessionPersona,
} from '../persona/types.js'
import { setSearch, setThinking, useSettings } from '../settings.js'
import { autoPlayReadAloud } from '../speech/readAloud.js'
import { appendBranch, getVisibleMessages, normalizeSession, selectVersion } from './branches.js'
import * as db from './db.js'
import {
  clearAllDrafts,
  clearDraft,
  clearSentDraft,
  getDraft,
  prepareDraftMessage,
} from './drafts.js'
import { createLatestReminder } from './latestReminder.js'
import {
  applyEvent,
  canContinueReply,
  getContextRounds,
  settleReply,
  toRequestMessages,
} from './reply.js'
import {
  toSessionSummary,
  type AssistantMessage,
  type CompactionLevel,
  type FileAttachment,
  type Message,
  type Session,
  type SessionSummary,
  type UserMessage,
} from './types.js'

/** deepseek-flash 同时支持深度思考与图片输入 */
const MODEL: ChatModel = 'deepseek-flash'
/** 保留最近打开的详情；当前会话、生成中及尚未成功保存的会话不淘汰。 */
const SESSION_CACHE_LIMIT = 5
/** 安全审核固定开启，所有请求都走扩展模式 */
const SAFETY_CHECK = { level: 'high' } as const
/** 服务端判定 file_id 失效后，重新补传并重发的最多次数（不含首次请求） */
const FILE_RETRY_LIMIT = 2
/** 退避基数，第 n 次重试等待 2^n 倍；连续失败达到上限就放弃，把原始报错展示出来 */
const FILE_RETRY_BASE_DELAY = 1000

/** 阅读链接始终开启，智能搜索开关控制是否另行声明搜索工具（含边想边搜）。 */
const serverTools = (search: boolean): CreateMessageRequest['tools'] => {
  const tools: CreateMessageRequest['tools'] = [
    { type: 'deepseek_read_url', name: 'deepseek_read_url' },
  ]
  if (search) {
    tools.push({ type: 'deepseek_web_search', name: 'deepseek_web_search' })
  }
  return tools
}

/** 允许自动补标题的请求；手动重命名后取消本轮标题写入，包含主动清空标题的情况。 */
const titleRequests = new Set<AbortController>()

type ChatState = {
  ready: boolean
  initError: boolean
  /** 历史导入或全部删除期间锁定交互，提交成功前仍展示原有记录。 */
  importingHistory: boolean
  /** 仅列表元数据，按 updatedAt 降序；流式消息更新不会改变此数组。 */
  sessions: SessionSummary[]
  sessionCache: Record<string, Session>
  sessionLoadErrors: Record<string, boolean>
  sessionSaveErrors: Record<string, boolean>
  /** null 表示新对话（欢迎页） */
  activeId: string | null
  /** 正在生成回复的会话 */
  streaming: Record<string, AbortController>
  /** 新建会话待用的人设 ID、局部微调与无痕开关 */
  draftPersonaId: string
  draftAssistantOverride: { name: string; avatar: string; instructions: string } | null
  draftIncognito: boolean
}

export const useChatStore = create<ChatState>(() => ({
  ready: false,
  initError: false,
  importingHistory: false,
  sessions: [],
  sessionCache: {},
  sessionLoadErrors: {},
  sessionSaveErrors: {},
  activeId: null,
  streaming: {},
  draftPersonaId: useSettings.getState().defaultPersonaId || DEFAULT_PERSONA_ID,
  draftAssistantOverride: null,
  draftIncognito: false,
}))

const { getState: get, setState: set } = useChatStore

const sortSessions = (sessions: SessionSummary[]) =>
  [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)

const getSession = (id: string) => {
  const cache = get().sessionCache
  return Object.hasOwn(cache, id) ? cache[id] : undefined
}

const getStreamController = (id: string) => {
  const streams = get().streaming
  return Object.hasOwn(streams, id) ? streams[id] : undefined
}

const sameSummary = (a: SessionSummary, b: SessionSummary) =>
  a.title === b.title &&
  a.createdAt === b.createdAt &&
  a.updatedAt === b.updatedAt &&
  a.personaAvatar === b.personaAvatar

const sessionAccess = new Map<string, number>()
const unsavedSessions = new Set<string>()
/** 临时试聊会话，不保存到 IndexedDB 与侧边栏列表 */
const ephemeralSessions = new Set<string>()
/** 保存失败时保留原件，重试成功后才释放。 */
const pendingFiles = new Map<string, db.StoredFile[]>()
const deletingSessions = new Set<string>()
const deletionTasks = new Set<Promise<boolean>>()
const streamFlushes = new Map<string, () => void>()
let accessSequence = 0
let historyEpoch = 0
let initTask: Promise<void> | undefined
const sessionLoads = new Map<string, { promise: Promise<void> }>()

const touchSession = (id: string) => sessionAccess.set(id, ++accessSequence)

const trimSessionCache = () => {
  const state = get()
  const ids = Object.keys(state.sessionCache)
  if (ids.length <= SESSION_CACHE_LIMIT) {
    return
  }
  const removable = ids
    .filter(
      (id) =>
        id !== state.activeId &&
        !Object.hasOwn(state.streaming, id) &&
        !unsavedSessions.has(id) &&
        !deletingSessions.has(id)
    )
    .sort((a, b) => (sessionAccess.get(a) ?? 0) - (sessionAccess.get(b) ?? 0))
  const evicted = new Set(removable.slice(0, ids.length - SESSION_CACHE_LIMIT))
  for (const id of evicted) {
    sessionAccess.delete(id)
  }
  if (evicted.size > 0) {
    set({
      sessionCache: Object.fromEntries(
        Object.entries(state.sessionCache).filter(([id]) => !evicted.has(id))
      ),
    })
  }
}

const updateSession = (id: string, update: (session: Session) => Session) =>
  set((state) => {
    const previous = Object.hasOwn(state.sessionCache, id) ? state.sessionCache[id] : undefined
    if (!previous) {
      return state
    }
    const session = update(previous)
    if (session === previous) {
      return state
    }
    return {
      sessionCache: { ...state.sessionCache, [id]: session },
      sessions:
        sameSummary(previous, session) || ephemeralSessions.has(id)
          ? state.sessions
          : sortSessions(
              state.sessions.map((summary) =>
                summary.id === id ? toSessionSummary(session) : summary
              )
            ),
    }
  })

const updateReply = (sessionId: string, reply: AssistantMessage) =>
  updateSession(sessionId, (session) => ({
    ...session,
    messages: session.messages.map((message) =>
      message.id === reply.id
        ? { ...reply, parentId: message.parentId, selectedChildId: message.selectedChildId }
        : message
    ),
  }))

const persist = (sessionId: string) => {
  if (ephemeralSessions.has(sessionId)) {
    return
  }
  const session = getSession(sessionId)
  if (session) {
    unsavedSessions.add(sessionId)
    if (deletingSessions.has(sessionId)) {
      return
    }
    const epoch = historyEpoch
    const files = pendingFiles.get(sessionId)
    void db
      .saveSession(session, files)
      .then(() => {
        if (epoch !== historyEpoch || !getSession(sessionId)) {
          return
        }
        if (pendingFiles.get(sessionId) === files) {
          pendingFiles.delete(sessionId)
        }
        if (getSession(sessionId) === session) {
          unsavedSessions.delete(sessionId)
          set((state) => ({
            sessionSaveErrors: Object.fromEntries(
              Object.entries(state.sessionSaveErrors).filter(([id]) => id !== sessionId)
            ),
          }))
          trimSessionCache()
        }
      })
      .catch((error: unknown) => {
        db.reportStorageError('save session')(error)
        if (epoch === historyEpoch && getSession(sessionId)) {
          set((state) => ({
            sessionSaveErrors: { ...state.sessionSaveErrors, [sessionId]: true },
          }))
        }
      })
  }
}

export const retrySaveSessions = () => {
  if (!get().importingHistory) {
    unsavedSessions.forEach(persist)
  }
}

/** 离开前先合并尚未绘制的增量；隐藏期间浏览器可能暂停动画帧。 */
export const bindChatPersistence = () => {
  const save = () => {
    if (get().importingHistory) {
      return
    }
    for (const [id, flush] of streamFlushes) {
      flush()
      persist(id)
    }
    for (const id of unsavedSessions) {
      if (!streamFlushes.has(id)) {
        persist(id)
      }
    }
    flushPendingExtracts()
  }
  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') {
      save()
    }
  }
  document.addEventListener('visibilitychange', onVisibilityChange)
  window.addEventListener('pagehide', save)
  return () => {
    document.removeEventListener('visibilitychange', onVisibilityChange)
    window.removeEventListener('pagehide', save)
  }
}

/** 按当前开关创建回复：深度思考对应 thinking，智能搜索控制 deepseek_web_search。 */
const createReply = (sessionId?: string): AssistantMessage => {
  const { thinking, search } = useSettings.getState()
  const snapshot = sessionId ? getSession(sessionId)?.persona?.snapshot : null
  return {
    id: createId(),
    role: 'assistant',
    createdAt: Date.now(),
    model: MODEL,
    thinking,
    search,
    ...(snapshot ? { personaName: snapshot.name, personaAvatar: snapshot.avatar } : {}),
    prefix: true,
    status: 'pending',
    blocks: [],
  }
}

/** 仍在生成中的回复（页面关闭或导出时未结束）按「已停止」处理 */
const settleInterrupted = (session: Session): Session => {
  if (
    !session.messages.some(
      (m) => m.role === 'assistant' && (m.status === 'pending' || m.status === 'streaming')
    )
  ) {
    return session
  }
  return {
    ...session,
    messages: session.messages.map((m) =>
      m.role === 'assistant' && (m.status === 'pending' || m.status === 'streaming')
        ? settleReply(m, 'stopped', session.updatedAt)
        : m
    ),
  }
}

export const initChat = (): Promise<void> => {
  if (get().ready) {
    return Promise.resolve()
  }
  if (initTask) {
    return initTask
  }
  const epoch = historyEpoch
  set({ initError: false })
  initTask = (async () => {
    try {
      const [summaries] = await Promise.all([
        db.loadSessionSummaries(),
        initPersonas(),
        initMemories(),
      ])
      if (epoch === historyEpoch) {
        set({ ready: true, sessions: sortSessions(summaries) })
      }
    } catch (error) {
      if (epoch === historyEpoch) {
        set({ initError: true })
        db.reportStorageError('read local sessions')(error)
      }
    } finally {
      if (epoch === historyEpoch) {
        initTask = undefined
      }
    }
  })()
  return initTask
}

/** 同一会话合并并发读取；切换只改变 activeId，旧请求不会把界面切回去。 */
const ensureSessionLoaded = (id: string): Promise<void> => {
  if (getSession(id)) {
    return Promise.resolve()
  }
  const pending = sessionLoads.get(id)
  if (pending) {
    return pending.promise
  }
  const epoch = historyEpoch
  set((state) => ({ sessionLoadErrors: { ...state.sessionLoadErrors, [id]: false } }))
  const load = { promise: Promise.resolve() }
  sessionLoads.set(id, load)
  load.promise = (async () => {
    try {
      const stored = await db.loadSession(id)
      if (epoch !== historyEpoch || sessionLoads.get(id) !== load) {
        return
      }
      const summary = get().sessions.find((session) => session.id === id)
      if (!summary) {
        return
      }
      if (!stored) {
        throw new Error(`Session ${id} is missing from local storage`)
      }
      const settled = settleInterrupted(normalizeSession(stored))
      // 读取期间可能已在列表重命名，保留最新元数据，不能让旧读取覆盖它。
      const session = sameSummary(settled, summary) ? settled : { ...settled, ...summary }
      seedExtractedBaseline(id, buildExtractTurns(session).length)
      touchSession(id)
      set((state) => ({ sessionCache: { ...state.sessionCache, [id]: session } }))
      if (session !== stored) {
        persist(id)
      }
      trimSessionCache()
    } catch (error) {
      if (epoch === historyEpoch && sessionLoads.get(id) === load) {
        set((state) => ({ sessionLoadErrors: { ...state.sessionLoadErrors, [id]: true } }))
        db.reportStorageError('read session')(error)
      }
    } finally {
      if (sessionLoads.get(id) === load) {
        sessionLoads.delete(id)
      }
    }
  })()
  return load.promise
}

/** 等所有回复的收尾（落盘）完成 */
const waitForIdle = (sessionId?: string) =>
  new Promise<void>((resolve) => {
    const isIdle = (state: ChatState) =>
      sessionId === undefined
        ? Object.keys(state.streaming).length === 0
        : !Object.hasOwn(state.streaming, sessionId)
    if (isIdle(get())) {
      resolve()
      return
    }
    const unsubscribe = useChatStore.subscribe((state) => {
      if (isIdle(state)) {
        unsubscribe()
        resolve()
      }
    })
  })

/**
 * 替换历史对话：先写入暂存，成功后原子替换旧记录；写入为空即删除全部会话与附件。
 * 期间停止生成并禁止修改会话；失败时清除暂存，保留原有记录。
 */
export const replaceHistory = async (write: () => Promise<void>): Promise<number> => {
  if (get().importingHistory) {
    throw new Error('History replacement is already in progress')
  }
  set({ importingHistory: true })
  try {
    for (const controller of Object.values(get().streaming)) {
      controller.abort()
    }
    // 已开始的单条删除先同步到内存，避免本次替换失败后列表残留已被删除的记录。
    await Promise.all(deletionTasks)
    historyEpoch += 1
    initTask = undefined
    sessionLoads.clear()
    await waitForIdle()
    await db.clearStaging()
    let summaries: SessionSummary[]
    try {
      await write()
      summaries = await db.commitStaging()
    } catch (error) {
      await db.clearStaging().catch(db.reportStorageError('clear unfinished history replacement'))
      throw error
    }
    sessionAccess.clear()
    unsavedSessions.clear()
    pendingFiles.clear()
    clearAllDrafts()
    set({
      ready: true,
      initError: false,
      sessions: sortSessions(summaries),
      sessionCache: {},
      sessionLoadErrors: {},
      sessionSaveErrors: {},
      activeId: null,
    })
    return summaries.length
  } finally {
    set({ importingHistory: false })
    retrySaveSessions()
    const { activeId, ready } = get()
    // 替换失败时恢复被取消的详情读取，原有记录继续可用。
    if (activeId !== null) {
      void ensureSessionLoaded(activeId)
    } else if (!ready) {
      void initChat()
    }
  }
}

export const mergeHistory = async (
  sessions: readonly Session[],
  files: readonly db.StoredFile[]
): Promise<{ importedSessions: number; totalSessions: number }> => {
  if (get().importingHistory) {
    throw new Error('History replacement is already in progress')
  }
  set({ importingHistory: true })
  try {
    for (const controller of Object.values(get().streaming)) {
      controller.abort()
    }
    await Promise.all(deletionTasks)
    await waitForIdle()
    const result = await db.mergeSessionsAndFiles(sessions, files)
    set((state) => {
      const incomingIds = new Set(sessions.map((s) => s.id))
      const nextCache = Object.fromEntries(
        Object.entries(state.sessionCache).filter(([id]) => !incomingIds.has(id))
      )
      return {
        ready: true,
        initError: false,
        sessions: sortSessions(result.sessions),
        sessionCache: nextCache,
      }
    })
    return { importedSessions: result.importedSessions, totalSessions: result.sessions.length }
  } finally {
    set({ importingHistory: false })
    retrySaveSessions()
    const { activeId } = get()
    if (activeId !== null) {
      void ensureSessionLoaded(activeId)
    }
  }
}

const cleanupEphemeralIfLeaving = (nextActiveId: string | null) => {
  const prevId = get().activeId
  if (!prevId || prevId === nextActiveId || !ephemeralSessions.has(prevId)) {
    return
  }
  getStreamController(prevId)?.abort()
  ephemeralSessions.delete(prevId)
  set((state) => ({
    sessionCache: Object.fromEntries(
      Object.entries(state.sessionCache).filter(([id]) => id !== prevId)
    ),
  }))
}

export const isEphemeralSession = (sessionId: string): boolean => ephemeralSessions.has(sessionId)

const applyPersonaDefaults = (persona: Persona) => {
  if (persona.defaults?.thinking !== undefined) {
    setThinking(persona.defaults.thinking)
  }
  if (persona.defaults?.search !== undefined) {
    setSearch(persona.defaults.search)
  }
}

export const setDraftPersona = (persona: Persona) => {
  set({
    draftPersonaId: persona.id,
    ...(persona.id !== MY_WHALE_ASSISTANT_ID ? { draftAssistantOverride: null } : {}),
  })
  applyPersonaDefaults(persona)
}

export const setDraftAssistantOverride = (
  override: { name: string; avatar: string; instructions: string } | null
) => {
  set({
    draftPersonaId: MY_WHALE_ASSISTANT_ID,
    draftAssistantOverride: override,
  })
}

export const setDraftIncognito = (draftIncognito: boolean) => {
  set({ draftIncognito })
}

export const startTrialChat = (persona: Persona) => {
  if (get().importingHistory) {
    return
  }
  cleanupEphemeralIfLeaving(null)
  const now = Date.now()
  const session: Session = {
    id: `trial-${createId()}`,
    title: `${persona.name}`,
    createdAt: now,
    updatedAt: now,
    messages: [],
    rootMessageId: null,
    persona: {
      personaId: persona.id,
      snapshot: toPersonaSnapshot(persona),
      incognito: true,
    },
  }
  ephemeralSessions.add(session.id)
  applyPersonaDefaults(persona)
  set((state) => ({
    sessionCache: { ...state.sessionCache, [session.id]: session },
    activeId: session.id,
  }))
}

/** 从设置中选择人设后进入欢迎页发起普通对话（发送首条消息即保存到左侧对话列表） */
export const startChatWithPersona = (persona: Persona) => {
  if (get().importingHistory) {
    return
  }
  flushPendingExtracts()
  cleanupEphemeralIfLeaving(null)
  applyPersonaDefaults(persona)
  set({ activeId: null, draftPersonaId: persona.id, draftIncognito: false })
  trimSessionCache()
}

/** 将「试聊」临时会话转为正式保存会话，展示在左侧对话列表 */
export const promoteTrialSession = (sessionId: string): boolean => {
  const session = getSession(sessionId)
  if (!session || !ephemeralSessions.has(sessionId) || get().importingHistory) {
    return false
  }
  ephemeralSessions.delete(sessionId)
  touchSession(sessionId)
  set((state) => ({
    sessions: state.sessions.some((item) => item.id === sessionId)
      ? state.sessions
      : sortSessions([toSessionSummary(session), ...state.sessions]),
  }))
  persist(sessionId)
  return true
}

export const newChat = () => {
  if (!get().importingHistory) {
    flushPendingExtracts()
    cleanupEphemeralIfLeaving(null)
    const { defaultPersonaId, locale } = useSettings.getState()
    const personaId = defaultPersonaId || DEFAULT_PERSONA_ID
    const persona = findPersona(personaId, usePersonaStore.getState().personas, locale)
    applyPersonaDefaults(persona)
    set({ activeId: null, draftPersonaId: persona.id, draftIncognito: false })
    trimSessionCache()
  }
}

export const selectSession = (id: string) => {
  if (!get().importingHistory && get().sessions.some((session) => session.id === id)) {
    flushPendingExtracts()
    cleanupEphemeralIfLeaving(id)
    touchSession(id)
    set({ activeId: id })
    void ensureSessionLoaded(id)
    trimSessionCache()
  }
}

export const renameSession = (id: string, title: string) => {
  if (get().importingHistory || deletingSessions.has(id)) {
    return
  }
  const controller = getStreamController(id)
  if (controller) {
    titleRequests.delete(controller)
  }
  if (getSession(id)) {
    updateSession(id, (session) => ({ ...session, title }))
    persist(id)
  } else {
    set((state) => ({
      sessions: state.sessions.map((session) =>
        session.id === id ? { ...session, title } : session
      ),
    }))
    void db.renameSession(id, title).catch(db.reportStorageError('rename session'))
  }
}

/**
 * 删除会话；本地原件仅在没有其他会话引用时清理。远端文件不删：导入、编辑、重新生成都会复用同一个附件，
 * 同一服务端文件可能被多个会话引用，不维护引用计数。
 */
export const removeSession = (id: string): Promise<boolean> => {
  const task = removeSessionData(id).finally(() => deletionTasks.delete(task))
  deletionTasks.add(task)
  return task
}

const removeSessionData = async (id: string): Promise<boolean> => {
  if (get().importingHistory || deletingSessions.has(id)) {
    return false
  }
  const epoch = historyEpoch
  deletingSessions.add(id)
  try {
    getStreamController(id)?.abort()
    // 等本会话的流收尾，避免删除之后又被收尾保存写回来。
    await waitForIdle(id)
    if (epoch !== historyEpoch) {
      return false
    }
    await db.deleteSession(id)
    if (epoch !== historyEpoch) {
      return true
    }
    sessionLoads.delete(id)
    sessionAccess.delete(id)
    unsavedSessions.delete(id)
    pendingFiles.delete(id)
    clearDraft(id)
    set((state) => ({
      sessions: state.sessions.filter((session) => session.id !== id),
      sessionCache: Object.fromEntries(
        Object.entries(state.sessionCache).filter(([key]) => key !== id)
      ),
      sessionLoadErrors: Object.fromEntries(
        Object.entries(state.sessionLoadErrors).filter(([key]) => key !== id)
      ),
      sessionSaveErrors: Object.fromEntries(
        Object.entries(state.sessionSaveErrors).filter(([key]) => key !== id)
      ),
      activeId: state.activeId === id ? null : state.activeId,
    }))
    return true
  } catch (error) {
    db.reportStorageError('delete session')(error)
    return false
  } finally {
    deletingSessions.delete(id)
    // 删除失败时保留会话，并保存停止生成后的最新状态。
    if (getSession(id)) {
      if (get().importingHistory) {
        unsavedSessions.add(id)
      } else {
        persist(id)
      }
    }
  }
}

export const stopReply = (sessionId: string) => getStreamController(sessionId)?.abort()

/**
 * 提交指定会话的最新草稿；null 表示新建会话。
 * 同步接收成功才清空草稿，附件原件由会话接管；保存失败仍通过保存入口重试。
 */
export const sendMessage = (targetSessionId: string | null) => {
  if (get().importingHistory || !get().ready) {
    return false
  }
  const prepared = prepareDraftMessage(getDraft(targetSessionId), useUploads.getState().tasks)
  if (!prepared) {
    return false
  }
  const { text, files } = prepared
  const now = Date.now()
  let sessionId = targetSessionId
  if (
    sessionId !== null &&
    (deletingSessions.has(sessionId) || getStreamController(sessionId) || !getSession(sessionId))
  ) {
    return false
  }
  if (sessionId === null) {
    const { draftPersonaId, draftIncognito, draftAssistantOverride } = get()
    const { locale } = useSettings.getState()
    const persona = findPersona(draftPersonaId, usePersonaStore.getState().personas, locale)
    const snapshot =
      draftPersonaId === MY_WHALE_ASSISTANT_ID && draftAssistantOverride
        ? {
            name: draftAssistantOverride.name.trim() || persona.name,
            avatar: draftAssistantOverride.avatar.trim(),
            instructions: draftAssistantOverride.instructions.trim() || persona.instructions,
          }
        : toPersonaSnapshot(persona)
    const sessionPersona: SessionPersona = {
      personaId: persona.id,
      snapshot,
      ...(draftIncognito ? { incognito: true } : {}),
    }
    const session: Session = {
      id: createId(),
      title: '',
      createdAt: now,
      updatedAt: now,
      messages: [],
      rootMessageId: null,
      persona: sessionPersona,
    }
    sessionId = session.id
    touchSession(session.id)
    set((state) => ({
      sessions: [toSessionSummary(session), ...state.sessions],
      sessionCache: { ...state.sessionCache, [session.id]: session },
      activeId: session.id,
    }))
  }
  const current = getSession(sessionId)
  if (!current) {
    return false
  }
  const history = getVisibleMessages(current)
  const question: UserMessage = {
    id: createId(),
    role: 'user',
    content: text,
    files: files.map(({ id, serverId, name, size, isImage, mimeType }) => ({
      id,
      serverId,
      name,
      size,
      isImage,
      mimeType,
    })),
    createdAt: now,
  }
  const reply = createReply(sessionId)
  updateSession(sessionId, (session) => ({
    ...appendBranch(session, history.at(-1)?.id ?? null, [question, reply]),
    updatedAt: now,
  }))
  if (files.length > 0) {
    pendingFiles.set(sessionId, [
      ...(pendingFiles.get(sessionId) ?? []),
      ...files.map(({ id, blob }) => ({ id, blob })),
    ])
  }
  persist(sessionId)
  clearSentDraft(targetSessionId)
  void streamReply(sessionId, reply, { history, question })
  return true
}

/** 重新生成当前路径上的回答：在原问题下新增版本，不覆盖旧回答和后续对话。 */
export const regenerateReply = (sessionId: string, messageId?: string) => {
  if (get().importingHistory || deletingSessions.has(sessionId)) {
    return
  }
  const session = getSession(sessionId)
  if (!session || getStreamController(sessionId)) {
    return
  }
  const path = getVisibleMessages(session)
  const index =
    messageId === undefined ? path.length - 1 : path.findIndex((m) => m.id === messageId)
  const question = path[index - 1]
  if (question?.role !== 'user' || path[index]?.role !== 'assistant') {
    return
  }
  const history = path.slice(0, index - 1)
  const reply = createReply(sessionId)
  updateSession(sessionId, (s) => ({
    ...appendBranch(s, question.id, [reply]),
    updatedAt: Date.now(),
  }))
  persist(sessionId)
  void streamReply(sessionId, reply, { history, question })
}

/** 编辑提问后新增同父版本，保留原文件；旧问题的所有回答与后续对话仍可切回。 */
export const editMessage = (sessionId: string, messageId: string, content: string): boolean => {
  if (get().importingHistory || deletingSessions.has(sessionId)) {
    return false
  }
  const session = getSession(sessionId)
  if (!session || getStreamController(sessionId)) {
    return false
  }
  const path = getVisibleMessages(session)
  const index = path.findIndex((message) => message.id === messageId)
  const previous = path[index]
  const text = content.trim()
  if (previous?.role !== 'user' || (!text && previous.files.length === 0)) {
    return false
  }
  const question: UserMessage = {
    id: createId(),
    role: 'user',
    content: text,
    files: previous.files,
    createdAt: Date.now(),
  }
  const reply = createReply(sessionId)
  updateSession(sessionId, (s) => ({
    ...appendBranch(s, path[index - 1]?.id ?? null, [question, reply]),
    updatedAt: Date.now(),
  }))
  persist(sessionId)
  void streamReply(sessionId, reply, { history: path.slice(0, index), question })
  return true
}

export const selectMessageVersion = (sessionId: string, messageId: string) => {
  if (get().importingHistory || deletingSessions.has(sessionId)) {
    return
  }
  if (getStreamController(sessionId)) {
    return
  }
  updateSession(sessionId, (session) => selectVersion(session, messageId))
  persist(sessionId)
}

/** 继续最后一条未完成的回答：保留原消息与开关，仅将新流的内容追加到原块之后。 */
export const continueReply = (sessionId: string, messageId: string) => {
  if (get().importingHistory || deletingSessions.has(sessionId)) {
    return
  }
  const session = getSession(sessionId)
  if (!session || getStreamController(sessionId)) {
    return
  }
  const path = getVisibleMessages(session)
  const question = path.at(-2)
  const previous = path.at(-1)
  if (
    question?.role !== 'user' ||
    previous?.role !== 'assistant' ||
    previous.id !== messageId ||
    !canContinueReply(previous)
  ) {
    return
  }
  const { thinking, search } = useSettings.getState()
  const reply: AssistantMessage = {
    ...previous,
    // 未记录请求配置的回复，续写时使用默认模型和当前开关。
    model: previous.model ?? MODEL,
    thinking: previous.thinking ?? thinking,
    search: previous.search ?? search,
    status: 'pending',
    stopReason: undefined,
    stopDetails: undefined,
    error: undefined,
  }
  updateReply(sessionId, reply)
  updateSession(sessionId, (s) => ({ ...s, updatedAt: Date.now() }))
  persist(sessionId)
  void streamReply(sessionId, reply, { history: path.slice(0, -2), question, prefix: previous })
}

/** 附件补传失败后重试：保留原回答位置，重新补传并请求 */
export const retryUpload = (sessionId: string, messageId: string) => {
  if (get().importingHistory || deletingSessions.has(sessionId)) {
    return
  }
  const session = getSession(sessionId)
  if (!session || getStreamController(sessionId)) {
    return
  }
  const path = getVisibleMessages(session)
  const index = path.findIndex((message) => message.id === messageId)
  const question = path[index - 1]
  const previous = path[index]
  if (
    question?.role !== 'user' ||
    previous?.role !== 'assistant' ||
    previous.error?.kind !== 'upload'
  ) {
    return
  }
  const reply: AssistantMessage = { ...previous, status: 'pending', error: undefined }
  updateReply(sessionId, reply)
  persist(sessionId)
  void streamReply(sessionId, reply, { history: path.slice(0, index - 1), question })
}

type Request = { history: Message[]; question: UserMessage; prefix?: AssistantMessage }

/** 把补传得到的 serverId 写回会话里所有引用同一附件的消息（编辑、重新生成会共用附件） */
const saveServerIds = (sessionId: string, serverIds: Map<string, string>) => {
  if (serverIds.size === 0) {
    return
  }
  updateSession(sessionId, (session) => ({
    ...session,
    messages: session.messages.map((message) =>
      message.role === 'user' && message.files.some((file) => serverIds.has(file.id))
        ? {
            ...message,
            files: message.files.map((file) =>
              serverIds.has(file.id) ? { ...file, serverId: serverIds.get(file.id) ?? null } : file
            ),
          }
        : message
    ),
  }))
  persist(sessionId)
}

/**
 * 附件的服务端 id：已有直接用；正在上传的等待同一任务；否则读取本地原件补传。
 * 本地也没有原件（导入的文档附件只有元数据）时返回 null，该附件只展示、不进入请求。
 */
const ensureServerId = async (apiKey: string, file: FileAttachment): Promise<string | null> => {
  if (file.serverId) {
    return file.serverId
  }
  const task = useUploads.getState().tasks[file.id]
  if (task?.status === 'done') {
    return task.serverId
  }
  const blob = await db.loadFile(file.id)
  if (!blob) {
    return null
  }
  return uploadAttachment(apiKey, file.id, blob, file.name, file.isImage)
}

/** 用会话里的最新消息替换请求快照：重传前会重置附件的 serverId，快照必须跟着更新 */
const refreshRequest = (sessionId: string, request: Request): Request => {
  const session = getSession(sessionId)
  if (!session) {
    return request
  }
  const byId = new Map(session.messages.map((message) => [message.id, message]))
  const pick = <T extends Message>(message: T): T =>
    (byId.get(message.id) as T | undefined) ?? message
  return {
    history: request.history.map(pick),
    question: pick(request.question),
    prefix: request.prefix,
  }
}

/**
 * 发送前补齐附件的 serverId。
 * - 本轮提问的附件并行补齐，任一失败则整体失败，已成功的照常写回，重试时复用成功结果；
 * - 历史轮次（仅进入上下文的）中没有 serverId 的附件，多为导入的图片：从最新的消息往前逐张补传，
 *   失败静默跳过，该附件不进入本次请求，下次发送时再试。
 */
const prepareFiles = async (sessionId: string, request: Request, signal: AbortSignal) => {
  const epoch = historyEpoch
  // 服务端判定 file_id 失效时会清掉会话里的 serverId，先用最新消息替换请求快照，
  // 否则快照里仍是旧 id，补传会直接复用它。
  request = refreshRequest(sessionId, request)
  const apiKey = useSettings.getState().apiKey ?? ''
  const serverIds = new Map<string, string>()
  // 停止生成立即生效；上传本身不取消（输入框与其他消息可能共用同一任务），完成后照常写回 serverId
  const aborted = new Promise<never>((_, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  })
  const uploads = Promise.allSettled(
    request.question.files.map(async (file) => {
      const serverId = await ensureServerId(apiKey, file)
      if (serverId) {
        serverIds.set(file.id, serverId)
      }
    })
  )
  void uploads.then(() => {
    if (epoch === historyEpoch) {
      saveServerIds(sessionId, serverIds)
    }
  })
  const results = await Promise.race([uploads, aborted])
  const failed = results.find((result) => result.status === 'rejected')
  if (failed) {
    throw failed.reason
  }

  const pending = new Map<string, FileAttachment>()
  for (const [user] of getContextRounds(request.history).toReversed()) {
    for (const file of user.files) {
      if (!file.serverId && !serverIds.has(file.id) && !pending.has(file.id)) {
        pending.set(file.id, file)
      }
    }
  }
  for (const file of pending.values()) {
    signal.throwIfAborted()
    try {
      const serverId = await Promise.race([ensureServerId(apiKey, file), aborted])
      if (serverId) {
        serverIds.set(file.id, serverId)
        saveServerIds(sessionId, new Map([[file.id, serverId]]))
      }
    } catch {
      signal.throwIfAborted()
    }
  }

  // 用补齐后的会话重新取历史与提问，保证请求里都是 serverId
  const session = getSession(sessionId)
  const resolve = <T extends Message>(message: T): T =>
    (session?.messages.find((m) => m.id === message.id) as T | undefined) ?? message
  return {
    history: request.history.map(resolve),
    question: resolve(request.question),
    prefix: request.prefix,
  }
}

/** 本次请求实际会用到的服务端 file_id */
const collectServerFileIds = (request: Request): Set<string> => {
  const ids = new Set<string>()
  const add = (files: FileAttachment[]) => {
    for (const file of files) {
      if (file.serverId) {
        ids.add(file.serverId)
      }
    }
  }
  add(request.question.files)
  for (const [user] of getContextRounds(request.history)) {
    add(user.files)
  }
  return ids
}

/**
 * 服务端判定 file_id 失效时，清掉对应附件的 serverId 并丢弃旧的上传任务，
 * 下一次补齐会重新读取本地原件上传。报错里点名了 file_id 就只重置这些，
 * 没点名（如 invalid file_id）则重置本次请求用到的全部附件。
 */
const reuploadInvalidatedFiles = (sessionId: string, request: Request, error: unknown): boolean => {
  if (!(error instanceof ApiError) || !getFileErrorCode(error)) {
    return false
  }
  const mentioned = extractFileIds(error.message)
  // 重试时原始快照里还是上一轮已被清掉的 serverId，先换成会话里的最新消息
  const targets =
    mentioned.length > 0
      ? new Set(mentioned)
      : collectServerFileIds(refreshRequest(sessionId, request))
  const session = getSession(sessionId)
  if (targets.size === 0 || !session) {
    return false
  }
  const localIds: string[] = []
  const messages = session.messages.map((message) => {
    if (message.role !== 'user') {
      return message
    }
    let changed = false
    const files = message.files.map((file) => {
      if (!file.serverId || !targets.has(file.serverId)) {
        return file
      }
      localIds.push(file.id)
      changed = true
      return { ...file, serverId: null }
    })
    return changed ? { ...message, files } : message
  })
  if (localIds.length === 0) {
    return false
  }
  updateSession(sessionId, (current) => ({ ...current, messages }))
  // 上传任务里可能还留着同一个失效的 serverId，清掉后 ensureServerId 才会重新上传
  localIds.forEach(cancelUpload)
  persist(sessionId)
  return true
}

/** 重传前的退避等待；停止生成时立即返回，由调用方按已停止收尾 */
const waitForRetry = (attempt: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    function onAbort() {
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(
      () => {
        signal.removeEventListener('abort', onAbort)
        resolve()
      },
      FILE_RETRY_BASE_DELAY * 2 ** attempt
    )
    signal.addEventListener('abort', onAbort, { once: true })
  })

/**
 * 冻结提示词版本。调整系统提示词结构（如移除动态时间、把压缩摘要移出 system）后递增，
 * 让旧会话只重建一次，之后永久复用同一前缀。
 */
const FROZEN_PROMPT_VERSION = 2

/**
 * 系统提示词在会话首轮一次性冻结，之后永不重建：
 * 时间、位置、压缩摘要、会话中新增的记忆一律走请求末尾增量，
 * 保证发给 DeepSeek 的消息前缀逐字节稳定，KV 前缀缓存可持续命中。
 */
const resolveSessionSystemPrompt = (sessionId: string, query: string): string => {
  const session = getSession(sessionId)
  if (
    session?.persona?.frozenSystemPrompt &&
    session.persona.frozenPromptVersion === FROZEN_PROMPT_VERSION
  ) {
    return session.persona.frozenSystemPrompt
  }
  const { memoryEnabled, profile } = useSettings.getState()
  const incognito = Boolean(session?.persona?.incognito)
  const memoryScope: MemoryScope = session?.persona?.memoryScope ?? 'global_and_local'
  let chosenMemories: Memory[] = []
  let memoryIds = session?.persona?.memoryIds
  let memoryVersion = session?.persona?.memoryVersion
  let freshSelection = false

  if (memoryEnabled && !incognito && memoryScope !== 'local_only') {
    const { memories, version } = useMemoryStore.getState()
    memoryVersion = version
    const stableIds =
      memoryIds !== undefined && session?.persona?.memoryVersion === version ? memoryIds : undefined

    if (stableIds) {
      const byId = new Map(memories.filter((m) => m.enabled).map((m) => [m.id, m]))
      chosenMemories = stableIds.map((id) => byId.get(id)).filter((m): m is Memory => Boolean(m))
    } else {
      chosenMemories = selectMemories(memories, query)
      memoryIds = chosenMemories.map((m) => m.id)
      freshSelection = true
    }
  }

  const frozen = buildSystemPrompt({
    persona: session?.persona?.snapshot ?? null,
    sessionNote: session?.persona?.note,
    memoryEnabled,
    incognito,
    memoryScope,
    profile,
    memories: chosenMemories,
    // 会话中新增的局部记忆只作为请求末尾增量，不写进冻结提示词。
    localMemories: [],
    tunedMidSession: Boolean(
      session?.persona?.tunedMidSession || (session?.personaNotices?.length ?? 0) > 0
    ),
  })
  updateSession(sessionId, (current) => ({
    ...current,
    persona: {
      personaId: current.persona?.personaId ?? null,
      snapshot: current.persona?.snapshot ?? null,
      ...current.persona,
      ...(memoryIds === undefined ? {} : { memoryIds }),
      ...(memoryVersion === undefined ? {} : { memoryVersion }),
      frozenSystemPrompt: frozen,
      frozenPromptVersion: FROZEN_PROMPT_VERSION,
    },
  }))
  persist(sessionId)
  if (freshSelection && memoryIds && memoryIds.length > 0) {
    void markMemoriesUsed(memoryIds)
  }
  return frozen
}

export const getSessionUsedMemories = (sessionId: string): Memory[] => {
  const session = getSession(sessionId)
  const { memoryEnabled } = useSettings.getState()
  if (
    !session ||
    !memoryEnabled ||
    session.persona?.incognito ||
    session.persona?.memoryScope === 'local_only'
  ) {
    return []
  }
  const ids = session.persona?.memoryIds
  if (!ids?.length) {
    return []
  }
  const byId = new Map(
    useMemoryStore
      .getState()
      .memories.filter((m) => m.enabled)
      .map((m) => [m.id, m])
  )
  return ids.map((id) => byId.get(id)).filter((m): m is Memory => Boolean(m))
}

export const switchSessionPersona = (sessionId: string, persona: Persona) => {
  const session = getSession(sessionId)
  if (!session || getStreamController(sessionId)) {
    return
  }
  const visible = getVisibleMessages(session)
  const afterMessageId = visible.at(-1)?.id ?? null
  const nextSnapshot = toPersonaSnapshot(persona)
  applyPersonaDefaults(persona)
  updateSession(sessionId, (current) => ({
    ...current,
    persona: {
      ...current.persona,
      personaId: persona.id,
      snapshot: nextSnapshot,
      frozenSystemPrompt: undefined,
    },
    personaNotices: [
      ...(current.personaNotices ?? []),
      { afterMessageId, personaName: persona.name },
    ],
    updatedAt: Date.now(),
  }))
  persist(sessionId)
}

export const syncSessionPersonaSnapshot = (sessionId: string, persona: Persona) => {
  const session = getSession(sessionId)
  if (!session || getStreamController(sessionId)) {
    return
  }
  updateSession(sessionId, (current) => ({
    ...current,
    persona: {
      ...current.persona,
      personaId: persona.id,
      snapshot: toPersonaSnapshot(persona),
      frozenSystemPrompt: undefined,
    },
    updatedAt: Date.now(),
  }))
  persist(sessionId)
}

/**
 * 会话内就地微调当前助手（修改头像、名称、人设/回复语义），在同一对话继续无缝交流。
 */
export const tuneSessionAssistant = (
  sessionId: string,
  patch: { name: string; avatar: string; instructions: string }
) => {
  const session = getSession(sessionId)
  if (!session || getStreamController(sessionId)) {
    return
  }
  const cleanName = patch.name.trim() || session.persona?.snapshot?.name || 'my-whale助手'
  const cleanAvatar = patch.avatar.trim()
  const cleanInstructions = patch.instructions.trim()
  const visible = getVisibleMessages(session)
  const afterMessageId = visible.at(-1)?.id ?? null

  updateSession(sessionId, (current) => ({
    ...current,
    persona: {
      personaId: current.persona?.personaId ?? 'builtin-mywhale-assistant',
      ...current.persona,
      snapshot: {
        name: cleanName,
        avatar: cleanAvatar,
        instructions: cleanInstructions,
      },
      tunedMidSession: true,
      frozenSystemPrompt: undefined,
    },
    messages: current.messages.map((msg) =>
      msg.role === 'assistant'
        ? { ...msg, personaName: cleanName, personaAvatar: cleanAvatar }
        : msg
    ),
    personaNotices: [...(current.personaNotices ?? []), { afterMessageId, personaName: cleanName }],
    updatedAt: Date.now(),
  }))
  persist(sessionId)
}

export const updateSessionNote = (sessionId: string, note: string) => {
  const session = getSession(sessionId)
  if (!session) {
    return
  }
  const clean = note.trim().slice(0, SESSION_NOTE_MAX)
  updateSession(sessionId, (current) => ({
    ...current,
    persona: {
      personaId: current.persona?.personaId ?? null,
      snapshot: current.persona?.snapshot ?? null,
      ...current.persona,
      note: clean || undefined,
    },
    updatedAt: Date.now(),
  }))
  persist(sessionId)
}

export const toggleSessionIncognito = (sessionId: string, incognito: boolean) => {
  const session = getSession(sessionId)
  if (!session) {
    return
  }
  updateSession(sessionId, (current) => ({
    ...current,
    persona: {
      personaId: current.persona?.personaId ?? null,
      snapshot: current.persona?.snapshot ?? null,
      ...current.persona,
      incognito,
      ...(incognito ? { memoryIds: undefined } : {}),
    },
    updatedAt: Date.now(),
  }))
  persist(sessionId)
}

export const setSessionMemoryScope = (sessionId: string, memoryScope: MemoryScope) => {
  const session = getSession(sessionId)
  if (!session) {
    return
  }
  updateSession(sessionId, (current) => ({
    ...current,
    persona: {
      personaId: current.persona?.personaId ?? null,
      snapshot: current.persona?.snapshot ?? null,
      ...current.persona,
      memoryScope,
      ...(memoryScope === 'local_only' ? { memoryIds: undefined } : {}),
    },
    updatedAt: Date.now(),
  }))
  persist(sessionId)
}

export const addSessionLocalMemory = (sessionId: string, content: string) => {
  const clean = content.trim().slice(0, 200)
  const session = getSession(sessionId)
  if (!session || !clean) {
    return
  }
  const normalized = clean.toLowerCase()
  const existing = session.persona?.localMemories ?? []
  if (existing.some((m) => m.content.trim().toLowerCase() === normalized)) {
    return
  }
  updateSession(sessionId, (current) => {
    const prevList = current.persona?.localMemories ?? []
    return {
      ...current,
      persona: {
        personaId: current.persona?.personaId ?? null,
        snapshot: current.persona?.snapshot ?? null,
        ...current.persona,
        localMemories: [...prevList, { id: createId(), content: clean, createdAt: Date.now() }],
      },
      updatedAt: Date.now(),
    }
  })
  persist(sessionId)
}

export const deleteSessionLocalMemory = (sessionId: string, memoryId: string) => {
  const session = getSession(sessionId)
  if (!session) {
    return
  }
  updateSession(sessionId, (current) => ({
    ...current,
    persona: {
      personaId: current.persona?.personaId ?? null,
      snapshot: current.persona?.snapshot ?? null,
      ...current.persona,
      localMemories: (current.persona?.localMemories ?? []).filter((m) => m.id !== memoryId),
    },
    updatedAt: Date.now(),
  }))
  persist(sessionId)
}

registerLocalMemorySink((sessionId, contents) => {
  for (const item of contents) {
    addSessionLocalMemory(sessionId, item)
  }
})

export const extractSessionNow = async (sessionId: string): Promise<number> => {
  const session = getSession(sessionId)
  if (!session) {
    return 0
  }
  return runExtractNow(
    {
      sessionId,
      incognito: Boolean(session.persona?.incognito),
      ephemeral: ephemeralSessions.has(sessionId),
      memoryScope: session.persona?.memoryScope ?? 'global_and_local',
      localMemories: (session.persona?.localMemories ?? []).map((m) => ({
        id: m.id,
        content: m.content,
      })),
      turns: buildExtractTurns(session),
    },
    true
  )
}

export const getSessionCompactionStats = (sessionId: string) => {
  const session = getSession(sessionId)
  if (!session) {
    return {
      totalRounds: 0,
      compactedRounds: 0,
      retainedRounds: 0,
      estimatedTokens: 0,
      retainedTokens: 0,
      recordCount: 0,
      segmentCount: 0,
      activeLevel: null as CompactionLevel | null,
      updatedAt: null as number | null,
    }
  }
  const visible = getVisibleMessages(session)
  const rounds = getContextRounds(visible)
  const compaction = session.compaction
  let retainedRounds = rounds.length
  let retainedHistory: Message[] = visible
  if (compaction?.retainedFromId) {
    const cutIdx = rounds.findIndex(([u]) => u.id === compaction.retainedFromId)
    if (cutIdx > 0) {
      retainedRounds = rounds.length - cutIdx
      retainedHistory = rounds.slice(cutIdx).flat()
    }
  }
  return {
    totalRounds: rounds.length,
    compactedRounds: Math.max(0, rounds.length - retainedRounds),
    retainedRounds,
    estimatedTokens: estimateHistoryTokens(visible),
    retainedTokens: estimateHistoryTokens(retainedHistory),
    recordCount: compaction?.records.length ?? 0,
    segmentCount: compaction?.segments.length ?? 0,
    activeLevel: compaction?.level ?? null,
    updatedAt: compaction?.updatedAt ?? null,
  }
}

export const abortSessionCompaction = (sessionId: string) => {
  abortCompaction(sessionId)
}

export const clearSessionCompaction = (sessionId: string) => {
  const session = getSession(sessionId)
  if (!session || getStreamController(sessionId)) {
    return
  }
  updateSession(sessionId, (current) => ({
    ...current,
    compaction: undefined,
    updatedAt: Date.now(),
  }))
  persist(sessionId)
}

export const compactSessionNow = async (
  sessionId: string,
  level: CompactionLevel
): Promise<boolean> => {
  const session = getSession(sessionId)
  if (!session || getStreamController(sessionId)) {
    return false
  }
  const visible = getVisibleMessages(session)
  const controller = new AbortController()
  registerCompactionController(sessionId, controller)
  try {
    const result = await runCompactionPass({
      session,
      history: visible,
      level,
      forceManual: true,
      signal: controller.signal,
    })
    if (result.changed && result.compaction) {
      updateSession(sessionId, (current) => ({
        ...current,
        compaction: result.compaction,
        updatedAt: Date.now(),
      }))
      persist(sessionId)
    }
    clearCompactionController(sessionId, null)
    return result.changed
  } catch (error) {
    if (controller.signal.aborted) {
      clearCompactionController(sessionId, null)
      return false
    }
    const msg = error instanceof Error ? error.message : String(error)
    clearCompactionController(sessionId, msg)
    return false
  }
}

useMemoryStore.subscribe((state, prev) => {
  if (state.memories.length === 0 && prev.memories.length > 0) {
    set((chat) => ({
      sessionCache: Object.fromEntries(
        Object.entries(chat.sessionCache).map(([id, session]) => {
          if (!session.persona?.memoryIds) {
            return [id, session]
          }
          const nextPersona = { ...session.persona }
          delete nextPersona.memoryIds
          return [id, { ...session, persona: nextPersona }]
        })
      ),
    }))
  }
})

const buildExtractTurns = (session: Session) =>
  getVisibleMessages(session)
    .map((m) => ({
      role: m.role,
      content:
        m.role === 'user'
          ? m.content
          : m.blocks
              .filter(
                (b): b is { type: 'text'; text: string; isTemplate?: boolean } =>
                  b.type === 'text' && !b.isTemplate
              )
              .map((b) => b.text)
              .join(''),
    }))
    .filter((turn) => turn.content.trim().length > 0)

/**
 * 请求并消费流：先补齐附件的 serverId，再发请求；流式增量按动画帧刷新内存，完成、失败或停止后落盘。
 * 补传失败时回复记为 upload 错误，可重试。
 * 服务端判定 file_id 失效时重新补传后重发，退避重试且次数有上限，超过则按原始报错收尾。
 */
const streamReply = async (sessionId: string, initial: AssistantMessage, request: Request) => {
  const controller = new AbortController()
  if (!getSession(sessionId)?.title) {
    titleRequests.add(controller)
  }
  set((state) => ({ streaming: { ...state.streaming, [sessionId]: controller } }))
  let reply = initial
  let frame = 0
  const flush = () => {
    cancelAnimationFrame(frame)
    frame = 0
    updateReply(sessionId, reply)
  }
  streamFlushes.set(sessionId, flush)

  try {
    let trimFactor = 1
    for (let attempt = 0; ; attempt += 1) {
      /** 附件补齐前出错属于上传失败，请求还没有发出 */
      let preparing = true
      let receivedContent = false
      try {
        const prepared = await prepareFiles(sessionId, request, controller.signal)
        preparing = false
        // 附件就绪后获取本轮信息；续写沿用原回答快照，重新生成的快照独立保存。
        const latestReminder = prepared.prefix
          ? prepared.prefix.latestReminder
          : createLatestReminder(useSettings.getState())
        reply = { ...reply, latestReminder }
        updateReply(sessionId, reply)
        persist(sessionId)
        const { compactionEnabled, compactionAuto, compactionLevel } = useSettings.getState()
        const currentSession = getSession(sessionId)
        let activeHistory = prepared.history
        // 压缩总开关关闭时完全忽略已有压缩记录，按完整历史发送（前缀稳定，缓存友好）
        let activeCompaction = compactionEnabled ? currentSession?.compaction : undefined

        if (compactionEnabled && currentSession && !prepared.prefix) {
          if (compactionAuto) {
            const compacted = await runCompactionPass({
              session: currentSession,
              history: prepared.history,
              level: compactionLevel,
              forceManual: false,
              signal: controller.signal,
            })
            activeHistory = compacted.tailHistory
            activeCompaction = compacted.compaction
            if (compacted.changed && compacted.compaction) {
              // 压缩结果只追加为不可变分段，不改写已冻结的系统提示词。
              updateSession(sessionId, (current) => ({
                ...current,
                compaction: compacted.compaction,
              }))
              persist(sessionId)
            }
          } else if (activeCompaction?.retainedFromId) {
            const rounds = getContextRounds(prepared.history)
            const cutIdx = rounds.findIndex(([u]) => u.id === activeCompaction?.retainedFromId)
            if (cutIdx > 0) {
              activeHistory = rounds.slice(cutIdx).flat()
            }
          }
        }

        if (trimFactor < 1) {
          const reducedBudget = Math.max(
            2400,
            Math.round(estimateHistoryTokens(activeHistory) * trimFactor)
          )
          activeHistory = fitRequestHistory(activeHistory, reducedBudget)
        }

        const recallBlock =
          activeCompaction?.retainedFromId && !prepared.prefix
            ? recallCompactedEvidence(
                prepared.history,
                activeCompaction.retainedFromId,
                prepared.question.content,
                COMPACTION_PRESETS[activeCompaction.level].evidenceBudget
              )
            : ''
        // 关键事实属于易变内容，只拼在本轮提问末尾，绝不进入 system 或历史。
        const recordsBlock = prepared.prefix ? '' : formatCompactionRecordsBlock(activeCompaction)
        // 会话中新增的局部记忆同样只作为末尾增量下发，避免改写已缓存的前缀。
        const localMemories = currentSession?.persona?.localMemories ?? []
        const memoryBlock =
          !prepared.prefix &&
          useSettings.getState().memoryEnabled &&
          !currentSession?.persona?.incognito &&
          localMemories.length > 0
            ? `[本会话记忆]\n${localMemories
                .map((m, index) => `${index + 1}. ${m.content.trim()}`)
                .join('\n')}`
            : ''
        const tailBlocks = [recallBlock, recordsBlock, memoryBlock].filter(Boolean).join('\n\n')
        const requestQuestion = tailBlocks
          ? {
              ...prepared.question,
              content: `${tailBlocks}\n\n${prepared.question.content}`,
            }
          : prepared.question

        const messages = toRequestMessages(
          activeHistory,
          requestQuestion,
          prepared.prefix,
          initial.thinking ?? false,
          latestReminder,
          activeCompaction?.segments.map((segment) => segment.summary)
        )
        const systemPrompt = resolveSessionSystemPrompt(sessionId, prepared.question.content)
        const events = streamMessage(
          useSettings.getState().apiKey ?? '',
          {
            model: initial.model ?? MODEL,
            system: systemPrompt,
            messages,
            thinking: { type: initial.thinking ? 'enabled' : 'disabled' },
            safety_check: SAFETY_CHECK,
            tools: serverTools(Boolean(initial.search)),
            ...(titleRequests.has(controller) ? { title: { enabled: true } } : {}),
          },
          controller.signal,
          sessionId
        )
        const blockIndexes = new Map<number, number>()
        for await (const event of events) {
          receivedContent ||= event.type === 'content_block_start'
          if (
            event.type === 'message_delta' &&
            (event.delta.stop_reason === 'end_turn' || event.delta.stop_reason === 'max_tokens') &&
            event.delta.title?.trim() &&
            titleRequests.has(controller) &&
            !controller.signal.aborted &&
            !get().importingHistory
          ) {
            const title = event.delta.title.trim()
            updateSession(sessionId, (session) => (session.title ? session : { ...session, title }))
            titleRequests.delete(controller)
          }
          reply = applyEvent(reply, event, Date.now(), blockIndexes)
          if (document.visibilityState === 'hidden') {
            flush()
          } else {
            frame ||= requestAnimationFrame(flush)
          }
        }
        reply = settleReply(reply, 'done', Date.now())
        break
      } catch (error) {
        if (controller.signal.aborted) {
          reply = settleReply(reply, 'stopped', Date.now())
          break
        }
        if (preparing) {
          reply = settleReply(reply, 'error', Date.now(), {
            kind: 'upload',
            message: '',
            localMessage: describeUploadError(error),
            retryable: isRetryableApiError(error),
          })
          break
        }
        if (!receivedContent && isContextLengthError(error) && trimFactor > 0.25 && attempt < 4) {
          trimFactor *= 0.65
          continue
        }
        // 附件失效：重新补传后重发。收到过内容块（含丢弃的客户端工具）后不自动重发。
        if (
          attempt < FILE_RETRY_LIMIT &&
          !receivedContent &&
          reuploadInvalidatedFiles(sessionId, request, error)
        ) {
          await waitForRetry(attempt, controller.signal)
          if (controller.signal.aborted) {
            reply = settleReply(reply, 'stopped', Date.now())
            break
          }
          continue
        }
        if (error instanceof ApiError && error.kind === 'interrupted' && reply.stopReason) {
          // 已收到 message_delta 的结束原因，只是缺了结尾的 message_stop
          reply = settleReply(reply, 'done', Date.now())
        } else if (error instanceof ApiError) {
          if (classifyApiError(error) === 'insufficientBalance') {
            markInsufficient()
          }
          reply = settleReply(reply, 'error', Date.now(), {
            kind: error.kind,
            message: error.message,
            status: error.status,
            localMessage: error.localMessage,
          })
        } else {
          reply = settleReply(reply, 'error', Date.now(), {
            kind: 'protocol',
            message: error instanceof Error ? error.message : String(error),
          })
        }
        break
      }
    }
  } finally {
    titleRequests.delete(controller)
    streamFlushes.delete(sessionId)
    cancelAnimationFrame(frame)
    updateReply(sessionId, reply)
    set((state) => ({
      streaming: Object.fromEntries(
        Object.entries(state.streaming).filter(([id]) => id !== sessionId)
      ),
    }))
    persist(sessionId)
    debouncedRefreshBalance()
    if (reply.status === 'done') {
      const { voiceEnabled, voiceAutoPlay } = useSettings.getState()
      if (voiceEnabled && voiceAutoPlay) {
        const spokenText = reply.blocks
          .filter(
            (b): b is { type: 'text'; text: string; isTemplate?: boolean } =>
              b.type === 'text' && !b.isTemplate
          )
          .map((b) => b.text)
          .join('')
          .trim()
        if (spokenText) {
          autoPlayReadAloud(reply.id, spokenText)
        }
      }
      const latest = getSession(sessionId)
      if (latest) {
        scheduleExtract({
          sessionId,
          incognito: Boolean(latest.persona?.incognito),
          ephemeral: ephemeralSessions.has(sessionId),
          memoryScope: latest.persona?.memoryScope ?? 'global_and_local',
          localMemories: (latest.persona?.localMemories ?? []).map((m) => ({
            id: m.id,
            content: m.content,
          })),
          turns: buildExtractTurns(latest),
        })
      }
    }
  }
}
