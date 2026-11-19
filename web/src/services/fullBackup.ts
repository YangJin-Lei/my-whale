import { Capacitor } from '@capacitor/core'
import {
  useCustomPetsStore,
  replaceAllCustomPets,
  upsertCustomPets,
  type CustomPetRecord,
} from '../pet/customPets.js'
import { getGameOpponentSnapshot, restoreGameOpponentSnapshot } from '../game/opponents.js'
import { formatDate } from '../utils/format.js'
import * as db from './chat/db.js'
import {
  ArchiveError,
  isZipFile,
  readArchive,
  readEntry,
  skipEntry,
} from './chat/history/zipReader.js'
import { writeArchive } from './chat/history/zipWriter.js'
import { mergeHistory, replaceHistory, useChatStore } from './chat/store.js'
import type { Session } from './chat/types.js'
import { replaceAllMemories, upsertMemories, useMemoryStore } from './memory/store.js'
import type { Memory } from './memory/types.js'
import { replaceAllPersonas, upsertPersonas, usePersonaStore } from './persona/store.js'
import type { Persona } from './persona/types.js'
import {
  applySettingsSnapshot,
  exportSettingsSnapshot,
  setApiKey,
  useSettings,
  type SettingsSnapshot,
} from './settings.js'
import { CURRENT_VERSION } from './update.js'

const BACKUP_FORMAT = 'my-whale-full-backup'
const BACKUP_VERSION = 1
const SCHEMA_VERSION = 1
const PBKDF2_ITERATIONS = 310_000
const MAGIC_BYTES = new TextEncoder().encode('MWSEC01\0')
const PET_POS_KEY = 'mywhale:pet-position-v1'

const MANIFEST_ENTRY = 'manifest.json'
const SETTINGS_ENTRY = 'settings.json'
const PERSONAS_ENTRY = 'personas.json'
const MEMORIES_ENTRY = 'memories.json'
const PETS_ENTRY = 'custom_pets.json'
const CONVERSATIONS_ENTRY = 'conversations.json'
const ATTACHMENTS_META_ENTRY = 'attachments_meta.json'
const SECRETS_ENTRY = 'encrypted-secrets.bin'

export type FullBackupErrorCode =
  | 'invalidArchive'
  | 'unsupportedVersion'
  | 'passwordRequired'
  | 'wrongPassword'
  | 'corruptedAttachment'
  | 'cryptoUnavailable'

export class FullBackupError extends Error {
  readonly code: FullBackupErrorCode

  constructor(code: FullBackupErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code)
    this.name = 'FullBackupError'
    this.code = code
  }
}

export type FullBackupManifestV1 = {
  format: typeof BACKUP_FORMAT
  backupVersion: number
  schemaVersion: number
  appVersion: string
  exportedAt: string
  origin: string
  stats: {
    sessions: number
    attachments: number
    personas: number
    memories: number
    customPets: number
  }
  encryption: {
    enabled: boolean
    kdf: 'PBKDF2-SHA256'
    iterations: number
    cipher: 'AES-256-GCM'
  }
}

export type AttachmentMetaEntry = {
  fileId: string
  name: string
  mimeType: string
  size: number
  isImage: boolean
  entryPath: string
}

export type FullBackupInspection = {
  manifest: FullBackupManifestV1
  hasEncryptedSecrets: boolean
  originChanged: boolean
  currentOrigin: string
}

export type FullBackupProgress = {
  phase: 'reading' | 'writing' | 'decrypting' | 'committing'
  current: number
  total: number
}

const safeEntryName = (name: string) => {
  const clean = name.split('\0').join('_').replace(/[/\\]/g, '_').trim()
  return clean && clean !== '.' && clean !== '..' ? clean.slice(0, 96) : 'file'
}

const getSubtle = (): SubtleCrypto => {
  if (typeof globalThis.crypto?.subtle === 'undefined') {
    throw new FullBackupError('cryptoUnavailable', 'Web Crypto API unavailable')
  }
  return globalThis.crypto.subtle
}

const deriveAesKey = async (
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
  usage: 'encrypt' | 'decrypt'
): Promise<CryptoKey> => {
  const subtle = getSubtle()
  const baseKey = await subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  )
  return subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    [usage]
  )
}

const encryptSecrets = async (apiKey: string, password: string): Promise<Blob> => {
  const subtle = getSubtle()
  const salt = new Uint8Array(new ArrayBuffer(16))
  const iv = new Uint8Array(new ArrayBuffer(12))
  globalThis.crypto.getRandomValues(salt)
  globalThis.crypto.getRandomValues(iv)
  const key = await deriveAesKey(password, salt, PBKDF2_ITERATIONS, 'encrypt')
  const plainBytes = new TextEncoder().encode(JSON.stringify({ apiKey }))
  const cipherBuf = await subtle.encrypt({ name: 'AES-GCM', iv }, key, plainBytes)
  const cipherBytes = new Uint8Array(cipherBuf)
  const out = new Uint8Array(MAGIC_BYTES.length + salt.length + iv.length + cipherBytes.length)
  out.set(MAGIC_BYTES, 0)
  out.set(salt, MAGIC_BYTES.length)
  out.set(iv, MAGIC_BYTES.length + salt.length)
  out.set(cipherBytes, MAGIC_BYTES.length + salt.length + iv.length)
  return new Blob([out], { type: 'application/octet-stream' })
}

const decryptSecrets = async (
  blob: Blob,
  password: string,
  iterations: number
): Promise<{ apiKey: string | null }> => {
  const buf = new Uint8Array(await blob.arrayBuffer())
  const minLen = MAGIC_BYTES.length + 16 + 12 + 16
  if (buf.length < minLen || !MAGIC_BYTES.every((b, i) => buf[i] === b)) {
    throw new FullBackupError('invalidArchive', 'Malformed encrypted-secrets.bin')
  }
  const salt = new Uint8Array(buf.slice(MAGIC_BYTES.length, MAGIC_BYTES.length + 16))
  const iv = new Uint8Array(buf.slice(MAGIC_BYTES.length + 16, MAGIC_BYTES.length + 28))
  const cipherBytes = new Uint8Array(buf.slice(MAGIC_BYTES.length + 28))
  const subtle = getSubtle()
  try {
    const key = await deriveAesKey(password, salt, iterations, 'decrypt')
    const plainBuf = await subtle.decrypt({ name: 'AES-GCM', iv }, key, cipherBytes)
    const parsed = JSON.parse(new TextDecoder().decode(plainBuf)) as { apiKey?: unknown }
    return {
      apiKey:
        typeof parsed.apiKey === 'string' && parsed.apiKey.trim() ? parsed.apiKey.trim() : null,
    }
  } catch {
    throw new FullBackupError('wrongPassword')
  }
}

const jsonBlob = (value: unknown) => new Blob([JSON.stringify(value)], { type: 'application/json' })

const normalizePickedZip = async (file: File): Promise<File> => {
  if (!Capacitor.isNativePlatform()) {
    return file
  }
  const buf = await file.arrayBuffer()
  return new File([buf], file.name, {
    type: file.type || 'application/zip',
    lastModified: file.lastModified,
  })
}

const readPetPosition = (): unknown => {
  try {
    const raw = window.localStorage.getItem(PET_POS_KEY)
    return raw ? (JSON.parse(raw) as unknown) : null
  } catch {
    return null
  }
}

const writePetPosition = (pos: unknown) => {
  if (!pos || typeof pos !== 'object') {
    return
  }
  const p = pos as { x?: unknown; y?: unknown }
  if (typeof p.x === 'number' && typeof p.y === 'number') {
    try {
      window.localStorage.setItem(PET_POS_KEY, JSON.stringify({ x: p.x, y: p.y }))
    } catch {
      // 忽略存储限制
    }
  }
}

const validateManifest = (raw: unknown): FullBackupManifestV1 => {
  if (!raw || typeof raw !== 'object') {
    throw new FullBackupError('invalidArchive')
  }
  const m = raw as Partial<FullBackupManifestV1>
  if (m.format !== BACKUP_FORMAT) {
    throw new FullBackupError('invalidArchive')
  }
  if (typeof m.backupVersion !== 'number' || m.backupVersion > BACKUP_VERSION) {
    throw new FullBackupError('unsupportedVersion')
  }
  if (typeof m.schemaVersion !== 'number' || m.schemaVersion > SCHEMA_VERSION) {
    throw new FullBackupError('unsupportedVersion')
  }
  return {
    format: BACKUP_FORMAT,
    backupVersion: m.backupVersion,
    schemaVersion: m.schemaVersion,
    appVersion: typeof m.appVersion === 'string' ? m.appVersion : '0.0.0',
    exportedAt: typeof m.exportedAt === 'string' ? m.exportedAt : new Date().toISOString(),
    origin: typeof m.origin === 'string' ? m.origin : '',
    stats: {
      sessions: Number(m.stats?.sessions ?? 0),
      attachments: Number(m.stats?.attachments ?? 0),
      personas: Number(m.stats?.personas ?? 0),
      memories: Number(m.stats?.memories ?? 0),
      customPets: Number(m.stats?.customPets ?? 0),
    },
    encryption: {
      enabled: Boolean(m.encryption?.enabled),
      kdf: 'PBKDF2-SHA256',
      iterations:
        typeof m.encryption?.iterations === 'number' && m.encryption.iterations >= 100_000
          ? m.encryption.iterations
          : PBKDF2_ITERATIONS,
      cipher: 'AES-256-GCM',
    },
  }
}

export const exportFullBackup = async (options?: {
  password?: string
  onProgress?: (p: FullBackupProgress) => void
}): Promise<{ name: string; blob: Blob; hasEncryptedSecrets: boolean }> => {
  const password = options?.password?.trim() ?? ''
  const onProgress = options?.onProgress

  onProgress?.({ phase: 'reading', current: 0, total: 4 })
  const sessions = await db.loadAllSessions()
  const sessionCache = useChatStore.getState().sessionCache
  const mergedSessions = sessions.map((s) =>
    Object.hasOwn(sessionCache, s.id) ? sessionCache[s.id] : s
  )

  onProgress?.({ phase: 'reading', current: 1, total: 4 })
  const allFiles = await db.loadAllFiles()
  const fileMetaById = new Map<string, { name: string; mimeType: string; isImage: boolean }>()
  for (const session of mergedSessions) {
    for (const msg of session.messages) {
      if (msg.role !== 'user') {
        continue
      }
      for (const f of msg.files) {
        if (!fileMetaById.has(f.id)) {
          fileMetaById.set(f.id, {
            name: f.name,
            mimeType: f.mimeType,
            isImage: f.isImage,
          })
        }
      }
    }
  }

  onProgress?.({ phase: 'reading', current: 2, total: 4 })
  const personas = usePersonaStore.getState().personas.filter((p) => !p.builtin)
  const memories = useMemoryStore.getState().memories
  const customPets = useCustomPetsStore.getState().items
  const apiKey = useSettings.getState().apiKey?.trim() ?? ''
  const hasSecrets = Boolean(password && apiKey)

  const attachmentsMeta: AttachmentMetaEntry[] = []
  const attachmentEntries: { name: string; blob: Blob }[] = []

  for (let i = 0; i < allFiles.length; i += 1) {
    const stored = allFiles[i]
    const info = fileMetaById.get(stored.id)
    const fileName = info?.name || `${stored.id}.bin`
    const mimeType = stored.blob.type || info?.mimeType || 'application/octet-stream'
    const entryPath = `attachments/${safeEntryName(stored.id)}/${safeEntryName(fileName)}`
    attachmentsMeta.push({
      fileId: stored.id,
      name: fileName,
      mimeType,
      size: stored.blob.size,
      isImage: info?.isImage ?? mimeType.startsWith('image/'),
      entryPath,
    })
    attachmentEntries.push({ name: entryPath, blob: stored.blob })
  }

  onProgress?.({ phase: 'writing', current: 3, total: 4 })
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const manifest: FullBackupManifestV1 = {
    format: BACKUP_FORMAT,
    backupVersion: BACKUP_VERSION,
    schemaVersion: SCHEMA_VERSION,
    appVersion: CURRENT_VERSION,
    exportedAt: new Date().toISOString(),
    origin,
    stats: {
      sessions: mergedSessions.length,
      attachments: attachmentsMeta.length,
      personas: personas.length,
      memories: memories.length,
      customPets: customPets.length,
    },
    encryption: {
      enabled: hasSecrets,
      kdf: 'PBKDF2-SHA256',
      iterations: PBKDF2_ITERATIONS,
      cipher: 'AES-256-GCM',
    },
  }

  const settingsPayload = {
    settings: exportSettingsSnapshot(),
    gameOpponent: getGameOpponentSnapshot(),
    petPosition: readPetPosition(),
  }

  const entries: { name: string; blob: Blob }[] = [
    { name: MANIFEST_ENTRY, blob: jsonBlob(manifest) },
    { name: SETTINGS_ENTRY, blob: jsonBlob(settingsPayload) },
    { name: PERSONAS_ENTRY, blob: jsonBlob(personas) },
    { name: MEMORIES_ENTRY, blob: jsonBlob(memories) },
    { name: PETS_ENTRY, blob: jsonBlob(customPets) },
    { name: CONVERSATIONS_ENTRY, blob: jsonBlob(mergedSessions) },
    { name: ATTACHMENTS_META_ENTRY, blob: jsonBlob(attachmentsMeta) },
    ...attachmentEntries,
  ]

  if (hasSecrets) {
    entries.push({
      name: SECRETS_ENTRY,
      blob: await encryptSecrets(apiKey, password),
    })
  }

  const zipBlob = await writeArchive(entries)
  onProgress?.({ phase: 'writing', current: 4, total: 4 })

  const now = new Date()
  return {
    name: `my-whale-backup-${formatDate(now)}.zip`,
    blob: zipBlob,
    hasEncryptedSecrets: hasSecrets,
  }
}

export const inspectFullBackup = async (rawFile: File): Promise<FullBackupInspection> => {
  const file = await normalizePickedZip(rawFile)
  if (!(await isZipFile(file))) {
    throw new FullBackupError('invalidArchive')
  }
  let manifest: FullBackupManifestV1 | null = null
  let hasEncryptedSecrets = false
  try {
    for await (const entry of readArchive(file)) {
      if (entry.path === MANIFEST_ENTRY) {
        const text = await (await readEntry(entry)).text()
        manifest = validateManifest(JSON.parse(text) as unknown)
      } else if (entry.path === SECRETS_ENTRY) {
        hasEncryptedSecrets = true
        await skipEntry(entry)
      } else {
        await skipEntry(entry)
      }
    }
  } catch (err) {
    if (err instanceof FullBackupError) {
      throw err
    }
    throw new FullBackupError(
      'invalidArchive',
      err instanceof ArchiveError ? err.message : undefined
    )
  }
  if (!manifest) {
    throw new FullBackupError('invalidArchive')
  }
  const currentOrigin = typeof window !== 'undefined' ? window.location.origin : ''
  return {
    manifest,
    hasEncryptedSecrets,
    originChanged: Boolean(manifest.origin && currentOrigin && manifest.origin !== currentOrigin),
    currentOrigin,
  }
}

const migrateSessionRecord = (raw: unknown): Session | null => {
  if (!raw || typeof raw !== 'object') {
    return null
  }
  const s = raw as Partial<Session>
  if (typeof s.id !== 'string' || !s.id || !Array.isArray(s.messages)) {
    return null
  }
  return {
    id: s.id,
    title: typeof s.title === 'string' ? s.title : '',
    createdAt: typeof s.createdAt === 'number' ? s.createdAt : Date.now(),
    updatedAt: typeof s.updatedAt === 'number' ? s.updatedAt : Date.now(),
    messages: s.messages,
    ...(s.rootMessageId !== undefined ? { rootMessageId: s.rootMessageId } : {}),
    ...(s.persona ? { persona: s.persona } : {}),
    ...(Array.isArray(s.personaNotices) ? { personaNotices: s.personaNotices } : {}),
    ...(s.compaction ? { compaction: s.compaction } : {}),
  }
}

export const restoreFullBackup = async (
  rawFile: File,
  options: {
    mode: 'merge' | 'replace'
    password?: string
    skipSecrets?: boolean
    onProgress?: (p: FullBackupProgress) => void
  }
): Promise<{
  sessionsCount: number
  attachmentsCount: number
  restoredApiKey: boolean
}> => {
  const file = await normalizePickedZip(rawFile)
  if (!(await isZipFile(file))) {
    throw new FullBackupError('invalidArchive')
  }

  type SettingsBundle = {
    settings?: Partial<SettingsSnapshot>
    gameOpponent?: unknown
    petPosition?: unknown
  }
  let manifest: FullBackupManifestV1 | null = null
  let settingsData: SettingsBundle | null = null
  let personas: Persona[] = []
  let memories: Memory[] = []
  let customPets: CustomPetRecord[] = []
  let sessions: Session[] = []
  let attachmentsMeta: AttachmentMetaEntry[] = []
  const attachmentBlobs = new Map<string, Blob>()
  let secretsBlob: Blob | null = null

  options.onProgress?.({ phase: 'reading', current: 0, total: 3 })
  try {
    for await (const entry of readArchive(file)) {
      if (entry.path === MANIFEST_ENTRY) {
        manifest = validateManifest(JSON.parse(await (await readEntry(entry)).text()) as unknown)
      } else if (entry.path === SETTINGS_ENTRY) {
        settingsData = JSON.parse(await (await readEntry(entry)).text()) as SettingsBundle
      } else if (entry.path === PERSONAS_ENTRY) {
        const arr = JSON.parse(await (await readEntry(entry)).text()) as unknown
        personas = Array.isArray(arr) ? (arr as Persona[]) : []
      } else if (entry.path === MEMORIES_ENTRY) {
        const arr = JSON.parse(await (await readEntry(entry)).text()) as unknown
        memories = Array.isArray(arr) ? (arr as Memory[]) : []
      } else if (entry.path === PETS_ENTRY) {
        const arr = JSON.parse(await (await readEntry(entry)).text()) as unknown
        customPets = Array.isArray(arr) ? (arr as CustomPetRecord[]) : []
      } else if (entry.path === CONVERSATIONS_ENTRY) {
        const arr = JSON.parse(await (await readEntry(entry)).text()) as unknown
        sessions = Array.isArray(arr)
          ? arr.map(migrateSessionRecord).filter((s): s is Session => s !== null)
          : []
      } else if (entry.path === ATTACHMENTS_META_ENTRY) {
        const arr = JSON.parse(await (await readEntry(entry)).text()) as unknown
        attachmentsMeta = Array.isArray(arr) ? (arr as AttachmentMetaEntry[]) : []
      } else if (entry.path === SECRETS_ENTRY) {
        secretsBlob = await readEntry(entry)
      } else if (entry.path.startsWith('attachments/')) {
        attachmentBlobs.set(entry.path, await readEntry(entry))
      } else {
        await skipEntry(entry)
      }
    }
  } catch (err) {
    if (err instanceof FullBackupError) {
      throw err
    }
    throw new FullBackupError(
      'invalidArchive',
      err instanceof ArchiveError ? err.message : undefined
    )
  }

  if (!manifest) {
    throw new FullBackupError('invalidArchive')
  }

  const storedFiles: db.StoredFile[] = []
  for (const meta of attachmentsMeta) {
    const rawBlob = attachmentBlobs.get(meta.entryPath)
    if (!rawBlob || rawBlob.size !== meta.size) {
      throw new FullBackupError('corruptedAttachment', meta.name)
    }
    const typedBlob = new Blob([rawBlob], { type: meta.mimeType || 'application/octet-stream' })
    storedFiles.push({ id: meta.fileId, blob: typedBlob })
  }

  let recoveredApiKey: string | null = null
  if (secretsBlob && !options.skipSecrets) {
    options.onProgress?.({ phase: 'decrypting', current: 1, total: 3 })
    const pw = options.password?.trim() ?? ''
    if (!pw) {
      throw new FullBackupError('passwordRequired')
    }
    const decrypted = await decryptSecrets(secretsBlob, pw, manifest.encryption.iterations)
    recoveredApiKey = decrypted.apiKey
  }

  options.onProgress?.({ phase: 'committing', current: 2, total: 3 })
  let sessionsCount = 0
  if (options.mode === 'replace') {
    sessionsCount = await replaceHistory(async () => {
      for (const s of sessions) {
        await db.addStagingSession(s)
      }
      if (storedFiles.length > 0) {
        await db.saveStagingFiles(storedFiles)
      }
    })
    await replaceAllPersonas(personas)
    await replaceAllMemories(memories)
    await replaceAllCustomPets(customPets)
  } else {
    const merged = await mergeHistory(sessions, storedFiles)
    sessionsCount = merged.importedSessions
    await upsertPersonas(personas)
    await upsertMemories(memories)
    await upsertCustomPets(customPets)
  }

  if (settingsData) {
    if (settingsData.settings) {
      applySettingsSnapshot(settingsData.settings)
    }
    if (settingsData.gameOpponent) {
      restoreGameOpponentSnapshot(settingsData.gameOpponent)
    }
    if (settingsData.petPosition) {
      writePetPosition(settingsData.petPosition)
    }
  }

  if (recoveredApiKey) {
    setApiKey(recoveredApiKey)
  }

  options.onProgress?.({ phase: 'committing', current: 3, total: 3 })
  return {
    sessionsCount,
    attachmentsCount: storedFiles.length,
    restoredApiKey: Boolean(recoveredApiKey),
  }
}
