export const PLATFORM_API_KEYS_URL = 'https://platform.deepseek.com/api_keys'
export const PLATFORM_TOP_UP_URL = 'https://platform.deepseek.com/top_up'
export const PLATFORM_USAGE_URL = 'https://platform.deepseek.com/usage'

/** 打开外部链接。Web 端用新标签页；原生壳可在启动时注入替换实现 */
export let openExternal = (url: string) => {
  window.open(url, '_blank', 'noopener,noreferrer')
}

export const setOpenExternal = (impl: (url: string) => void) => {
  openExternal = impl
}
