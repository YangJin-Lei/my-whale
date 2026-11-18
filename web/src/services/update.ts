import { create } from 'zustand'

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

type UpdateStatus = 'idle' | 'checking' | 'available' | 'latest' | 'error'

type UpdateState = {
  status: UpdateStatus
  latestVersion: string | null
  releaseUrl: string
  dismissedVersion: string | null
}

export const useUpdateStore = create<UpdateState>(() => ({
  status: 'idle',
  latestVersion: null,
  releaseUrl: RELEASES_PAGE_URL,
  dismissedVersion: readDismissed(),
}))

let inflight: Promise<void> | null = null

type LatestReleaseMeta = {
  tag: string
  url: string
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
    const url =
      typeof apiData.html_url === 'string' && apiData.html_url.startsWith('https://')
        ? apiData.html_url
        : RELEASES_PAGE_URL
    return { tag: apiData.tag_name.trim(), url }
  }

  // GitHub REST API 未鉴权每小时限流 60 次或被网络拦截时，回退到 GitHub Pages 静态版本清单
  const pagesData = await fetchJsonWithTimeout(`${PAGES_VERSION_URL}?t=${Date.now()}`)
  if (pagesData && typeof pagesData.tag_name === 'string' && pagesData.tag_name.trim()) {
    const url =
      typeof pagesData.url === 'string' && pagesData.url.startsWith('https://')
        ? pagesData.url
        : `${RELEASES_PAGE_URL}/latest`
    return { tag: pagesData.tag_name.trim(), url }
  }

  const rawPkg = await fetchJsonWithTimeout(`${RAW_PACKAGE_URL}?t=${Date.now()}`)
  if (rawPkg && typeof rawPkg.version === 'string' && rawPkg.version.trim()) {
    return {
      tag: `v${rawPkg.version.trim().replace(/^v/i, '')}`,
      url: `${RELEASES_PAGE_URL}/latest`,
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
        })
      } else {
        useUpdateStore.setState({
          status: 'latest',
          latestVersion: meta.tag,
          releaseUrl: meta.url,
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
