import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import { create } from 'zustand'

export type CustomPetRecord = {
  id: string
  name: string
  description: string
  spriteDataUrl: string
  cols: number
  rows: number
  createdAt: number
}

interface CustomPetDB extends DBSchema {
  pets: {
    key: string
    value: CustomPetRecord
    indexes: { createdAt: number }
  }
}

const DB_NAME = 'mywhale-custom-pets'
const DB_VERSION = 1

let dbPromise: Promise<IDBPDatabase<CustomPetDB>> | null = null

const getDb = () =>
  (dbPromise ??= openDB<CustomPetDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('pets')) {
        const store = db.createObjectStore('pets', { keyPath: 'id' })
        store.createIndex('createdAt', 'createdAt')
      }
    },
  }))

type CustomPetsState = {
  items: CustomPetRecord[]
  loaded: boolean
}

export const useCustomPetsStore = create<CustomPetsState>(() => ({
  items: [],
  loaded: false,
}))

export const loadCustomPets = async (): Promise<void> => {
  try {
    const db = await getDb()
    const rows = await db.getAllFromIndex('pets', 'createdAt')
    useCustomPetsStore.setState({ items: rows, loaded: true })
  } catch {
    useCustomPetsStore.setState({ loaded: true })
  }
}

void loadCustomPets()

const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
      } else {
        reject(new Error('Invalid image file'))
      }
    }
    reader.onerror = () => reject(reader.error ?? new Error('Read failed'))
    reader.readAsDataURL(file)
  })

const probeImageDimensions = (dataUrl: string): Promise<{ width: number; height: number }> =>
  new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => resolve({ width: 0, height: 0 })
    img.src = dataUrl
  })

type RawPetJson = {
  id?: unknown
  displayName?: unknown
  name?: unknown
  description?: unknown
  cols?: unknown
  rows?: unknown
}

const sanitizeId = (raw: string): string => {
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug ? `custom-${slug}` : `custom-${Date.now()}`
}

const stripExt = (name: string): string => name.replace(/\.[^.]+$/, '')

/**
 * 解析本地上传的桌宠包（支持单张图片或「pet.json + spritesheet 图片」同选）并存入 IndexedDB。
 * 格式完全兼容 `vender/pet/*` 中的 `{ id, displayName, description, spritesheetPath }`。
 */
export const importCustomPetFiles = async (files: File[]): Promise<CustomPetRecord> => {
  const imageFile = files.find(
    (f) => f.type.startsWith('image/') || /\.(webp|png|jpe?g|gif|avif)$/i.test(f.name)
  )
  if (!imageFile) {
    throw new Error('NO_IMAGE')
  }

  let parsedJson: RawPetJson = {}
  const jsonFile = files.find(
    (f) => f.type === 'application/json' || f.name.toLowerCase().endsWith('.json')
  )
  if (jsonFile) {
    try {
      const rawText = await jsonFile.text()
      const candidate = JSON.parse(rawText) as unknown
      if (typeof candidate === 'object' && candidate !== null) {
        parsedJson = candidate as RawPetJson
      }
    } catch {
      throw new Error('INVALID_JSON')
    }
  }

  const spriteDataUrl = await readFileAsDataUrl(imageFile)
  const dims = await probeImageDimensions(spriteDataUrl)
  const targetRatio = (8 * 192) / (9 * 208)
  const actualRatio = dims.height > 0 ? dims.width / dims.height : 0
  const looksLikeSheet =
    dims.width >= 768 && dims.height >= 900 && Math.abs(actualRatio - targetRatio) < 0.18

  const cols =
    typeof parsedJson.cols === 'number' && parsedJson.cols >= 1
      ? Math.floor(parsedJson.cols)
      : looksLikeSheet || Boolean(jsonFile)
        ? 8
        : 1
  const rows =
    typeof parsedJson.rows === 'number' && parsedJson.rows >= 1
      ? Math.floor(parsedJson.rows)
      : looksLikeSheet || Boolean(jsonFile)
        ? 9
        : 1

  const fallbackName = stripExt(imageFile.name) || 'Custom Pet'
  const displayName =
    typeof parsedJson.displayName === 'string' && parsedJson.displayName.trim()
      ? parsedJson.displayName.trim()
      : typeof parsedJson.name === 'string' && parsedJson.name.trim()
        ? parsedJson.name.trim()
        : fallbackName
  const description =
    typeof parsedJson.description === 'string' && parsedJson.description.trim()
      ? parsedJson.description.trim()
      : displayName

  const rawId =
    typeof parsedJson.id === 'string' && parsedJson.id.trim()
      ? parsedJson.id.trim()
      : `${displayName}-${Date.now().toString(36)}`

  const record: CustomPetRecord = {
    id: sanitizeId(rawId),
    name: displayName.slice(0, 32),
    description: description.slice(0, 220),
    spriteDataUrl,
    cols,
    rows,
    createdAt: Date.now(),
  }

  const db = await getDb()
  await db.put('pets', record)
  await loadCustomPets()
  return record
}

export const deleteCustomPet = async (id: string): Promise<void> => {
  try {
    const db = await getDb()
    await db.delete('pets', id)
  } finally {
    await loadCustomPets()
  }
}
