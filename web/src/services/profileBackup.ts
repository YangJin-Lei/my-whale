import { replaceAllMemories, upsertMemories, useMemoryStore } from './memory/store.js'
import type { Memory, MemoryCategory, MemorySource } from './memory/types.js'
import { replaceAllPersonas, upsertPersonas, usePersonaStore } from './persona/store.js'
import type { Persona } from './persona/types.js'
import { setProfile, useSettings } from './settings.js'

export type ProfileBackupV1 = {
  format: 'my-whale-profile'
  version: 1
  exportedAt: string
  profile: string
  personas: Persona[]
  memories: Memory[]
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const VALID_CATEGORIES = new Set<MemoryCategory>(['profile', 'preference', 'project', 'other'])
const VALID_SOURCES = new Set<MemorySource>(['manual', 'auto'])

const parsePersona = (raw: unknown): Persona => {
  if (!isRecord(raw)) {
    throw new Error('Invalid persona item')
  }
  if (
    typeof raw.id !== 'string' ||
    !raw.id ||
    typeof raw.name !== 'string' ||
    typeof raw.instructions !== 'string'
  ) {
    throw new Error('Invalid persona fields')
  }
  const now = Date.now()
  return {
    id: raw.id,
    name: raw.name.slice(0, 20),
    avatar:
      typeof raw.avatar === 'string' && raw.avatar.startsWith('data:image/') ? raw.avatar : '',
    description: typeof raw.description === 'string' ? raw.description.slice(0, 80) : '',
    instructions: raw.instructions.slice(0, 4000),
    greeting: typeof raw.greeting === 'string' ? raw.greeting.slice(0, 200) : undefined,
    defaults: isRecord(raw.defaults)
      ? {
          ...(typeof raw.defaults.thinking === 'boolean'
            ? { thinking: raw.defaults.thinking }
            : {}),
          ...(typeof raw.defaults.search === 'boolean' ? { search: raw.defaults.search } : {}),
        }
      : undefined,
    builtin: false,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : now,
  }
}

const parseMemory = (raw: unknown): Memory => {
  if (!isRecord(raw) || typeof raw.id !== 'string' || !raw.id || typeof raw.content !== 'string') {
    throw new Error('Invalid memory item')
  }
  const now = Date.now()
  return {
    id: raw.id,
    content: raw.content.slice(0, 200),
    category:
      typeof raw.category === 'string' && VALID_CATEGORIES.has(raw.category as MemoryCategory)
        ? (raw.category as MemoryCategory)
        : 'other',
    source:
      typeof raw.source === 'string' && VALID_SOURCES.has(raw.source as MemorySource)
        ? (raw.source as MemorySource)
        : 'manual',
    ...(typeof raw.sourceSessionId === 'string' ? { sourceSessionId: raw.sourceSessionId } : {}),
    pinned: Boolean(raw.pinned),
    enabled: raw.enabled !== false,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : now,
    ...(typeof raw.lastUsedAt === 'number' ? { lastUsedAt: raw.lastUsedAt } : {}),
  }
}

export const buildProfileBackup = (): ProfileBackupV1 => ({
  format: 'my-whale-profile',
  version: 1,
  exportedAt: new Date().toISOString(),
  profile: useSettings.getState().profile,
  personas: usePersonaStore.getState().personas.filter((p) => !p.builtin),
  memories: useMemoryStore.getState().memories,
})

export const parseProfileBackup = async (file: File): Promise<ProfileBackupV1> => {
  const text = await file.text()
  const raw: unknown = JSON.parse(text)
  if (!isRecord(raw) || raw.format !== 'my-whale-profile' || raw.version !== 1) {
    throw new Error('Unrecognized profile backup format')
  }
  const profile = typeof raw.profile === 'string' ? raw.profile.slice(0, 1500) : ''
  const personas = Array.isArray(raw.personas) ? raw.personas.map(parsePersona) : []
  const memories = Array.isArray(raw.memories) ? raw.memories.map(parseMemory) : []
  return {
    format: 'my-whale-profile',
    version: 1,
    exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : new Date().toISOString(),
    profile,
    personas,
    memories,
  }
}

export const applyProfileBackup = async (
  backup: ProfileBackupV1,
  mode: 'merge' | 'replace'
): Promise<{ personasCount: number; memoriesCount: number }> => {
  if (mode === 'replace') {
    setProfile(backup.profile)
    await replaceAllPersonas(backup.personas)
    await replaceAllMemories(backup.memories)
  } else {
    if (!useSettings.getState().profile.trim() && backup.profile.trim()) {
      setProfile(backup.profile)
    }
    await upsertPersonas(backup.personas)
    const existingMap = new Map(useMemoryStore.getState().memories.map((m) => [m.id, m]))
    const toWrite = backup.memories.filter((m) => {
      const prev = existingMap.get(m.id)
      return !prev || m.updatedAt >= prev.updatedAt
    })
    await upsertMemories(toWrite)
  }
  return { personasCount: backup.personas.length, memoriesCount: backup.memories.length }
}
