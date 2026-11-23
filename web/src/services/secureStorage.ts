export type NativeSecureStorage = {
  getSecret: (key: string) => Promise<{ value: string | null; backend?: string }>
  setSecret: (key: string, value: string | null) => Promise<void>
  status?: () => Promise<{ available: boolean; backend?: string }>
}

let nativeSecureStorage: NativeSecureStorage | null = null
let activeBackendName = 'browser-localstorage'

export const API_KEY_SECRET_ID = 'api-key'
export const CUSTOM_API_KEY_SECRET_ID = 'custom-api-key'
export const IFLYTEK_API_KEY_SECRET_ID = 'iflytek-api-key'
export const IFLYTEK_API_SECRET_ID = 'iflytek-api-secret'

export const setNativeSecureStorage = (adapter: NativeSecureStorage) => {
  nativeSecureStorage = adapter
  activeBackendName = 'android-keystore-aes-gcm'
}

export const hasNativeSecureStorage = () => nativeSecureStorage !== null

export const getSecureStorageBackendName = () => activeBackendName

export const saveSecureSecret = async (key: string, value: string | null): Promise<void> => {
  if (!nativeSecureStorage) {
    return
  }
  await nativeSecureStorage.setSecret(key, value)
}

export const loadSecureSecret = async (key: string): Promise<string | null> => {
  if (!nativeSecureStorage) {
    return null
  }
  try {
    const res = await nativeSecureStorage.getSecret(key)
    if (res.backend) {
      activeBackendName = res.backend
    }
    return typeof res.value === 'string' && res.value.trim() ? res.value.trim() : null
  } catch {
    return null
  }
}
