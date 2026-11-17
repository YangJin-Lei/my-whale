import { create } from 'zustand'
import { createId } from '../../utils/id.js'
import * as db from '../chat/db.js'
import { setDefaultPersonaId, useSettings, type Locale } from '../settings.js'
import { DEFAULT_PERSONA_ID, getBuiltinPersonas } from './builtin.js'
import {
  PERSONA_DESCRIPTION_MAX,
  PERSONA_GREETING_MAX,
  PERSONA_INSTRUCTIONS_MAX,
  PERSONA_NAME_MAX,
  type Persona,
  type PersonaSnapshot,
} from './types.js'

type PersonaState = {
  personas: Persona[]
  ready: boolean
}

export const usePersonaStore = create<PersonaState>(() => ({
  personas: [],
  ready: false,
}))

let initTask: Promise<void> | undefined

export const initPersonas = (): Promise<void> => {
  if (usePersonaStore.getState().ready) {
    return Promise.resolve()
  }
  if (initTask) {
    return initTask
  }
  initTask = (async () => {
    try {
      const personas = await db.loadPersonas()
      personas.sort((a, b) => b.updatedAt - a.updatedAt)
      usePersonaStore.setState({ personas, ready: true })
    } catch (error) {
      db.reportStorageError('load personas')(error)
      usePersonaStore.setState({ ready: true })
    } finally {
      initTask = undefined
    }
  })()
  return initTask
}

export const getAllPersonas = (customPersonas: readonly Persona[], locale: Locale): Persona[] => [
  ...getBuiltinPersonas(locale),
  ...customPersonas,
]

export const findPersona = (
  id: string | null | undefined,
  customPersonas: readonly Persona[],
  locale: Locale
): Persona => {
  const all = getAllPersonas(customPersonas, locale)
  const target = id ? all.find((p) => p.id === id) : undefined
  return target ?? all.find((p) => p.id === DEFAULT_PERSONA_ID) ?? all[0]
}

export const toPersonaSnapshot = (persona: Persona): PersonaSnapshot | null => {
  if (persona.id === DEFAULT_PERSONA_ID || !persona.instructions.trim()) {
    return null
  }
  return {
    name: persona.name,
    avatar: persona.avatar,
    instructions: persona.instructions,
  }
}

export type PersonaInput = {
  name: string
  avatar: string
  description: string
  instructions: string
  greeting?: string
  defaults?: Persona['defaults']
}

const sanitizeInput = (input: PersonaInput): PersonaInput => ({
  name: input.name.trim().slice(0, PERSONA_NAME_MAX),
  avatar: input.avatar.startsWith('data:image/') ? input.avatar : '',
  description: input.description.trim().slice(0, PERSONA_DESCRIPTION_MAX),
  instructions: input.instructions.trim().slice(0, PERSONA_INSTRUCTIONS_MAX),
  greeting: input.greeting?.trim().slice(0, PERSONA_GREETING_MAX) || undefined,
  defaults: input.defaults,
})

export const savePersona = async (input: PersonaInput, existingId?: string): Promise<Persona> => {
  const now = Date.now()
  const clean = sanitizeInput(input)
  const existing = existingId
    ? usePersonaStore.getState().personas.find((p) => p.id === existingId)
    : undefined

  const persona: Persona = existing
    ? {
        ...existing,
        ...clean,
        updatedAt: now,
      }
    : {
        id: `persona-${createId()}`,
        ...clean,
        category: 'companion',
        builtin: false,
        createdAt: now,
        updatedAt: now,
      }

  await db.putPersona(persona)
  usePersonaStore.setState((state) => {
    const rest = state.personas.filter((p) => p.id !== persona.id)
    return { personas: [persona, ...rest] }
  })
  return persona
}

export const removePersona = async (id: string): Promise<void> => {
  await db.deletePersonaRecord(id)
  usePersonaStore.setState((state) => ({
    personas: state.personas.filter((p) => p.id !== id),
  }))
  if (useSettings.getState().defaultPersonaId === id) {
    setDefaultPersonaId(DEFAULT_PERSONA_ID)
  }
}

export const duplicatePersona = async (source: Persona, suffix = ''): Promise<Persona> => {
  const name = `${source.name}${suffix}`.slice(0, PERSONA_NAME_MAX)
  return savePersona({
    name,
    avatar: source.avatar,
    description: source.description,
    instructions: source.instructions,
    greeting: source.greeting,
    defaults: source.defaults,
  })
}

export const replaceAllPersonas = async (personas: readonly Persona[]): Promise<void> => {
  const current = usePersonaStore.getState().personas
  for (const item of current) {
    await db.deletePersonaRecord(item.id)
  }
  const clean = personas
    .filter((p) => !p.builtin)
    .map((p) => ({ ...p, builtin: false }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
  for (const item of clean) {
    await db.putPersona(item)
  }
  usePersonaStore.setState({ personas: clean })
  const defaultId = useSettings.getState().defaultPersonaId
  if (!clean.some((p) => p.id === defaultId) && !defaultId.startsWith('builtin-')) {
    setDefaultPersonaId(DEFAULT_PERSONA_ID)
  }
}

export const upsertPersonas = async (personas: readonly Persona[]): Promise<void> => {
  const map = new Map(usePersonaStore.getState().personas.map((p) => [p.id, p]))
  for (const item of personas) {
    if (item.builtin) {
      continue
    }
    const normalized: Persona = { ...item, builtin: false }
    const existing = map.get(normalized.id)
    if (!existing || normalized.updatedAt >= existing.updatedAt) {
      await db.putPersona(normalized)
      map.set(normalized.id, normalized)
    }
  }
  usePersonaStore.setState({
    personas: [...map.values()].sort((a, b) => b.updatedAt - a.updatedAt),
  })
}
