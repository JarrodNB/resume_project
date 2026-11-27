/** The candidate's transcription choice survives reload without leaking between accounts. */
import { act, renderHook } from '@testing-library/react'
import { beforeEach, expect, it } from 'vitest'
import { useTranscriptionPreference } from './useTranscriptionPreference'
beforeEach(() => localStorage.clear())
it('defaults to streaming and restores the owner-scoped saved choice', () => {
  const first = renderHook(() => useTranscriptionPreference('first'))
  expect(first.result.current[0]).toBe('streaming')
  act(() => first.result.current[1]('browser'))
  first.unmount()
  const restored = renderHook(() => useTranscriptionPreference('first'))
  expect(restored.result.current[0]).toBe('browser')
  const other = renderHook(() => useTranscriptionPreference('second'))
  expect(other.result.current[0]).toBe('streaming')
})
