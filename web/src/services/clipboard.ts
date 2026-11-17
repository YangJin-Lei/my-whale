export const API_KEY_PATTERN = /^sk-[A-Za-z0-9_-]{20,}$/

export const extractApiKey = (raw: string): string | null => {
  const trimmed = raw.trim()
  return API_KEY_PATTERN.test(trimmed) ? trimmed : null
}

let nativeReader: (() => Promise<string | null>) | null = null

export const setClipboardReader = (impl: () => Promise<string | null>) => {
  nativeReader = impl
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

export const readClipboardApiKey = async (): Promise<string | null> => {
  const text = await readClipboardText()
  return text === null ? null : extractApiKey(text)
}
