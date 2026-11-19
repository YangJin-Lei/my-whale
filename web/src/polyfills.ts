/**
 * 老旧手机 WebView（Chromium 70+ / WebKit 13+）运行时兼容垫片：
 * 必须在所有业务模块导入之前执行。
 */
if (typeof Object.hasOwn !== 'function') {
  Object.defineProperty(Object, 'hasOwn', {
    value: (obj: object, prop: PropertyKey): boolean =>
      Object.prototype.hasOwnProperty.call(obj, prop),
    configurable: true,
    writable: true,
  })
}

if (typeof Array.prototype.at !== 'function') {
  Object.defineProperty(Array.prototype, 'at', {
    value: function at<T>(this: T[], index: number): T | undefined {
      const n = Math.trunc(index) || 0
      const idx = n < 0 ? this.length + n : n
      if (idx < 0 || idx >= this.length) {
        return undefined
      }
      return this[idx]
    },
    configurable: true,
    writable: true,
  })
}

if (typeof String.prototype.at !== 'function') {
  Object.defineProperty(String.prototype, 'at', {
    value: function at(this: string, index: number): string | undefined {
      const n = Math.trunc(index) || 0
      const idx = n < 0 ? this.length + n : n
      if (idx < 0 || idx >= this.length) {
        return undefined
      }
      return this.charAt(idx)
    },
    configurable: true,
    writable: true,
  })
}

if (typeof String.prototype.replaceAll !== 'function') {
  Object.defineProperty(String.prototype, 'replaceAll', {
    value: function replaceAll(
      this: string,
      searchValue: string | RegExp,
      replaceValue: string | ((substring: string, ...args: unknown[]) => string)
    ): string {
      if (searchValue instanceof RegExp) {
        const flags = searchValue.flags.includes('g') ? searchValue.flags : `${searchValue.flags}g`
        const re = new RegExp(searchValue.source, flags)
        return typeof replaceValue === 'function'
          ? this.replace(re, replaceValue)
          : this.replace(re, replaceValue)
      }
      const parts = this.split(String(searchValue))
      if (typeof replaceValue === 'function') {
        return parts.reduce(
          (acc, cur, idx) => (idx === 0 ? cur : `${acc}${replaceValue(String(searchValue))}${cur}`),
          ''
        )
      }
      return parts.join(replaceValue)
    },
    configurable: true,
    writable: true,
  })
}

if (
  typeof AbortSignal !== 'undefined' &&
  typeof AbortSignal.prototype.throwIfAborted !== 'function'
) {
  Object.defineProperty(AbortSignal.prototype, 'throwIfAborted', {
    value: function throwIfAborted(this: AbortSignal): void {
      if (this.aborted) {
        throw this.reason ?? new DOMException('Aborted', 'AbortError')
      }
    },
    configurable: true,
    writable: true,
  })
}

if (
  typeof MediaQueryList !== 'undefined' &&
  typeof MediaQueryList.prototype.addEventListener !== 'function'
) {
  Object.defineProperty(MediaQueryList.prototype, 'addEventListener', {
    value: function addEventListener(
      this: MediaQueryList,
      _type: string,
      listener: EventListenerOrEventListenerObject
    ) {
      if (typeof listener === 'function') {
        this.addListener(listener as (this: MediaQueryList, ev: MediaQueryListEvent) => void)
      }
    },
    configurable: true,
    writable: true,
  })
  Object.defineProperty(MediaQueryList.prototype, 'removeEventListener', {
    value: function removeEventListener(
      this: MediaQueryList,
      _type: string,
      listener: EventListenerOrEventListenerObject
    ) {
      if (typeof listener === 'function') {
        this.removeListener(listener as (this: MediaQueryList, ev: MediaQueryListEvent) => void)
      }
    },
    configurable: true,
    writable: true,
  })
}

if (typeof window !== 'undefined' && typeof window.AudioContext === 'undefined') {
  const win = window as Window & {
    AudioContext?: typeof AudioContext
    webkitAudioContext?: typeof AudioContext
  }
  if (win.webkitAudioContext) {
    win.AudioContext = win.webkitAudioContext
  }
}

export {}
