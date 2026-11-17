import { create } from 'zustand'

export const useOnboarding = create(() => ({
  open: false,
}))

export const openOnboarding = () => useOnboarding.setState({ open: true })

export const closeOnboarding = () => useOnboarding.setState({ open: false })
