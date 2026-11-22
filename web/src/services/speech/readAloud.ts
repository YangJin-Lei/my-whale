import { create } from 'zustand'
import type { TranslationMessage } from '../../i18n/index.js'
import { ApiError } from '../api/client.js'
import { classifyApiError } from '../api/errors.js'
import { synthesize, TTS_SAMPLE_RATE } from '../api/speech.js'
import { useSettings } from '../settings.js'
import { DEFAULT_LOCAL_VOICE_ID, findLocalVoicePack } from './engines.js'
import { hasNativeLocalTts, splitSpeechSentences, synthesizeWithLocalTts } from './localTts.js'

/**
 * 朗读：同一时间只读一条回复。
 * 请求 TTS 的裸 PCM 流，边收边用 AudioContext 按顺序排程播放，首帧到达即出声。
 * 状态：loading（已请求、未出声）→ playing → 结束回到 idle。
 */
export type ReadAloudStatus = 'idle' | 'loading' | 'playing'

type ReadAloudState = {
  /** 正在朗读的回复 id */
  messageId: string | null
  status: ReadAloudStatus
}

export const useReadAloud = create<ReadAloudState>(() => ({ messageId: null, status: 'idle' }))

/** 首帧前多缓冲一点，减少网络抖动造成的断续 */
const START_DELAY = 0.1

let sharedContext: AudioContext | null = null
let activeSources: AudioBufferSourceNode[] = []
let current: { controller: AbortController } | null = null

const ensureAudioContext = (): AudioContext => {
  if (!sharedContext || sharedContext.state === 'closed') {
    sharedContext = new AudioContext({ sampleRate: TTS_SAMPLE_RATE })
  }
  if (sharedContext.state === 'suspended') {
    void sharedContext.resume().catch(() => {})
  }
  return sharedContext
}

/** 在用户手势（发送消息 / 开启开关）时提前解锁 AudioContext，确保异步回复到达可直接播报 */
export const unlockReadAloudAudio = () => {
  try {
    ensureAudioContext()
  } catch {
    // 受限环境静默忽略
  }
}

const clearSources = () => {
  for (const src of activeSources) {
    try {
      src.stop()
      src.disconnect()
    } catch {
      // 忽略已停止节点
    }
  }
  activeSources = []
}

const finish = (controller: AbortController) => {
  if (current?.controller !== controller) {
    return
  }
  clearSources()
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel()
    } catch {
      // 忽略系统朗读停止异常
    }
  }
  current = null
  useReadAloud.setState({ messageId: null, status: 'idle' })
}

/** 停止当前朗读（发送、停止生成、切换会话等场景调用） */
export const stopReadAloud = () => {
  if (current) {
    const { controller } = current
    controller.abort()
    finish(controller)
  }
}

/** 16-bit 小端 PCM 转成 Float32；奇数字节留到下一段 */
const toFloat32 = (bytes: Uint8Array) => {
  const samples = new Float32Array(bytes.length >> 1)
  const view = new DataView(bytes.buffer, bytes.byteOffset, samples.length * 2)
  for (let i = 0; i < samples.length; i++) {
    samples[i] = view.getInt16(i * 2, true) / 0x8000
  }
  return samples
}

export const describeReadAloudError = (error: unknown): TranslationMessage | string => {
  if (error instanceof ApiError && error.kind === 'protocol') {
    return error.message
  }
  // 400 表示这段正文服务端无法合成，与其余失败区分开
  if (error instanceof ApiError && error.status === 400) {
    return { key: 'ttsUnavailable' }
  }
  switch (classifyApiError(error)) {
    case 'unauthorized':
      return { key: 'apiKeyInvalidRetry' }
    case 'insufficientBalance':
      return { key: 'insufficientBalance' }
    case 'rateLimited':
      return { key: 'rateLimited' }
    default:
      return { key: 'ttsFailed' }
  }
}

const speakWithSystemSpeech = async (text: string, controller: AbortController): Promise<void> => {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    throw new Error('SpeechSynthesis unavailable')
  }
  const synth = window.speechSynthesis
  synth.cancel()
  const chunks = splitSpeechSentences(text, 120)
  if (chunks.length === 0) {
    return
  }
  for (const chunk of chunks) {
    if (controller.signal.aborted) {
      return
    }
    await new Promise<void>((resolve, reject) => {
      const utterance = new SpeechSynthesisUtterance(chunk)
      utterance.lang = /[\u4e00-\u9fff]/.test(chunk) ? 'zh-CN' : 'en-US'
      const onAbort = () => {
        synth.cancel()
        resolve()
      }
      controller.signal.addEventListener('abort', onAbort, { once: true })
      utterance.onstart = () => {
        if (!controller.signal.aborted && useReadAloud.getState().status === 'loading') {
          useReadAloud.setState({ status: 'playing' })
        }
      }
      utterance.onend = () => {
        controller.signal.removeEventListener('abort', onAbort)
        resolve()
      }
      utterance.onerror = () => {
        controller.signal.removeEventListener('abort', onAbort)
        if (controller.signal.aborted) {
          resolve()
        } else {
          reject(new Error('System speech synthesis failed'))
        }
      }
      synth.speak(utterance)
    })
  }
}

/**
 * 开始朗读一条回复的正文；同一条正在朗读时调用等于停止。
 */
export const toggleReadAloud = (
  messageId: string,
  text: string,
  onError: (error: unknown) => void
) => {
  const reading = useReadAloud.getState().messageId
  stopReadAloud()
  if (reading === messageId) {
    return
  }
  const cleanText = text.trim()
  if (!cleanText) {
    return
  }
  const controller = new AbortController()
  current = { controller }
  useReadAloud.setState({ messageId, status: 'loading' })
  // 引擎与音色在开始朗读时读取，设置中切换后下一次朗读生效
  const { apiKey, ttsVoice, ttsEngine, localTtsVoiceId } = useSettings.getState()
  const effectiveEngine = ttsEngine === 'nekospeak' ? 'local-sherpa' : ttsEngine

  if (
    effectiveEngine === 'system' ||
    (effectiveEngine === 'local-sherpa' && !hasNativeLocalTts())
  ) {
    void speakWithSystemSpeech(cleanText, controller)
      .then(() => finish(controller))
      .catch((error) => {
        if (!controller.signal.aborted) {
          finish(controller)
          onError(error)
        }
      })
    return
  }

  const context = ensureAudioContext()

  if (effectiveEngine === 'local-sherpa') {
    void (async () => {
      const sentences = splitSpeechSentences(cleanText, 90)
      if (sentences.length === 0) {
        finish(controller)
        return
      }
      let nextTime = 0
      let lastSource: AudioBufferSourceNode | null = null
      let activePack = findLocalVoicePack(localTtsVoiceId)
      try {
        for (const sentence of sentences) {
          if (controller.signal.aborted) {
            return
          }
          let audio: { samples: Float32Array; sampleRate: number }
          try {
            audio = await synthesizeWithLocalTts(
              sentence,
              activePack.id,
              1.0,
              activePack.defaultSid
            )
          } catch (err) {
            if (activePack.id !== DEFAULT_LOCAL_VOICE_ID) {
              activePack = findLocalVoicePack(DEFAULT_LOCAL_VOICE_ID)
              audio = await synthesizeWithLocalTts(
                sentence,
                activePack.id,
                1.0,
                activePack.defaultSid
              )
            } else {
              throw err
            }
          }
          if (controller.signal.aborted) {
            return
          }
          if (audio.samples.length === 0) {
            continue
          }
          const buffer = context.createBuffer(1, audio.samples.length, audio.sampleRate)
          const channelSamples = new Float32Array(audio.samples.length)
          channelSamples.set(audio.samples)
          buffer.copyToChannel(channelSamples, 0)
          const source = context.createBufferSource()
          source.buffer = buffer
          source.connect(context.destination)
          nextTime = Math.max(nextTime, context.currentTime + (lastSource ? 0 : START_DELAY))
          source.start(nextTime)
          nextTime += buffer.duration
          lastSource = source
          activeSources.push(source)
          if (useReadAloud.getState().status === 'loading') {
            useReadAloud.setState({ status: 'playing' })
          }
        }
        if (lastSource) {
          lastSource.onended = () => finish(controller)
        } else {
          finish(controller)
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          finish(controller)
          onError(error)
        }
      }
    })()
    return
  }

  void (async () => {
    let nextTime = 0
    let lastSource: AudioBufferSourceNode | null = null
    let rest = new Uint8Array(0)
    try {
      const stream = await synthesize(apiKey ?? '', cleanText, ttsVoice, controller.signal)
      const reader = stream.getReader()
      controller.signal.addEventListener('abort', () => void reader.cancel().catch(() => {}))
      for (;;) {
        const { done, value } = await reader.read()
        if (done) {
          break
        }
        const bytes = new Uint8Array(rest.length + value.length)
        bytes.set(rest)
        bytes.set(value, rest.length)
        const samples = toFloat32(bytes)
        rest = bytes.slice(samples.length * 2)
        if (samples.length === 0) {
          continue
        }
        const buffer = context.createBuffer(1, samples.length, TTS_SAMPLE_RATE)
        buffer.copyToChannel(samples, 0)
        const source = context.createBufferSource()
        source.buffer = buffer
        source.connect(context.destination)
        // 网络慢于播放时从当前时间续上，不补播过去的时间
        nextTime = Math.max(nextTime, context.currentTime + (lastSource ? 0 : START_DELAY))
        source.start(nextTime)
        nextTime += buffer.duration
        lastSource = source
        activeSources.push(source)
        if (useReadAloud.getState().status === 'loading') {
          useReadAloud.setState({ status: 'playing' })
        }
      }
      if (lastSource) {
        lastSource.onended = () => finish(controller)
      } else {
        finish(controller)
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        finish(controller)
        onError(error)
      }
    }
  })()
}

/** 开启「自动朗读」后，当回复完成时自动朗读正文 */
export const autoPlayReadAloud = (messageId: string, text: string) => {
  if (!text.trim() || useReadAloud.getState().messageId === messageId) {
    return
  }
  toggleReadAloud(messageId, text, () => {})
}
