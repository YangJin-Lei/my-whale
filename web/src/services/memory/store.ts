import { create } from 'zustand'
import { createId } from '../../utils/id.js'
import * as db from '../chat/db.js'
import { MEMORY_CONTENT_MAX, type Memory, type MemoryCategory, type MemorySource } from './types.js'

type MemoryState = {
  memories: Memory[]
  ready: boolean
  /** 每次增删改停用递增，用于在对话中感知是否需要重算记忆注入集合 */
  version: number
  undoSnapshot: Memory[] | null
}

export const useMemoryStore = create<MemoryState>(() => ({
  memories: [],
  ready: false,
  version: 0,
  undoSnapshot: null,
}))

let initTask: Promise<void> | undefined
let undoTimer: number | null = null

const clearUndoTimer = () => {
  if (undoTimer !== null) {
    window.clearTimeout(undoTimer)
    undoTimer = null
  }
}

export const initMemories = (): Promise<void> => {
  if (useMemoryStore.getState().ready) {
    return Promise.resolve()
  }
  if (initTask) {
    return initTask
  }
  initTask = (async () => {
    try {
      const memories = await db.loadMemories()
      memories.sort((a, b) => b.updatedAt - a.updatedAt)
      useMemoryStore.setState({ memories, ready: true })
    } catch (error) {
      db.reportStorageError('load memories')(error)
      useMemoryStore.setState({ ready: true })
    } finally {
      initTask = undefined
    }
  })()
  return initTask
}

export const addMemory = async ({
  content,
  category = 'other',
  source = 'manual',
  sourceSessionId,
  pinned = false,
}: {
  content: string
  category?: MemoryCategory
  source?: MemorySource
  sourceSessionId?: string
  pinned?: boolean
}): Promise<Memory | null> => {
  const clean = content.trim().slice(0, MEMORY_CONTENT_MAX)
  if (!clean) {
    return null
  }
  const now = Date.now()
  const memory: Memory = {
    id: `mem-${createId()}`,
    content: clean,
    category,
    source,
    ...(sourceSessionId ? { sourceSessionId } : {}),
    pinned,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  }
  await db.putMemory(memory)
  useMemoryStore.setState((state) => ({
    memories: [memory, ...state.memories],
    version: state.version + 1,
  }))
  return memory
}

export const updateMemory = async (
  id: string,
  patch: Partial<Pick<Memory, 'content' | 'category' | 'pinned' | 'enabled'>>
): Promise<void> => {
  const existing = useMemoryStore.getState().memories.find((m) => m.id === id)
  if (!existing) {
    return
  }
  const content =
    patch.content !== undefined
      ? patch.content.trim().slice(0, MEMORY_CONTENT_MAX)
      : existing.content
  if (!content) {
    return
  }
  const updated: Memory = {
    ...existing,
    ...patch,
    content,
    updatedAt: Date.now(),
  }
  await db.putMemory(updated)
  useMemoryStore.setState((state) => ({
    memories: state.memories.map((m) => (m.id === id ? updated : m)),
    version: state.version + 1,
  }))
}

export const deleteMemory = async (id: string): Promise<void> => {
  await db.deleteMemoryRecord(id)
  useMemoryStore.setState((state) => ({
    memories: state.memories.filter((m) => m.id !== id),
    version: state.version + 1,
  }))
}

export const markMemoriesUsed = async (ids: readonly string[]): Promise<void> => {
  if (ids.length === 0) {
    return
  }
  const now = Date.now()
  const idSet = new Set(ids)
  const changed: Memory[] = []
  const next = useMemoryStore.getState().memories.map((m) => {
    if (!idSet.has(m.id)) {
      return m
    }
    const updated = { ...m, lastUsedAt: now }
    changed.push(updated)
    return updated
  })
  if (changed.length === 0) {
    return
  }
  useMemoryStore.setState({ memories: next })
  await db.putMemories(changed).catch(db.reportStorageError('mark memories used'))
}

export const clearAllMemories = async (): Promise<void> => {
  const snapshot = useMemoryStore.getState().memories
  await db.clearAllMemories()
  clearUndoTimer()
  useMemoryStore.setState((state) => ({
    memories: [],
    version: state.version + 1,
    undoSnapshot: snapshot.length > 0 ? snapshot : null,
  }))
  if (snapshot.length > 0) {
    undoTimer = window.setTimeout(() => {
      useMemoryStore.setState({ undoSnapshot: null })
      undoTimer = null
    }, 10_000)
  }
}

export const undoClearMemories = async (): Promise<void> => {
  const snapshot = useMemoryStore.getState().undoSnapshot
  if (!snapshot || snapshot.length === 0) {
    return
  }
  clearUndoTimer()
  await db.putMemories(snapshot)
  useMemoryStore.setState((state) => ({
    memories: [...snapshot].sort((a, b) => b.updatedAt - a.updatedAt),
    version: state.version + 1,
    undoSnapshot: null,
  }))
}

export const replaceAllMemories = async (memories: readonly Memory[]): Promise<void> => {
  const sorted = [...memories].sort((a, b) => b.updatedAt - a.updatedAt)
  await db.clearAllMemories()
  if (sorted.length > 0) {
    await db.putMemories(sorted)
  }
  clearUndoTimer()
  useMemoryStore.setState((state) => ({
    memories: sorted,
    version: state.version + 1,
    undoSnapshot: null,
  }))
}

export const upsertMemories = async (memories: readonly Memory[]): Promise<void> => {
  if (memories.length === 0) {
    return
  }
  await db.putMemories(memories)
  const map = new Map(useMemoryStore.getState().memories.map((m) => [m.id, m]))
  for (const m of memories) {
    map.set(m.id, m)
  }
  const merged = [...map.values()].sort((a, b) => b.updatedAt - a.updatedAt)
  useMemoryStore.setState((state) => ({
    memories: merged,
    version: state.version + 1,
  }))
}

export const restoreMemoriesBatch = async ({
  addedIds,
  previous,
}: {
  addedIds: readonly string[]
  previous: readonly Memory[]
}): Promise<void> => {
  for (const id of addedIds) {
    await db.deleteMemoryRecord(id)
  }
  if (previous.length > 0) {
    await db.putMemories(previous)
  }
  const addedSet = new Set(addedIds)
  const prevMap = new Map(previous.map((m) => [m.id, m]))
  const current = useMemoryStore
    .getState()
    .memories.filter((m) => !addedSet.has(m.id))
    .map((m) => prevMap.get(m.id) ?? m)
  for (const m of previous) {
    if (!current.some((item) => item.id === m.id)) {
      current.push(m)
    }
  }
  current.sort((a, b) => b.updatedAt - a.updatedAt)
  useMemoryStore.setState((state) => ({
    memories: current,
    version: state.version + 1,
  }))
}
