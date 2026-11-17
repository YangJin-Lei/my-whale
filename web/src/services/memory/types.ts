export type MemoryCategory = 'profile' | 'preference' | 'project' | 'other'
export type MemorySource = 'manual' | 'auto'

export type Memory = {
  id: string
  content: string
  category: MemoryCategory
  source: MemorySource
  sourceSessionId?: string
  pinned: boolean
  enabled: boolean
  createdAt: number
  updatedAt: number
  lastUsedAt?: number
}

export const MEMORY_CONTENT_MAX = 200
