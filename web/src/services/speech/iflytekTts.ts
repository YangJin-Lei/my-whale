export const IFLYTEK_CONSOLE_URL = 'https://console.xfyun.cn/services/tts'
export const IFLYTEK_SAMPLE_RATE = 16000

export type IflytekVoiceId = 'xiaoyan' | 'aisjiuxu' | 'aisxping' | 'aisjinger' | 'aisbabyxu'

export type IflytekVoiceOption = {
  id: IflytekVoiceId
  labelZh: string
  labelEn: string
}

export const IFLYTEK_VOICES: ReadonlyArray<IflytekVoiceOption> = [
  { id: 'xiaoyan', labelZh: '讯飞小燕（亲切女声 · 免费基础）', labelEn: 'Xiaoyan (Female · Free)' },
  { id: 'aisjiuxu', labelZh: '讯飞许久（磁性男声 · 免费基础）', labelEn: 'XuJiu (Male · Free)' },
  {
    id: 'aisxping',
    labelZh: '讯飞小萍（知性女声 · 免费基础）',
    labelEn: 'Xiaoping (Female · Free)',
  },
  {
    id: 'aisjinger',
    labelZh: '讯飞小婧（柔和女声 · 免费基础）',
    labelEn: 'Xiaojing (Female · Free)',
  },
  {
    id: 'aisbabyxu',
    labelZh: '讯飞许小宝（活泼童声 · 免费基础）',
    labelEn: 'Xuxiaobao (Child · Free)',
  },
]

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

const base64ToFloat32Pcm = (base64: string): Float32Array => {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  const samples = new Float32Array(bytes.length >> 1)
  const view = new DataView(bytes.buffer, bytes.byteOffset, samples.length * 2)
  for (let i = 0; i < samples.length; i += 1) {
    samples[i] = view.getInt16(i * 2, true) / 0x8000
  }
  return samples
}

/** 构造科大讯飞旧版流式 TTS WebSocket v2 HMAC-SHA256 鉴权连接地址 */
export const buildIflytekAuthUrl = async ({
  apiKey,
  apiSecret,
  now,
}: {
  apiKey: string
  apiSecret: string
  now?: Date
}): Promise<string> => {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) {
    throw new Error('Web Crypto API unavailable for iFlytek HMAC signing')
  }
  const host = 'tts-api.xfyun.cn'
  const path = '/v2/tts'
  const date = (now ?? new Date()).toUTCString()
  const signatureOrigin = `host: ${host}\ndate: ${date}\nGET ${path} HTTP/1.1`
  const encoder = new TextEncoder()
  const key = await subtle.importKey(
    'raw',
    encoder.encode(apiSecret.trim()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sigBuf = await subtle.sign('HMAC', key, encoder.encode(signatureOrigin))
  const signature = bytesToBase64(new Uint8Array(sigBuf))
  const authorizationOrigin =
    `api_key="${apiKey.trim()}", algorithm="hmac-sha256", ` +
    `headers="host date request-line", signature="${signature}"`
  const authorization = bytesToBase64(encoder.encode(authorizationOrigin))
  return (
    `wss://${host}${path}?authorization=${encodeURIComponent(authorization)}` +
    `&date=${encodeURIComponent(date)}&host=${encodeURIComponent(host)}`
  )
}

/** 按 UTF-8 字节上限切分长文本：正常回复控制在 1 次连接以内，节省每日 500 次免费额度 */
export const splitIflytekTextChunks = (cleanedText: string, maxUtf8Bytes = 2400): string[] => {
  const trimmed = cleanedText.trim()
  if (!trimmed) {
    return []
  }
  const encoder = new TextEncoder()
  if (encoder.encode(trimmed).length <= maxUtf8Bytes) {
    return [trimmed]
  }
  const sentences = trimmed
    .split(/(?<=[。！？!?；;\n])/)
    .map((s) => s.trim())
    .filter(Boolean)
  const chunks: string[] = []
  let current = ''
  for (const sentence of sentences) {
    const candidate = current ? `${current} ${sentence}` : sentence
    if (encoder.encode(candidate).length <= maxUtf8Bytes) {
      current = candidate
      continue
    }
    if (current) {
      chunks.push(current)
      current = ''
    }
    if (encoder.encode(sentence).length <= maxUtf8Bytes) {
      current = sentence
      continue
    }
    // 单句超长时按字符边界切段
    let slice = ''
    for (const ch of sentence) {
      const next = `${slice}${ch}`
      if (encoder.encode(next).length > maxUtf8Bytes && slice) {
        chunks.push(slice)
        slice = ch
      } else {
        slice = next
      }
    }
    if (slice) {
      current = slice
    }
  }
  if (current) {
    chunks.push(current)
  }
  return chunks
}

type IflytekWsResponse = {
  code?: number
  message?: string
  data?: {
    audio?: string
    status?: number
  }
}

export const synthesizeWithIflytek = async ({
  appId,
  apiKey,
  apiSecret,
  vcn,
  text,
  signal,
  onChunk,
}: {
  appId: string
  apiKey: string
  apiSecret: string
  vcn: IflytekVoiceId
  text: string
  signal: AbortSignal
  onChunk: (samples: Float32Array, sampleRate: number) => void
}): Promise<void> => {
  const cleanAppId = appId.trim()
  const cleanApiKey = apiKey.trim()
  const cleanApiSecret = apiSecret.trim()
  if (!cleanAppId || !cleanApiKey || !cleanApiSecret) {
    throw new Error('请先在设置中填写讯飞 APPID、APIKey 与 APISecret')
  }
  if (signal.aborted) {
    return
  }
  const wsUrl = await buildIflytekAuthUrl({ apiKey: cleanApiKey, apiSecret: cleanApiSecret })
  if (signal.aborted) {
    return
  }

  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    let settled = false

    const cleanup = () => {
      signal.removeEventListener('abort', onAbort)
      ws.onopen = null
      ws.onmessage = null
      ws.onerror = null
      ws.onclose = null
    }

    const doneOk = () => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close()
      }
      resolve()
    }

    const doneErr = (err: Error) => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close()
      }
      reject(err)
    }

    const onAbort = () => {
      doneOk()
    }
    signal.addEventListener('abort', onAbort, { once: true })

    ws.onopen = () => {
      if (signal.aborted) {
        doneOk()
        return
      }
      const payload = {
        common: { app_id: cleanAppId },
        business: {
          aue: 'raw',
          auf: `audio/L16;rate=${IFLYTEK_SAMPLE_RATE}`,
          vcn,
          speed: 50,
          volume: 50,
          pitch: 50,
          tte: 'UTF8',
        },
        data: {
          status: 2,
          text: bytesToBase64(new TextEncoder().encode(text)),
        },
      }
      ws.send(JSON.stringify(payload))
    }

    ws.onmessage = (event) => {
      if (signal.aborted) {
        doneOk()
        return
      }
      try {
        const parsed = JSON.parse(String(event.data)) as IflytekWsResponse
        if (typeof parsed.code === 'number' && parsed.code !== 0) {
          doneErr(
            new Error(`讯飞合成失败 (${parsed.code}): ${parsed.message || '请检查凭证或当日额度'}`)
          )
          return
        }
        const audioB64 = parsed.data?.audio
        if (audioB64) {
          const samples = base64ToFloat32Pcm(audioB64)
          if (samples.length > 0) {
            onChunk(samples, IFLYTEK_SAMPLE_RATE)
          }
        }
        if (parsed.data?.status === 2) {
          doneOk()
        }
      } catch (err) {
        doneErr(err instanceof Error ? err : new Error(String(err)))
      }
    }

    ws.onerror = () => {
      if (signal.aborted) {
        doneOk()
      } else {
        doneErr(new Error('无法连接科大讯飞 TTS 服务，请检查网络或凭证'))
      }
    }

    ws.onclose = () => {
      if (!settled) {
        doneOk()
      }
    }
  })
}
