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

export const stopNativeCacheBackend = async (): Promise<void> => {
  if (nativeController) {
    await nativeController.stop().catch(() => {})
  }
}

export const clearRemoteCacheBackend = async (rawUrl?: string): Promise<boolean> => {
  const base = normalizeCacheBackendUrl(rawUrl ?? useSettings.getState().cacheBackendUrl)
  const res = await fetch(`${base}/api/cache/clear`, { method: 'POST' })
  return res.ok
}
