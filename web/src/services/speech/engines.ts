export type TtsEngineId = 'iflytek' | 'system' | 'local-sherpa' | 'official' | 'nekospeak'

export type LocalVoiceModelFormat = 'vits-piper' | 'vits-melo' | 'kokoro'

export type LocalVoiceSpeaker = {
  sid: number
  labelZh: string
  labelEn: string
}

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
  speakers?: ReadonlyArray<LocalVoiceSpeaker>
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
    id: 'iflytek',
    available: true,
    labelZh: '科大讯飞在线语音（免费日 500 次 · 推荐）',
    labelEn: 'iFlytek Online TTS (500 Free/Day)',
  },
  {
    id: 'system',
    available: true,
    labelZh: '系统 / 浏览器朗读（零体积即时可用）',
    labelEn: 'System / Browser Speech (Zero Footprint)',
  },
  {
    id: 'local-sherpa',
    available: true,
    labelZh: '本地离线语音（sherpa-onnx · 按需下载包）',
    labelEn: 'Local Offline TTS (sherpa-onnx · On-Demand)',
  },
  {
    id: 'official',
    available: true,
    labelZh: 'DeepSeek 官方语音（按量计费）',
    labelEn: 'DeepSeek Official TTS (Metered)',
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

export const DEFAULT_LOCAL_VOICE_ID = 'melo-zh-en'

export const LOCAL_VOICE_PACKS: ReadonlyArray<LocalVoicePack> = [
  {
    id: 'melo-zh-en',
    nameZh: 'MeloTTS · 中英混读自然女声',
    nameEn: 'MeloTTS · EN/ZH Natural Voice',
    sizeMb: 159.3,
    builtIn: false,
    format: 'vits-melo',
    archiveUrl:
      'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-melo-tts-zh_en.tar.bz2',
    archiveName: 'vits-melo-tts-zh_en.tar.bz2',
    defaultSid: 0,
  },
  {
    id: 'kokoro-v1_1',
    nameZh: 'Kokoro v1.1 · 中英自然多音色（103音色）',
    nameEn: 'Kokoro v1.1 · EN/ZH Multi-Voice (103 Voices)',
    sizeMb: 140.2,
    builtIn: false,
    format: 'kokoro',
    archiveUrl:
      'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-int8-multi-lang-v1_1.tar.bz2',
    archiveName: 'kokoro-int8-multi-lang-v1_1.tar.bz2',
    defaultSid: 3,
    speakers: [
      {
        sid: 3,
        labelZh: '中文女声 · zf_001（默认清晰女声）',
        labelEn: 'ZH Female · zf_001 (Default)',
      },
      { sid: 4, labelZh: '中文女声 · zf_002（温柔女声）', labelEn: 'ZH Female · zf_002 (Warm)' },
      { sid: 5, labelZh: '中文女声 · zf_003（明亮女声）', labelEn: 'ZH Female · zf_003 (Bright)' },
      { sid: 6, labelZh: '中文女声 · zf_004（知性女声）', labelEn: 'ZH Female · zf_004 (Calm)' },
      { sid: 8, labelZh: '中文女声 · zf_006（清甜女声）', labelEn: 'ZH Female · zf_006 (Sweet)' },
      { sid: 10, labelZh: '中文女声 · zf_008（沉稳女声）', labelEn: 'ZH Female · zf_008 (Steady)' },
      { sid: 14, labelZh: '中文女声 · zf_021（柔和女声）', labelEn: 'ZH Female · zf_021 (Soft)' },
      { sid: 58, labelZh: '中文男声 · zm_009（醇厚男声）', labelEn: 'ZH Male · zm_009 (Deep)' },
      { sid: 59, labelZh: '中文男声 · zm_010（清晰男声）', labelEn: 'ZH Male · zm_010 (Clear)' },
      { sid: 60, labelZh: '中文男声 · zm_011（沉稳男声）', labelEn: 'ZH Male · zm_011 (Steady)' },
      { sid: 63, labelZh: '中文男声 · zm_014（青年男声）', labelEn: 'ZH Male · zm_014 (Youth)' },
      { sid: 0, labelZh: '英文女声 · Maple (af_maple)', labelEn: 'EN Female · Maple (af_maple)' },
      { sid: 1, labelZh: '英文女声 · Sol (af_sol)', labelEn: 'EN Female · Sol (af_sol)' },
      { sid: 2, labelZh: '英文女声 · Vale (bf_vale)', labelEn: 'EN Female · Vale (bf_vale)' },
    ],
  },
  {
    id: 'kokoro-v1_0',
    nameZh: 'Kokoro v1.0 · 八语种多音色（中/英/日/法等）',
    nameEn: 'Kokoro v1.0 · 8-Language Multi-Voice (ZH/EN/JA/FR...)',
    sizeMb: 126.2,
    builtIn: false,
    format: 'kokoro',
    archiveUrl:
      'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-int8-multi-lang-v1_0.tar.bz2',
    archiveName: 'kokoro-int8-multi-lang-v1_0.tar.bz2',
    defaultSid: 47,
    speakers: [
      { sid: 47, labelZh: '中文女声 · 小晓 (zf_xiaoxiao)', labelEn: 'ZH Female · zf_xiaoxiao' },
      { sid: 45, labelZh: '中文女声 · 小贝 (zf_xiaobei)', labelEn: 'ZH Female · zf_xiaobei' },
      { sid: 46, labelZh: '中文女声 · 小妮 (zf_xiaoni)', labelEn: 'ZH Female · zf_xiaoni' },
      { sid: 48, labelZh: '中文女声 · 小艺 (zf_xiaoyi)', labelEn: 'ZH Female · zf_xiaoyi' },
      { sid: 50, labelZh: '中文男声 · 云希 (zm_yunxi)', labelEn: 'ZH Male · zm_yunxi' },
      { sid: 49, labelZh: '中文男声 · 云健 (zm_yunjian)', labelEn: 'ZH Male · zm_yunjian' },
      { sid: 52, labelZh: '中文男声 · 云扬 (zm_yunyang)', labelEn: 'ZH Male · zm_yunyang' },
      { sid: 3, labelZh: '英文女声 · Heart (af_heart)', labelEn: 'EN Female · Heart (af_heart)' },
      { sid: 11, labelZh: '英文男声 · Adam (am_adam)', labelEn: 'EN Male · Adam (am_adam)' },
      { sid: 37, labelZh: '日语女声 · Alpha (jf_alpha)', labelEn: 'JA Female · Alpha (jf_alpha)' },
      { sid: 41, labelZh: '日语男声 · Kumo (jm_kumo)', labelEn: 'JA Male · Kumo (jm_kumo)' },
      { sid: 30, labelZh: '法语女声 · Siwis (ff_siwis)', labelEn: 'FR Female · Siwis (ff_siwis)' },
    ],
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
    id: 'xiao_ya-int8',
    nameZh: '小雅 · 极轻量中文女声',
    nameEn: 'XiaoYa · Ultra-Light Chinese Female',
    sizeMb: 13.4,
    builtIn: false,
    format: 'vits-piper',
    archiveUrl:
      'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-zh_CN-xiao_ya-medium-int8.tar.bz2',
    archiveName: 'vits-piper-zh_CN-xiao_ya-medium-int8.tar.bz2',
    defaultSid: 0,
  },
  {
    id: 'chaowen-int8',
    nameZh: '超文 · 极轻量中文男声',
    nameEn: 'Chaowen · Ultra-Light Chinese Male',
    sizeMb: 13.4,
    builtIn: false,
    format: 'vits-piper',
    archiveUrl:
      'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-zh_CN-chaowen-medium-int8.tar.bz2',
    archiveName: 'vits-piper-zh_CN-chaowen-medium-int8.tar.bz2',
    defaultSid: 0,
  },
]

export const findLocalVoicePack = (id?: string | null): LocalVoicePack =>
  LOCAL_VOICE_PACKS.find((pack) => pack.id === id) ?? LOCAL_VOICE_PACKS[0]

export const resolveLocalVoiceSpeakerId = (
  pack: LocalVoicePack,
  speakerId?: number | null
): number => {
  if (
    typeof speakerId === 'number' &&
    Number.isInteger(speakerId) &&
    pack.speakers?.some((speaker) => speaker.sid === speakerId)
  ) {
    return speakerId
  }
  return pack.defaultSid
}

const FALLBACK_MIRRORS = [
  'https://gh-proxy.com/',
  'https://ghfast.top/',
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
