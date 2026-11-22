export type TtsEngineId = 'local-sherpa' | 'official' | 'system' | 'nekospeak'

export type LocalVoiceModelFormat = 'vits-piper' | 'vits-melo' | 'kokoro'

export type LocalVoicePack = {
  id: string
  nameZh: string
  nameEn: string
  sizeMb: number
  builtIn: boolean
  format: LocalVoiceModelFormat
  archiveUrl: string
  archiveName: string
  defaultSid: number
}

/**
 * NekoSpeak 独立多音色引擎预留配置结构（功能未开发，暂不开放）。
 * 后续将用于为不同桌宠独立配置音色模板、自定义自录音参考片段与语调参数。
 */
export type NekoSpeakVoiceProfile = {
  petId: string
  profileId: string
  displayName: string
  referenceAudioId?: string
  referenceText?: string
  speakingRate?: number
  pitchScale?: number
}

export type TtsEngineMeta = {
  id: TtsEngineId
  available: boolean
  labelZh: string
  labelEn: string
  tagZh?: string
  tagEn?: string
}

export const TTS_ENGINES: ReadonlyArray<TtsEngineMeta> = [
  {
    id: 'local-sherpa',
    available: true,
    labelZh: '本地轻量语音（sherpa-onnx 离线免费）',
    labelEn: 'Local Offline TTS (sherpa-onnx, Free)',
  },
  {
    id: 'official',
    available: true,
    labelZh: 'DeepSeek 官方语音（按量计费）',
    labelEn: 'DeepSeek Official TTS (Metered)',
  },
  {
    id: 'system',
    available: true,
    labelZh: '系统 / 浏览器朗读（零额外体积）',
    labelEn: 'System / Browser Speech (Zero Footprint)',
  },
  {
    id: 'nekospeak',
    available: false,
    labelZh: 'NekoSpeak 多音色（暂未开放 · 功能开发中）',
    labelEn: 'NekoSpeak Multi-Voice (Coming Soon)',
    tagZh: '功能未开发，后续支持多桌宠独立音色',
    tagEn: 'In development for per-pet multi-voice profiles',
  },
]

export const DEFAULT_LOCAL_VOICE_ID = 'default-zh'

export const LOCAL_VOICE_PACKS: ReadonlyArray<LocalVoicePack> = [
  {
    id: 'default-zh',
    nameZh: '小雅 · 轻量中文女声（内置默认）',
    nameEn: 'XiaoYa · Lightweight Chinese (Built-in)',
    sizeMb: 13.4,
    builtIn: true,
    format: 'vits-piper',
    archiveUrl:
      'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-zh_CN-xiao_ya-medium-int8.tar.bz2',
    archiveName: 'vits-piper-zh_CN-xiao_ya-medium-int8.tar.bz2',
    defaultSid: 0,
  },
  {
    id: 'chaowen-int8',
    nameZh: '超文 · 轻量中文男声',
    nameEn: 'Chaowen · Lightweight Chinese Male',
    sizeMb: 13.4,
    builtIn: false,
    format: 'vits-piper',
    archiveUrl:
      'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-zh_CN-chaowen-medium-int8.tar.bz2',
    archiveName: 'vits-piper-zh_CN-chaowen-medium-int8.tar.bz2',
    defaultSid: 0,
  },
  {
    id: 'huayan-medium',
    nameZh: '华研 · 清晰中文女声',
    nameEn: 'Huayan · Clear Chinese Female',
    sizeMb: 64.1,
    builtIn: false,
    format: 'vits-piper',
    archiveUrl:
      'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-zh_CN-huayan-medium.tar.bz2',
    archiveName: 'vits-piper-zh_CN-huayan-medium.tar.bz2',
    defaultSid: 0,
  },
  {
    id: 'melo-zh-en',
    nameZh: 'MeloTTS · 中英混读双语',
    nameEn: 'MeloTTS · Chinese & English Bilingual',
    sizeMb: 159.3,
    builtIn: false,
    format: 'vits-melo',
    archiveUrl:
      'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-melo-tts-zh_en.tar.bz2',
    archiveName: 'vits-melo-tts-zh_en.tar.bz2',
    defaultSid: 0,
  },
  {
    id: 'kokoro-multi',
    nameZh: 'Kokoro · 多语种多音色（int8）',
    nameEn: 'Kokoro · Multi-Lang & Multi-Speaker (int8)',
    sizeMb: 140.2,
    builtIn: false,
    format: 'kokoro',
    archiveUrl:
      'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-int8-multi-lang-v1_1.tar.bz2',
    archiveName: 'kokoro-int8-multi-lang-v1_1.tar.bz2',
    defaultSid: 0,
  },
]

export const findLocalVoicePack = (id?: string | null): LocalVoicePack =>
  LOCAL_VOICE_PACKS.find((pack) => pack.id === id) ?? LOCAL_VOICE_PACKS[0]

const FALLBACK_MIRRORS = [
  'https://ghfast.top/',
  'https://gh-proxy.com/',
  'https://mirror.ghproxy.com/',
]

/** 为按需语音包构建多路镜像 + GitHub 直连回退地址，避免单节点不稳定 */
export const buildVoicePackDownloadCandidates = (
  pack: LocalVoicePack,
  preferredMirror?: string
): string[] => {
  const candidates: string[] = []
  const addMirror = (rawMirror?: string) => {
    const clean = (rawMirror ?? '').trim().replace(/\/+$/, '')
    if (!clean) {
      return
    }
    const url = `${clean}/${pack.archiveUrl}`
    if (!candidates.includes(url)) {
      candidates.push(url)
    }
  }
  addMirror(preferredMirror)
  for (const m of FALLBACK_MIRRORS) {
    addMirror(m)
  }
  if (!candidates.includes(pack.archiveUrl)) {
    candidates.push(pack.archiveUrl)
  }
  return candidates
}
