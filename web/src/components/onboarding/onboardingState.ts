import { create } from 'zustand'

const ONBOARDING_SKIPPED_KEY = 'chat-demo:onboarding-skipped'

export const useOnboarding = create(() => ({
  open: false,
}))

export const openOnboarding = () => useOnboarding.setState({ open: true })

export const closeOnboarding = () => useOnboarding.setState({ open: false })

export const markOnboardingSkipped = () => {
  try {
    localStorage.setItem(ONBOARDING_SKIPPED_KEY, 'true')
  } catch {
    // 忽略存储限制
  }
}

export const clearOnboardingSkipped = () => {
  try {
    localStorage.removeItem(ONBOARDING_SKIPPED_KEY)
  } catch {
    // 忽略存储限制
  }
}

export const hasSkippedOnboarding = (): boolean => {
  try {
    return localStorage.getItem(ONBOARDING_SKIPPED_KEY) === 'true'
  } catch {
    return false
  }
}
