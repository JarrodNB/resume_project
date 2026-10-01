/**
 * Description: Vitest setup: jest-dom matchers, a ResizeObserver stub (jsdom lacks it; Radix
 * components need it), DOM cleanup, and a fresh localStorage per test.
 */
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

afterEach(() => {
  cleanup()
  localStorage.clear()
})
