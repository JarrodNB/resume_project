/**
 * Description: Tests that the color theme still works when browser storage is blocked.
 */
import { afterEach, expect, it, vi } from 'vitest'
import { applyColorTheme, preferredColorTheme } from './colorTheme'

afterEach(() => {
  vi.restoreAllMocks()
  document.documentElement.classList.remove('dark')
})

it('falls back to the system preference when storage cannot be read', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
  expect(['light', 'dark']).toContain(preferredColorTheme())
})

it('still applies a theme when storage cannot be written', () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
  expect(() => applyColorTheme('dark', { remember: true })).not.toThrow()
  expect(document.documentElement.classList.contains('dark')).toBe(true)
})
