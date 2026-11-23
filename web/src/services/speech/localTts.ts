import { Capacitor, registerPlugin } from '@capacitor/core'
import { useSettings } from '../settings.js'
import { buildVoicePackDownloadCandidates, findLocalVoicePack } from './engines.js'

export type LocalTtsStatus = {
  nativeSupported: boolean
  builtInReady: boolean
  installedIds: string[]
  activeModelId: string
  error?: string
}

export type LocalTtsSynthesisResult = {
  pcmBase64: string
  sampleRate: number
}

interface LocalTtsCapacitorPlugin {
  getStatus: () => Promise<LocalTtsStatus>
  prewarm: (opts: { modelId: string }) => Promise<{ ok: boolean; modelId: string }>
  synthesize: (opts: {
    text: string
    modelId: string
    speed: number
    sid: number
  }) => Promise<LocalTtsSynthesisResult>
  downloadModel: (opts: {
    modelId: string
    urls: string[]
    archiveName: string
  }) => Promise<{ ok: boolean; installedIds: string[] }>
  deleteModel: (opts: { modelId: string }) => Promise<{ ok: boolean; installedIds: string[] }>
}

const capacitorLocalTts = Capacitor.isNativePlatform()
  ? registerPlugin<LocalTtsCapacitorPlugin>('LocalTts')
  : null

type TauriInternals = {
  invoke?: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>
}

const getTauriInvoke = (): TauriInternals['invoke'] | null => {
  if (typeof window === 'undefined') {
    return null
  }
  const win = window as unknown as { __TAURI_INTERNALS__?: TauriInternals }
  return typeof win.__TAURI_INTERNALS__?.invoke === 'function'
    ? win.__TAURI_INTERNALS__.invoke
    : null
}

export const hasNativeLocalTts = (): boolean =>
  capacitorLocalTts !== null || getTauriInvoke() !== null

let lastPrewarmedModel = ''

/** 在空闲时后台静默加载本地语音模型，消除首次点击朗读的冷启卡顿 */
export const prewarmLocalTts = async (modelId?: string): Promise<void> => {
  if (!hasNativeLocalTts()) {
    return
  }
  const resolvedId = (modelId || useSettings.getState().localTtsVoiceId || 'default-zh').trim()
  if (!resolvedId || lastPrewarmedModel === resolvedId) {
    return
  }
  lastPrewarmedModel = resolvedId
  try {
    if (capacitorLocalTts) {
      await capacitorLocalTts.prewarm({ modelId: resolvedId })
      return
    }
    const tauriInvoke = getTauriInvoke()
    if (tauriInvoke) {
      await tauriInvoke('tts_prewarm', { modelId: resolvedId })
    }
  } catch {
    lastPrewarmedModel = ''
  }
}

export const getLocalTtsStatus = async (): Promise<LocalTtsStatus> => {
  if (capacitorLocalTts) {
    try {
      return await capacitorLocalTts.getStatus()
    } catch (error) {
      return {
        nativeSupported: false,
        builtInReady: false,
        installedIds: [],
        activeModelId: '',
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }
  const tauriInvoke = getTauriInvoke()
  if (tauriInvoke) {
    try {
      return await tauriInvoke<LocalTtsStatus>('tts_get_status')
    } catch (error) {
      return {
        nativeSupported: false,
        builtInReady: false,
        installedIds: [],
        activeModelId: '',
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }
  return {
    nativeSupported: false,
    builtInReady: false,
    installedIds: [],
    activeModelId: '',
  }
}

export const synthesizeWithLocalTts = async (
  text: string,
  modelId: string,
  speed = 1.0,
  sid = 0
): Promise<{ samples: Float32Array; sampleRate: number }> => {
  let result: LocalTtsSynthesisResult
  if (capacitorLocalTts) {
    result = await capacitorLocalTts.synthesize({ text, modelId, speed, sid })
  } else {
    const tauriInvoke = getTauriInvoke()
    if (!tauriInvoke) {
      throw new Error('Local sherpa-onnx TTS is unavailable in pure browser mode')
    }
    result = await tauriInvoke<LocalTtsSynthesisResult>('tts_synthesize', {
      text,
      modelId,
      speed,
      sid,
    })
  }
  const binary = atob(result.pcmBase64)
  const byteLen = binary.length
  const bytes = new Uint8Array(byteLen)
  for (let i = 0; i < byteLen; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  const samples = new Float32Array(bytes.length >> 1)
  const view = new DataView(bytes.buffer, bytes.byteOffset, samples.length * 2)
  for (let i = 0; i < samples.length; i += 1) {
    samples[i] = view.getInt16(i * 2, true) / 0x8000
  }
  return { samples, sampleRate: result.sampleRate || 22050 }
}

export const downloadLocalVoicePack = async (modelId: string): Promise<string[]> => {
  const pack = findLocalVoicePack(modelId)
  const { updateMirror } = useSettings.getState()
  const urls = buildVoicePackDownloadCandidates(pack, updateMirror)
  if (capacitorLocalTts) {
    const res = await capacitorLocalTts.downloadModel({
      modelId: pack.id,
      urls,
      archiveName: pack.archiveName,
    })
    return res.installedIds
  }
  const tauriInvoke = getTauriInvoke()
  if (tauriInvoke) {
    const res = await tauriInvoke<{ ok: boolean; installedIds: string[] }>('tts_download_model', {
      modelId: pack.id,
      urls,
      archiveName: pack.archiveName,
    })
    return res.installedIds
  }
  throw new Error('Offline model downloads require the Android or Desktop app')
}

export const deleteLocalVoicePack = async (modelId: string): Promise<string[]> => {
  if (capacitorLocalTts) {
    const res = await capacitorLocalTts.deleteModel({ modelId })
    return res.installedIds
  }
  const tauriInvoke = getTauriInvoke()
  if (tauriInvoke) {
    const res = await tauriInvoke<{ ok: boolean; installedIds: string[] }>('tts_delete_model', {
      modelId,
    })
    return res.installedIds
  }
  return []
}

const COMPOUND_TECH_REPLACEMENTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bDeepSeek\b/gi, 'Deep Seek'],
  [/\bGitHub\b/gi, 'Git Hub'],
  [/\bGitLab\b/gi, 'Git Lab'],
  [/\bChatGPT\b/gi, 'Chat G P T'],
  [/\bOpenAI\b/gi, 'Open A I'],
  [/\bTypeScript\b/gi, 'Type Script'],
  [/\bJavaScript\b/gi, 'Java Script'],
  [/\bWebView\b/gi, 'Web View'],
  [/\bMeloTTS\b/gi, 'Melo T T S'],
  [/\bNekoSpeak\b/gi, 'Neko Speak'],
  [/\bONNX\b/gi, 'O N N X'],
  [/\bmy-whale\b/gi, 'my whale'],
  [/\biPhone\b/g, 'i Phone'],
  [/\biPad\b/g, 'i Pad'],
  [/\bmacOS\b/gi, 'mac O S'],
  [/\biOS\b/g, 'i O S'],
  [/\bWi-?Fi\b/gi, 'Wi Fi'],
]

const PRONOUNCEABLE_UPPER_WORDS = new Set([
  'OK',
  'AI',
  'RAM',
  'ZIP',
  'APP',
  'MAC',
  'MAX',
  'MIN',
  'PRO',
  'WEB',
  'JAVA',
  'RUST',
  'LINUX',
  'WORD',
])

/**
 * 规整英文品牌词、全大写缩写、驼峰命名与粘连标点，防止 Kokoro / MeloTTS 词典查不到而整词静音跳过。
 */
export const normalizeEnglishForSpeech = (input: string): string => {
  let out = input
  for (const [pattern, replacement] of COMPOUND_TECH_REPLACEMENTS) {
    out = out.replace(pattern, replacement)
  }
  out = out.replace(/\b([vV])(\d+(?:\.\d+)+)\b/g, (_m, prefix: string, ver: string) => {
    return `${prefix} ${ver.split('.').join(' 点 ')}`
  })
  out = out
    .replace(/([A-Za-z0-9])[_/\\|@+=]+([A-Za-z0-9])/g, '$1 $2')
    .replace(/([A-Za-z])-([A-Za-z])/g, '$1 $2')
    .replace(/[()[\]{}"'<>「」『』【】]/g, ' ')
  out = out
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Za-z])(\d)/g, '$1 $2')
    .replace(/(\d)([A-Za-z])/g, '$1 $2')
  out = out.replace(/\b[A-Z]{2,8}\b/g, (token) =>
    PRONOUNCEABLE_UPPER_WORDS.has(token) ? token : token.split('').join(' ')
  )
  return out
}

/** 清理 Markdown 标记、代码块与链接（保留完整英文词汇，适合讯飞与系统朗读） */
export const stripBasicSpeechMarkdown = (input: string): string =>
  input
    .replace(/```[\s\S]*?```/g, ' 代码块已略过。 ')
    .replace(/`([^`]+)`/g, ' $1 ')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/[*_~]+/g, ' ')
    .replace(/\|/g, '，')
    .replace(/\n{2,}/g, '。')
    .replace(/\n/g, '，')
    .replace(/\s{2,}/g, ' ')
    .trim()

/** 清理 Markdown 标记、代码块与链接，并对英文与符号做分词规整（用于 sherpa-onnx 本地模型） */
export const stripSpeechMarkdown = (input: string): string =>
  normalizeEnglishForSpeech(stripBasicSpeechMarkdown(input))
    .replace(/\s{2,}/g, ' ')
    .trim()

const joinSpeechChunk = (left: string, right: string): string => {
  if (!left) {
    return right
  }
  const sep = /[A-Za-z0-9]$/.test(left) && /^[A-Za-z0-9]/.test(right) ? ' ' : ''
  return `${left}${sep}${right}`
}

/** 将长正文切分为自然短句：首片更短以便秒开播，后续切片适中避免频繁切换 */
export const splitSpeechSentences = (
  rawText: string,
  maxChunkChars = 72,
  firstChunkMaxChars = 22
): string[] => {
  const cleaned = stripSpeechMarkdown(rawText)
  if (!cleaned) {
    return []
  }
  const rawParts = cleaned
    .split(/(?<=[。！？!?；;])/)
    .map((p) => p.trim())
    .filter(Boolean)

  const out: string[] = []
  let buf = ''
  const currentLimit = () => (out.length === 0 ? firstChunkMaxChars : maxChunkChars)

  for (const part of rawParts) {
    const limit = currentLimit()
    if (part.length > limit) {
      if (buf) {
        out.push(buf)
        buf = ''
      }
      const subParts = part
        .split(/(?<=[，,])/)
        .map((s) => s.trim())
        .filter(Boolean)
      for (const sub of subParts) {
        const subLimit = currentLimit()
        if (sub.length > subLimit && out.length === 0 && !buf) {
          out.push(sub.slice(0, subLimit).trim())
          buf = sub.slice(subLimit).trim()
          continue
        }
        if (buf.length + sub.length > subLimit && buf) {
          out.push(buf)
          buf = sub
        } else {
          buf = joinSpeechChunk(buf, sub)
        }
      }
      continue
    }
    if (buf.length + part.length > limit && buf) {
      out.push(buf)
      buf = part
    } else {
      buf = joinSpeechChunk(buf, part)
    }
  }
  if (buf) {
    out.push(buf)
  }
  return out
}
