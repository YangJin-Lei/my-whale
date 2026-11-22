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

/** 清理 Markdown 标记、代码块与链接，使朗读文本自然连贯 */
export const stripSpeechMarkdown = (input: string): string =>
  input
    .replace(/```[\s\S]*?```/g, ' 代码块已略过。 ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/[*_~]+/g, '')
    .replace(/\|/g, '，')
    .replace(/\n{2,}/g, '。')
    .replace(/\n/g, '，')
    .replace(/\s{2,}/g, ' ')
    .trim()

/** 将长正文切分为自然短句，确保首句几十毫秒内即可开播且不卡顿 */
export const splitSpeechSentences = (rawText: string, maxChunkChars = 90): string[] => {
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
  for (const part of rawParts) {
    if (part.length > maxChunkChars) {
      if (buf) {
        out.push(buf)
        buf = ''
      }
      const subParts = part
        .split(/(?<=[，,])/)
        .map((s) => s.trim())
        .filter(Boolean)
      for (const sub of subParts) {
        if (buf.length + sub.length > maxChunkChars && buf) {
          out.push(buf)
          buf = sub
        } else {
          buf = `${buf}${sub}`
        }
      }
      continue
    }
    if (buf.length + part.length > maxChunkChars && buf) {
      out.push(buf)
      buf = part
    } else {
      buf = `${buf}${part}`
    }
  }
  if (buf) {
    out.push(buf)
  }
  return out
}
