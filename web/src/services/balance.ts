import { create } from 'zustand'
import { getBalance, type BalanceInfo, type BalanceResponse } from './api/client.js'
import { classifyApiError } from './api/errors.js'
import { useSettings } from './settings.js'

export type BalanceStatus = 'idle' | 'loading' | 'ok' | 'insufficient' | 'error' | 'unauthorized'

type BalanceState = {
  status: BalanceStatus
  data: BalanceResponse | null
  updatedAt: number | null
}

export const useBalance = create<BalanceState>(() => ({
  status: 'idle',
  data: null,
  updatedAt: null,
}))

let controller: AbortController | null = null
let debounceTimer: number | null = null

const isPositiveDecimalString = (raw: string): boolean => {
  const trimmed = raw.trim()
  if (!trimmed || trimmed.startsWith('-')) {
    return false
  }
  return /[1-9]/.test(trimmed)
}

export const formatCurrencySymbol = (currency: string): string =>
  currency === 'CNY' ? '¥' : currency === 'USD' ? '$' : `${currency} `

export const formatBalanceValue = (
  info: BalanceInfo,
  field: keyof Omit<BalanceInfo, 'currency'> = 'total_balance'
): string => `${formatCurrencySymbol(info.currency)}${info[field]}`

export const formatBalanceSummary = (data: BalanceResponse | null): string => {
  if (!data?.balance_infos.length) {
    return ''
  }
  return data.balance_infos.map((info) => formatBalanceValue(info, 'total_balance')).join(' / ')
}

export const formatCompactBalance = (data: BalanceResponse | null): string => {
  const primary =
    data?.balance_infos.find((info) => info.currency === 'CNY') ?? data?.balance_infos[0]
  if (!primary) {
    return ''
  }
  const integerPart = primary.total_balance.split('.')[0] || primary.total_balance
  return `${formatCurrencySymbol(primary.currency)}${integerPart}`
}

export const refreshBalance = async (): Promise<void> => {
  if (debounceTimer !== null) {
    window.clearTimeout(debounceTimer)
    debounceTimer = null
  }
  const { apiProvider, apiKey } = useSettings.getState()
  if (apiProvider === 'custom' || !apiKey) {
    controller?.abort()
    controller = null
    useBalance.setState({ status: 'idle', data: null, updatedAt: null })
    return
  }
  controller?.abort()
  const current = new AbortController()
  controller = current
  useBalance.setState((state) => ({
    status: state.data ? state.status : 'loading',
  }))
  try {
    const data = await getBalance(apiKey, current.signal)
    if (controller !== current) {
      return
    }
    const hasPositive = data.balance_infos.some((info) =>
      isPositiveDecimalString(info.total_balance)
    )
    const empty = !data.is_available || !hasPositive
    useBalance.setState({
      data,
      status: empty ? 'insufficient' : 'ok',
      updatedAt: Date.now(),
    })
  } catch (error) {
    if (current.signal.aborted || controller !== current) {
      return
    }
    const kind = classifyApiError(error)
    useBalance.setState({
      status:
        kind === 'unauthorized'
          ? 'unauthorized'
          : kind === 'insufficientBalance'
            ? 'insufficient'
            : 'error',
    })
  }
}

export const debouncedRefreshBalance = (delayMs = 2000): void => {
  if (debounceTimer !== null) {
    window.clearTimeout(debounceTimer)
  }
  debounceTimer = window.setTimeout(() => {
    debounceTimer = null
    void refreshBalance()
  }, delayMs)
}

export const markInsufficient = (): void => {
  useBalance.setState({ status: 'insufficient' })
  debouncedRefreshBalance(500)
}

export const bindBalanceAutoRefresh = () => {
  const onVisible = () => {
    if (document.visibilityState === 'visible') {
      void refreshBalance()
    }
  }
  const onFocus = () => {
    void refreshBalance()
  }
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('focus', onFocus)
  const timer = window.setInterval(onVisible, 60_000)
  const unsub = useSettings.subscribe((state, prev) => {
    if (state.apiKey !== prev.apiKey || state.apiProvider !== prev.apiProvider) {
      useBalance.setState({ data: null, updatedAt: null })
      void refreshBalance()
    }
  })
  void refreshBalance()
  return () => {
    document.removeEventListener('visibilitychange', onVisible)
    window.removeEventListener('focus', onFocus)
    window.clearInterval(timer)
    if (debounceTimer !== null) {
      window.clearTimeout(debounceTimer)
      debounceTimer = null
    }
    controller?.abort()
    unsub()
  }
}
