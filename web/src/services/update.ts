import { create } from 'zustand'
import { openExternal } from './links.js'

const DISMISSED_KEY = 'chat-demo:dismissed-update-version'
export const RELEASES_PAGE_URL = 'https://github.com/YangJin-Lei/my-whale/releases'
const RELEASES_API_URL = 'https://api.github.com/repos/YangJin-Lei/my-whale/releases/latest'
const PAGES_VERSION_URL = 'https://yangjin-lei.github.io/my-whale/version.json'
const RAW_PACKAGE_URL =
  'https://raw.githubusercontent.com/YangJin-Lei/my-whale/main/web/package.json'

const readCurrentVersion = (): string => {
  if (typeof document === 'undefined') {
    return '0.1.0'
  }
  return (
    document.querySelector('meta[name="application-version"]')?.getAttribute('content')?.trim() ||
    '0.1.0'
  )
}

export const CURRENT_VERSION = readCurrentVersion()

const parseSemver = (raw: string): [number, number, number] | null => {
  const clean = raw.trim().replace(/^v/i, '').split('-')[0] ?? ''
  const parts = clean.split('.')
  if (parts.length < 3) {
    return null
  }
  const major = Number(parts[0])
  const minor = Number(parts[1])
  const patch = Number(parts[2])
  if (!Number.isInteger(major) || !Number.isInteger(minor) || !Number.isInteger(patch)) {
    return null
  }
  return [major, minor, patch]
}

export const isNewerVersion = (candidate: string, current: string): boolean => {
  const a = parseSemver(candidate)
  const b = parseSemver(current)
  if (!a || !b) {
    return false
  }
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) {
      return a[i] > b[i]
    }
  }
  return false
}

const readDismissed = (): string | null => {
  try {
    return localStorage.getItem(DISMISSED_KEY)
  } catch {
    return null
  }
}

export type ReleaseAssets = {
  androidUrls: string[]
  windowsUrls: string[]
  macosUrls: string[]
}

export type InAppUpdateOutcome = 'installer_opened' | 'needs_permission'

export type InAppUpdater = {
  downloadAndInstall: (
    meta: { tag: string; assets: ReleaseAssets },
    onProgress: (progress: number | null) => void
  ) => Promise<InAppUpdateOutcome>
  installPending?: () => Promise<InAppUpdateOutcome>
}

let registeredUpdater: InAppUpdater | null = null

export type UpdateStatus = 'idle' | 'checking' | 'available' | 'latest' | 'error'
export type DownloadStatus = 'idle' | 'downloading' | 'installing' | 'needs_permission' | 'error'

type UpdateState = {
  status: UpdateStatus
  latestVersion: string | null
  releaseUrl: string
  releaseAssets: ReleaseAssets | null
  dismissedVersion: string | null
  hasInAppUpdater: boolean
  downloadStatus: DownloadStatus
  downloadProgress: number | null
  downloadError: string | null
}

export const useUpdateStore = create<UpdateState>(() => ({
  status: 'idle',
  latestVersion: null,
  releaseUrl: RELEASES_PAGE_URL,
  releaseAssets: null,
  dismissedVersion: readDismissed(),
  hasInAppUpdater: false,
  downloadStatus: 'idle',
  downloadProgress: null,
  downloadError: null,
}))

export const registerInAppUpdater = (updater: InAppUpdater) => {
  registeredUpdater = updater
  useUpdateStore.setState({ hasInAppUpdater: true })
}

const buildDefaultAssets = (tag: string): ReleaseAssets => {
  const normalizedTag = tag.startsWith('v') ? tag : `v${tag}`
  const ver = normalizedTag.replace(/^v/i, '')
  const base = `${RELEASES_PAGE_URL}/download/${normalizedTag}`
  return {
    androidUrls: [
      `${base}/my-whale-${normalizedTag}-android.apk`,
      `${base}/my-whale-${normalizedTag}-android-debug.apk`,
    ],
    windowsUrls: [`${base}/my-whale_${ver}_x64-setup.exe`, `${base}/my-whale_${ver}_x64_en-US.msi`],
    macosUrls: [`${base}/my-whale_${ver}_aarch64.dmg`],
  }
}

const extractReleaseAssets = (tag: string, rawAssets: unknown): ReleaseAssets => {
  const defaults = buildDefaultAssets(tag)
  if (!Array.isArray(rawAssets)) {
    return defaults
  }
  const urls = rawAssets
    .map((item) =>
      typeof item === 'object' && item !== null && 'browser_download_url' in item
        ? (item as { browser_download_url?: unknown }).browser_download_url
        : undefined
    )
    .filter((u): u is string => typeof u === 'string' && u.startsWith(`${RELEASES_PAGE_URL}/`))

  const apks = urls.filter((u) => u.endsWith('.apk'))
  const winExes = urls.filter((u) => u.endsWith('-setup.exe'))
  const winMsis = urls.filter((u) => u.endsWith('.msi'))
  const dmgs = urls.filter((u) => u.endsWith('.dmg'))

  return {
    androidUrls: apks.length > 0 ? apks : defaults.androidUrls,
    windowsUrls:
      [...winExes, ...winMsis].length > 0 ? [...winExes, ...winMsis] : defaults.windowsUrls,
    macosUrls: dmgs.length > 0 ? dmgs : defaults.macosUrls,
  }
}

let inflight: Promise<void> | null = null

type LatestReleaseMeta = {
  tag: string
  url: string
  assets: ReleaseAssets
}

const fetchJsonWithTimeout = async (url: string, headers?: Record<string, string>) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5000)
  try {
    const response = await fetch(url, { headers, signal: controller.signal })
    if (!response.ok) {
      return null
    }
    return (await response.json()) as Record<string, unknown>
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

const fetchLatestReleaseMeta = async (): Promise<LatestReleaseMeta | null> => {
  const apiData = await fetchJsonWithTimeout(RELEASES_API_URL, {
    Accept: 'application/vnd.github+json',
  })
  if (apiData && typeof apiData.tag_name === 'string' && apiData.tag_name.trim()) {
    const tag = apiData.tag_name.trim()
    const url =
      typeof apiData.html_url === 'string' && apiData.html_url.startsWith('https://')
        ? apiData.html_url
        : RELEASES_PAGE_URL
    return { tag, url, assets: extractReleaseAssets(tag, apiData.assets) }
  }

  // GitHub REST API 未鉴权每小时限流 60 次或被网络拦截时，回退到 GitHub Pages 静态版本清单
  const pagesData = await fetchJsonWithTimeout(`${PAGES_VERSION_URL}?t=${Date.now()}`)
  if (pagesData && typeof pagesData.tag_name === 'string' && pagesData.tag_name.trim()) {
    const tag = pagesData.tag_name.trim()
    const url =
      typeof pagesData.url === 'string' && pagesData.url.startsWith('https://')
        ? pagesData.url
        : `${RELEASES_PAGE_URL}/latest`
    return { tag, url, assets: buildDefaultAssets(tag) }
  }

  const rawPkg = await fetchJsonWithTimeout(`${RAW_PACKAGE_URL}?t=${Date.now()}`)
  if (rawPkg && typeof rawPkg.version === 'string' && rawPkg.version.trim()) {
    const tag = `v${rawPkg.version.trim().replace(/^v/i, '')}`
    return {
      tag,
      url: `${RELEASES_PAGE_URL}/latest`,
      assets: buildDefaultAssets(tag),
    }
  }

  return null
}

export const checkForUpdates = async (manual = false): Promise<void> => {
  if (inflight) {
    return inflight
  }
  if (manual) {
    useUpdateStore.setState({ status: 'checking' })
  }

  inflight = (async () => {
    try {
      const meta = await fetchLatestReleaseMeta()
      if (!meta) {
        if (manual) {
          useUpdateStore.setState({ status: 'error' })
        }
        return
      }
      if (isNewerVersion(meta.tag, CURRENT_VERSION)) {
        useUpdateStore.setState({
          status: 'available',
          latestVersion: meta.tag,
          releaseUrl: meta.url,
          releaseAssets: meta.assets,
        })
      } else {
        useUpdateStore.setState({
          status: 'latest',
          latestVersion: meta.tag,
          releaseUrl: meta.url,
          releaseAssets: meta.assets,
        })
      }
    } catch {
      if (manual) {
        useUpdateStore.setState({ status: 'error' })
      }
    } finally {
      inflight = null
    }
  })()

  return inflight
}

export const startInAppUpdate = async (): Promise<void> => {
  const state = useUpdateStore.getState()
  if (!registeredUpdater) {
    openExternal(state.releaseUrl)
    return
  }
  if (state.downloadStatus === 'downloading' || state.downloadStatus === 'installing') {
    return
  }
  if (state.downloadStatus === 'needs_permission' && registeredUpdater.installPending) {
    await retryPendingInstall()
    return
  }

  const tag = state.latestVersion
  if (!tag) {
    openExternal(state.releaseUrl)
    return
  }

  useUpdateStore.setState({
    downloadStatus: 'downloading',
    downloadProgress: 0,
    downloadError: null,
  })

  try {
    const assets = state.releaseAssets ?? buildDefaultAssets(tag)
    const outcome = await registeredUpdater.downloadAndInstall({ tag, assets }, (progress) => {
      if (useUpdateStore.getState().downloadStatus === 'downloading') {
        useUpdateStore.setState({ downloadProgress: progress })
      }
    })
    if (outcome === 'needs_permission') {
      useUpdateStore.setState({
        downloadStatus: 'needs_permission',
        downloadProgress: 100,
      })
    } else {
      useUpdateStore.setState({
        downloadStatus: 'installing',
        downloadProgress: 100,
      })
    }
  } catch (error) {
    useUpdateStore.setState({
      downloadStatus: 'error',
      downloadProgress: null,
      downloadError: error instanceof Error ? error.message : String(error),
    })
  }
}

export const retryPendingInstall = async (): Promise<void> => {
  if (!registeredUpdater?.installPending) {
    return
  }
  try {
    const outcome = await registeredUpdater.installPending()
    if (outcome === 'installer_opened') {
      useUpdateStore.setState({ downloadStatus: 'installing', downloadError: null })
    }
  } catch (error) {
    useUpdateStore.setState({
      downloadStatus: 'error',
      downloadError: error instanceof Error ? error.message : String(error),
    })
  }
}

export const dismissUpdateBanner = () => {
  const latest = useUpdateStore.getState().latestVersion
  if (!latest) {
    return
  }
  try {
    localStorage.setItem(DISMISSED_KEY, latest)
  } catch {
    // 忽略存储限制
  }
  useUpdateStore.setState({ dismissedVersion: latest })
}
