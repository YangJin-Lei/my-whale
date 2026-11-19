import * as db from '../db.js'
import { parseOfficialDeepSeekConversations } from './deepseekOfficial.js'
import { BackupError, fail } from './errors.js'
import type { SessionIndexEntry } from './format.js'
import { INDEX_PATH, MANIFEST_PATH, USER_PATH, parseSessionPath, sessionFilesDir } from './paths.js'
import { checkManifest, readSessionFile, readSessionIndex } from './schema.js'
import { toLocalSession } from './toLocal.js'
import {
  ArchiveError,
  isZipFile,
  readArchive,
  readEntry,
  skipEntry,
  type ArchiveEntry,
} from './zipReader.js'

const OFFICIAL_CONVERSATIONS_PATH = 'conversations.json'

/** 从原件字节补充图片 MIME；无法识别时为空字符串，图片身份仍由归档的 is_image 决定。 */
const imageType = (bytes: Uint8Array): string => {
  const startsWith = (...prefix: number[]) => prefix.every((byte, index) => bytes[index] === byte)
  const header = new TextDecoder('ascii').decode(bytes.subarray(0, 12))
  if (startsWith(0xff, 0xd8, 0xff)) {
    return 'image/jpeg'
  }
  if (startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) {
    return 'image/png'
  }
  if (header.startsWith('GIF87a') || header.startsWith('GIF89a')) {
    return 'image/gif'
  }
  if (header.startsWith('RIFF') && header.slice(8, 12) === 'WEBP') {
    return 'image/webp'
  }
  if (startsWith(0x42, 0x4d)) {
    return 'image/bmp'
  }
  if (startsWith(0x49, 0x49, 0x2a, 0) || startsWith(0x4d, 0x4d, 0, 0x2a)) {
    return 'image/tiff'
  }
  if (header.slice(4, 8) === 'ftyp' && ['avif', 'avis'].includes(header.slice(8, 12))) {
    return 'image/avif'
  }
  return ''
}

const readJson = async (entry: ArchiveEntry): Promise<unknown> => {
  const text = await (await readEntry(entry)).text()
  try {
    return JSON.parse(text)
  } catch {
    return fail('backupInvalidJson')
  }
}

const parseJsonFile = async (file: File): Promise<unknown> => {
  const text = await file.text()
  try {
    return JSON.parse(text)
  } catch {
    return fail('backupUnrecognized')
  }
}

/**
 * 检查归档格式与兼容性：
 * 1) 兼容 my-whale / 网页端 v3 历史归档 ZIP（首条目 manifest.json）；
 * 2) 兼容 DeepSeek 官方手机端/网页端导出 ZIP（含 conversations.json）；
 * 3) 兼容直接选择的官方 conversations.json 文件。
 */
export const checkArchiveFormat = async (file: File): Promise<void> => {
  if (!(await isZipFile(file))) {
    const parsed = await parseJsonFile(file)
    parseOfficialDeepSeekConversations(parsed)
    return
  }

  let sawOfficialConversations = false
  let checkedManifest = false
  try {
    for await (const entry of readArchive(file)) {
      if (!checkedManifest && entry.path === MANIFEST_PATH) {
        checkManifest(await readJson(entry))
        return
      }
      if (
        entry.path === OFFICIAL_CONVERSATIONS_PATH ||
        entry.path.endsWith('/conversations.json')
      ) {
        parseOfficialDeepSeekConversations(await readJson(entry))
        sawOfficialConversations = true
        return
      }
      checkedManifest = true
      await skipEntry(entry)
    }
  } catch (error) {
    throw error instanceof ArchiveError ? new BackupError('backupIncomplete') : error
  }

  if (!sawOfficialConversations) {
    fail('backupUnrecognized')
  }
}

const isOfficialPackageEntry = (path: string) =>
  path === OFFICIAL_CONVERSATIONS_PATH || path.endsWith('/conversations.json')

export const importArchive = async (file: File): Promise<void> => {
  if (!(await isZipFile(file))) {
    const sessions = parseOfficialDeepSeekConversations(await parseJsonFile(file))
    for (const session of sessions) {
      await db.addStagingSession(session)
    }
    return
  }

  const imported = new Set<string>()
  const images = new Map<string, string>()
  const stored = new Map<string, string>()
  let manifest = false
  let officialMode = false
  let index: SessionIndexEntry[] | undefined
  let currentSessionId: string | undefined

  const saveImage = async (entry: ArchiveEntry, id: string) => {
    if (stored.has(id)) {
      await skipEntry(entry)
      return
    }
    const data = await readEntry(entry)
    const type = imageType(new Uint8Array(await data.slice(0, 16).arrayBuffer()))
    await db.saveStagingFiles([{ id, blob: new Blob([data], { type }) }])
    stored.set(id, type)
  }

  try {
    for await (const entry of readArchive(file)) {
      const { path } = entry
      const sessionId = parseSessionPath(path)

      if (!manifest && !officialMode) {
        if (path === MANIFEST_PATH) {
          checkManifest(await readJson(entry))
          manifest = true
          continue
        }
        if (path === USER_PATH) {
          officialMode = true
          await skipEntry(entry)
          continue
        }
        if (isOfficialPackageEntry(path)) {
          officialMode = true
          const sessions = parseOfficialDeepSeekConversations(await readJson(entry))
          for (const session of sessions) {
            await db.addStagingSession(session)
          }
          continue
        }
        fail('backupUnrecognized')
      }

      if (officialMode) {
        if (isOfficialPackageEntry(path)) {
          const sessions = parseOfficialDeepSeekConversations(await readJson(entry))
          for (const session of sessions) {
            await db.addStagingSession(session)
          }
        } else {
          await skipEntry(entry)
        }
        continue
      }

      if (path === USER_PATH && !index && imported.size === 0) {
        await skipEntry(entry)
      } else if (sessionId !== null && !index) {
        const local = toLocalSession(readSessionFile(await readJson(entry)))
        if (local.session.id !== sessionId || imported.has(sessionId)) {
          fail('backupIncomplete')
        }
        imported.add(sessionId)
        currentSessionId = sessionId
        for (const [imagePath, id] of local.images) {
          images.set(imagePath, id)
        }
        await db.addStagingSession(local.session)
      } else if (path === INDEX_PATH && !index) {
        index = readSessionIndex(await readJson(entry))
      } else if (
        index
          ? imported.has(/^chat_sessions\/([^/]+)_files\//.exec(path)?.[1] ?? '')
          : currentSessionId && path.startsWith(sessionFilesDir(currentSessionId))
      ) {
        const id = images.get(path)
        await (id === undefined ? skipEntry(entry) : saveImage(entry, id))
      } else {
        fail('backupIncomplete')
      }
    }
  } catch (error) {
    throw error instanceof ArchiveError ? new BackupError('backupIncomplete') : error
  }

  if (officialMode) {
    return
  }

  if (!manifest) {
    fail('backupUnrecognized')
  }
  const listed = new Set(index?.map((entry) => entry.id))
  if (
    !index ||
    listed.size !== index.length ||
    listed.size !== imported.size ||
    [...imported].some((id) => !listed.has(id))
  ) {
    fail('backupIncomplete')
  }
  await db.updateStagingFileTypes(stored)
}
