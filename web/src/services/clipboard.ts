export const API_KEY_PATTERN = /^sk-[A-Za-z0-9_-]{20,}$/

export const extractApiKey = (raw: string): string | null => {
  const trimmed = raw.trim()
  return API_KEY_PATTERN.test(trimmed) ? trimmed : null
}

/** 尝试读取剪贴板中的 API Key；浏览器拒绝授权或不支持时静默返回 null */
export const readClipboardText = async (): Promise<string | null> => {
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
