import { create } from 'zustand'
import { synthesize, TTS_SAMPLE_RATE } from '../services/api/speech.js'
import { useSettings } from '../services/settings.js'
import { stopReadAloud } from '../services/speech/readAloud.js'

type PetVoiceState = {
  status: 'idle' | 'loading' | 'playing'
}

export const usePetVoice = create<PetVoiceState>(() => ({ status: 'idle' }))

const START_DELAY = 0.08

let sharedContext: AudioContext | null = null
let activeController: AbortController | null = null
let activeSources: AudioBufferSourceNode[] = []

const ensureUnlockedContext = (): AudioContext => {
  if (!sharedContext || sharedContext.state === 'closed') {
    sharedContext = new AudioContext({ sampleRate: TTS_SAMPLE_RATE })
  }
  if (sharedContext.state === 'suspended') {
    void sharedContext.resume().catch(() => {})
  }
  return sharedContext
}

export const unlockPetAudio = () => {
  try {
    ensureUnlockedContext()
  } catch {
    // 不支持 AudioContext 时静默忽略
  }
}

const clearSources = () => {
  for (const source of activeSources) {
    try {
      source.stop()
      source.disconnect()
    } catch {
      // 忽略已结束节点
    }
  }
  activeSources = []
}

export const stopPetVoice = () => {
  if (activeController) {
    activeController.abort()
    activeController = null
  }
  clearSources()
  usePetVoice.setState({ status: 'idle' })
}

const toFloat32 = (bytes: Uint8Array) => {
  const samples = new Float32Array(bytes.length >> 1)
  const view = new DataView(bytes.buffer, bytes.byteOffset, samples.length * 2)
  for (let i = 0; i < samples.length; i++) {
    samples[i] = view.getInt16(i * 2, true) / 0x8000
  }
  return samples
}

const sanitizeSpeech = (raw: string): string =>
  raw
    .replace(/```[\s\S]*?```/g, '')
    .replace(/[*_`#]/g, '')
    .trim()
    .slice(0, 260)

export const speakPetLine = (rawText: string) => {
  const text = sanitizeSpeech(rawText)
  if (!text) {
    return
  }
  const { apiKey, ttsVoice } = useSettings.getState()
  if (!apiKey) {
    return
  }

  stopReadAloud()
  stopPetVoice()

  const controller = new AbortController()
  activeController = controller
  usePetVoice.setState({ status: 'loading' })

  void (async () => {
    let nextTime = 0
    let lastSource: AudioBufferSourceNode | null = null
    let rest = new Uint8Array(0)
    try {
      const context = ensureUnlockedContext()
      const stream = await synthesize(apiKey, text, ttsVoice, controller.signal)
      const reader = stream.getReader()
      controller.signal.addEventListener('abort', () => void reader.cancel().catch(() => {}))

      for (;;) {
        const { done, value } = await reader.read()
        if (done) {
          break
        }
        if (controller.signal.aborted) {
          return
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
        nextTime = Math.max(nextTime, context.currentTime + (lastSource ? 0 : START_DELAY))
        source.start(nextTime)
        nextTime += buffer.duration
        lastSource = source
        activeSources.push(source)
        if (usePetVoice.getState().status === 'loading') {
          usePetVoice.setState({ status: 'playing' })
        }
      }

      if (lastSource) {
        lastSource.onended = () => {
          if (activeController === controller) {
            activeController = null
            activeSources = []
            usePetVoice.setState({ status: 'idle' })
          }
        }
      } else if (activeController === controller) {
        activeController = null
        usePetVoice.setState({ status: 'idle' })
      }
    } catch {
      if (activeController === controller) {
        activeController = null
        activeSources = []
        usePetVoice.setState({ status: 'idle' })
      }
    }
  })()
}
