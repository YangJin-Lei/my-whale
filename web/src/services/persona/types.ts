export type PersonaCategory = 'companion' | 'utility'

export type Persona = {
  id: string
  name: string
  avatar: string
  description: string
  instructions: string
  greeting?: string
  category?: PersonaCategory
  defaults?: {
    thinking?: boolean
    search?: boolean
  }
  builtin?: boolean
  createdAt: number
  updatedAt: number
}

export type PersonaSnapshot = Pick<Persona, 'name' | 'avatar' | 'instructions'>

export type LocalMemory = {
  id: string
  content: string
  createdAt: number
}

export type MemoryScope = 'global_and_local' | 'local_only'

export type SessionPersona = {
  personaId: string | null
  snapshot: PersonaSnapshot | null
  note?: string
  incognito?: boolean
  memoryIds?: string[]
  /** 单会话记忆作用域：默认读取全局+局部；设为 local_only 时不读取全局记忆 */
  memoryScope?: MemoryScope
  /** 仅属于当前会话的局部记忆 */
  localMemories?: LocalMemory[]
  /** 是否在当前会话中就地微调过助手人设 */
  tunedMidSession?: boolean
  /** 缓存模式下冻结首轮完整系统提示词，保障 DeepSeek KV 前缀缓存跨轮命中 */
  frozenSystemPrompt?: string
}

export const PERSONA_NAME_MAX = 20
export const PERSONA_DESCRIPTION_MAX = 80
export const PERSONA_INSTRUCTIONS_MAX = 4000
export const PERSONA_GREETING_MAX = 200
export const SESSION_NOTE_MAX = 1000
export const PROFILE_MAX = 1500
export const MEMORY_BUDGET_CHARS = 3000
export const AVATAR_MAX_BYTES = 64 * 1024
