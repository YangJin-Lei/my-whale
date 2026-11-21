import { describe, expect, it } from 'vitest'
import { isNewerVersion } from '../update.js'

describe('isNewerVersion', () => {
  it('compares patch versions numerically instead of lexically', () => {
    expect(isNewerVersion('0.1.10', '0.1.9')).toBe(true)
    expect(isNewerVersion('0.1.9', '0.1.10')).toBe(false)
    expect(isNewerVersion('0.10.0', '0.2.0')).toBe(true)
    expect(isNewerVersion('0.2.0', '0.10.0')).toBe(false)
  })

  it('treats equal versions as not newer', () => {
    expect(isNewerVersion('0.1.19', '0.1.19')).toBe(false)
    expect(isNewerVersion('v0.1.19', '0.1.19')).toBe(false)
  })

  it('accepts a v prefix and ignores prerelease suffixes', () => {
    expect(isNewerVersion('v0.2.0', '0.1.19')).toBe(true)
    expect(isNewerVersion('1.0.0-beta.1', '0.9.9')).toBe(true)
    expect(isNewerVersion('1.0.0-beta.1', '1.0.0')).toBe(false)
  })

  it('rejects malformed versions instead of guessing', () => {
    expect(isNewerVersion('abc', '0.1.0')).toBe(false)
    expect(isNewerVersion('0.1', '0.1.0')).toBe(false)
    expect(isNewerVersion('1.2.x', '1.2.0')).toBe(false)
    expect(isNewerVersion('', '0.1.0')).toBe(false)
  })

  it('uses the first three numeric parts', () => {
    expect(isNewerVersion('1.2.3.4', '1.2.3')).toBe(false)
    expect(isNewerVersion('1.2.4.0', '1.2.3')).toBe(true)
  })
})
