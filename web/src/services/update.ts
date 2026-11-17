import { create } from 'zustand'

const DISMISSED_KEY = 'chat-demo:dismissed-update-version'
export const RELEASES_PAGE_URL = 'https://github.com/YangJin-Lei/my-whale/releases'
const RELEASES_API_URL = 'https://api.github.com/repos/YangJin-Lei/my-whale/releases/latest'

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

export const checkForUpdates = async (manual = false): Promise<void> => {
  if (inflight) {
    return inflight
  }
  if (manual) {
    useUpdateStore.setState({ status: 'checking' })
  }

  inflight = (async () => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8000)
    try {
      const response = await fetch(RELEASES_API_URL, {
        headers: { Accept: 'application/vnd.github+json' },
        signal: controller.signal,
      })
      if (!response.ok) {
        if (manual) {
          useUpdateStore.setState({ status: 'error' })
        }
        return
      }
      const data = (await response.json()) as { tag_name?: unknown; html_url?: unknown }
      const tag = typeof data.tag_name === 'string' ? data.tag_name.trim() : ''
      const url =
        typeof data.html_url === 'string' && data.html_url.startsWith('https://')
          ? data.html_url
          : RELEASES_PAGE_URL
      if (tag && isNewerVersion(tag, CURRENT_VERSION)) {
        useUpdateStore.setState({
          status: 'available',
          latestVersion: tag,
          releaseUrl: url,
        })
      } else {
        useUpdateStore.setState({
          status: 'latest',
          latestVersion: tag || null,
          releaseUrl: url,
        })
      }
    } catch {
      if (manual) {
        useUpdateStore.setState({ status: 'error' })
      }
    } finally {
      clearTimeout(timer)
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
