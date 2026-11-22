import { useSettings } from './settings.js'

export const DEFAULT_CACHE_BACKEND_URL = 'http://127.0.0.1:8787'

export type CacheBackendStats = {
  online: boolean
  mode?: string
  searchCached: number
  fetchCached: number
  searchHits: number
  fetchHits: number
  upstreamCalls: number
  prefixReadTokens: number
  prefixCreateTokens: number
  prefixInputTokens: number
}

export type NativeCacheController = {
  start: (port?: number) => Promise<{ running: boolean; url?: string }>
  stop: () => Promise<void>
  status?: () => Promise<{ running: boolean }>
}

let nativeController: NativeCacheController | null = null

export const setNativeCacheController = (controller: NativeCacheController) => {
  nativeController = controller
}

export const hasNativeCacheController = () => nativeController !== null

export const normalizeCacheBackendUrl = (raw?: string): string => {
  const trimmed = (raw ?? '').trim().replace(/\/+$/, '')
  return trimmed || DEFAULT_CACHE_BACKEND_URL
}

export const resolveEffectiveOrigin = (fallbackOrigin: string): string => {
  const { cacheModeEnabled, cacheBackendUrl } = useSettings.getState()
  return cacheModeEnabled ? normalizeCacheBackendUrl(cacheBackendUrl) : fallbackOrigin
}

const EMPTY_STATS: CacheBackendStats = {
  online: false,
  searchCached: 0,
  fetchCached: 0,
  searchHits: 0,
  fetchHits: 0,
  upstreamCalls: 0,
  prefixReadTokens: 0,
  prefixCreateTokens: 0,
  prefixInputTokens: 0,
}

export const pingCacheBackend = async (rawUrl?: string): Promise<CacheBackendStats> => {
  const base = normalizeCacheBackendUrl(rawUrl ?? useSettings.getState().cacheBackendUrl)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 2500)
  try {
    const res = await fetch(`${base}/health`, { method: 'GET', signal: controller.signal })
    if (!res.ok) {
      return EMPTY_STATS
    }
    const json = (await res.json()) as Partial<CacheBackendStats> & { ok?: boolean }
    return {
      online: Boolean(json.ok ?? true),
      mode: json.mode,
      searchCached: Number(json.searchCached ?? 0),
      fetchCached: Number(json.fetchCached ?? 0),
      searchHits: Number(json.searchHits ?? 0),
      fetchHits: Number(json.fetchHits ?? 0),
      upstreamCalls: Number(json.upstreamCalls ?? 0),
      prefixReadTokens: Number(json.prefixReadTokens ?? 0),
      prefixCreateTokens: Number(json.prefixCreateTokens ?? 0),
      prefixInputTokens: Number(json.prefixInputTokens ?? 0),
    }
  } catch {
    return EMPTY_STATS
  } finally {
    clearTimeout(timer)
  }
}

export const startNativeOrProbeCacheBackend = async (
  rawUrl?: string
): Promise<CacheBackendStats> => {
  const base = normalizeCacheBackendUrl(rawUrl ?? useSettings.getState().cacheBackendUrl)
  if (nativeController) {
    try {
      const urlObj = new URL(base)
      const port = Number(urlObj.port) || 8787
      await nativeController.start(port)
    } catch {
      await nativeController.start(8787).catch(() => {})
    }
  }
  return pingCacheBackend(base)
}

let nativeStartPromise: Promise<void> | null = null
let nativeStartFailedAt = 0
const NATIVE_RETRY_COOLDOWN_MS = 60_000

export const ensureNativeCacheStarted = async (forceRetry = false): Promise<void> => {
  if (!nativeController) {
    return
  }
  if (forceRetry) {
    nativeStartFailedAt = 0
  }
  // 启动失败后冷却一段时间，避免每次发消息都卡在 start + 2.5s 健康探测上
  if (!nativeStartPromise && Date.now() - nativeStartFailedAt < NATIVE_RETRY_COOLDOWN_MS) {
    return
  }
  if (!nativeStartPromise) {
    nativeStartPromise = startNativeOrProbeCacheBackend()
      .then((stats) => {
        if (!stats.online) {
          nativeStartPromise = null
          nativeStartFailedAt = Date.now()
        }
      })
      .catch(() => {
        nativeStartPromise = null
        nativeStartFailedAt = Date.now()
      })
  }
  await nativeStartPromise
}

export const stopNativeCacheBackend = async (): Promise<void> => {
  nativeStartPromise = null
  if (nativeController) {
    await nativeController.stop().catch(() => {})
  }
}

export const clearRemoteCacheBackend = async (rawUrl?: string): Promise<boolean> => {
  const base = normalizeCacheBackendUrl(rawUrl ?? useSettings.getState().cacheBackendUrl)
  const res = await fetch(`${base}/api/cache/clear`, { method: 'POST' })
  return res.ok
}

const buildProxyHeaders = (rawHeaders: HeadersInit | undefined, targetUrl: string): Headers => {
  const headers = new Headers(rawHeaders)
  headers.set('X-Target-Url', targetUrl)
  return headers
}

export const fetchWithProxyFallback = async (
  targetUrl: string,
  init: RequestInit
): Promise<Response> => {
  const base = normalizeCacheBackendUrl(useSettings.getState().cacheBackendUrl)
  if (nativeController) {
    await ensureNativeCacheStarted(true)
    try {
      return await fetch(`${base}/api/proxy`, {
        ...init,
        headers: buildProxyHeaders(init.headers, targetUrl),
      })
    } catch (proxyError) {
      if (init.signal?.aborted) {
        throw proxyError
      }
      return await fetch(targetUrl, init)
    }
  }
  try {
    return await fetch(targetUrl, init)
  } catch (directError) {
    if (init.signal?.aborted) {
      throw directError
    }
    const stats = await pingCacheBackend(base).catch(() => ({ online: false }))
    if (stats.online) {
      return await fetch(`${base}/api/proxy`, {
        ...init,
        headers: buildProxyHeaders(init.headers, targetUrl),
      })
    }
    throw directError
  }
}
