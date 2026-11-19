export const API_KEY_PATTERN = /^sk-[A-Za-z0-9_-]{20,}$/

export const extractApiKey = (raw: string): string | null => {
  const trimmed = raw.trim()
  return API_KEY_PATTERN.test(trimmed) ? trimmed : null
}

let nativeReader: (() => Promise<string | null>) | null = null
let nativeWriter: ((text: string) => Promise<void>) | null = null

export const setClipboardReader = (impl: () => Promise<string | null>) => {
  nativeReader = impl
}

export const setClipboardWriter = (impl: (text: string) => Promise<void>) => {
  nativeWriter = impl
}

/** 尝试读取剪贴板；原生端优先走 Capacitor Clipboard，Web 端走浏览器 API */
export const readClipboardText = async (): Promise<string | null> => {
  if (nativeReader) {
    return nativeReader()
  }
  if (typeof navigator === 'undefined' || !navigator.clipboard?.readText) {
    return null
  }
  try {
    return await navigator.clipboard.readText()
  } catch {
    return null
  }
}

export const writeClipboardText = async (text: string): Promise<boolean> => {
  if (nativeWriter) {
    try {
      await nativeWriter(text)
      return true
    } catch {
      return false
    }
  }
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // 回退 execCommand
    }
  }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(area)
    return ok
  } catch {
    return false
  }
}

export const readClipboardApiKey = async (): Promise<string | null> => {
  const text = await readClipboardText()
  return text === null ? null : extractApiKey(text)
}
