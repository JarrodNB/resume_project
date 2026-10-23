/** Check that automatic capture waits for quiet, respects authored answers, and starts once. */
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useAutomaticMicrophone } from './useAutomaticMicrophone'

afterEach(() => { cleanup(); vi.useRealTimers() })
const options = { promptId: 'question', enabled: true, seconds: 5, paused: false, answered: false }

it('waits through playback, counts thinking time, and opens only once', () => {
  vi.useFakeTimers()
  const start = vi.fn()
  const { result, rerender } = renderHook((props) => useAutomaticMicrophone({ ...props, start }), { initialProps: { ...options, paused: true } })
  act(() => vi.advanceTimersByTime(10_000))
  expect(start).not.toHaveBeenCalled()
  rerender(options)
  act(() => vi.advanceTimersByTime(400))
  expect(result.current).toBe(5)
  act(() => vi.advanceTimersByTime(4_000))
  expect(result.current).toBe(1)
  expect(start).not.toHaveBeenCalled()
  act(() => vi.advanceTimersByTime(1_000))
  expect(start).toHaveBeenCalledOnce()
  rerender({ ...options, paused: true })
  rerender(options)
  act(() => vi.advanceTimersByTime(10_000))
  expect(start).toHaveBeenCalledOnce()
  rerender({ ...options, promptId: 'follow-up' })
  act(() => vi.advanceTimersByTime(5_400))
  expect(start).toHaveBeenCalledTimes(2)
})

it.each(['typing', 'manual capture'])('cancels automatic capture after %s, including after a draft is cleared', () => {
  vi.useFakeTimers()
  const start = vi.fn()
  const { rerender } = renderHook((props) => useAutomaticMicrophone({ ...props, start }), { initialProps: options })
  act(() => vi.advanceTimersByTime(2_400))
  rerender({ ...options, answered: true })
  rerender(options)
  act(() => vi.advanceTimersByTime(10_000))
  expect(start).not.toHaveBeenCalled()
})

it('cancels on disabled settings, a hidden page, or unmount', () => {
  vi.useFakeTimers()
  const start = vi.fn()
  const { rerender, unmount } = renderHook((props) => useAutomaticMicrophone({ ...props, start }), { initialProps: options })
  act(() => vi.advanceTimersByTime(1_400))
  rerender({ ...options, enabled: false })
  act(() => vi.advanceTimersByTime(10_000))
  expect(start).not.toHaveBeenCalled()
  rerender({ ...options, paused: true })
  act(() => vi.advanceTimersByTime(10_000))
  expect(start).not.toHaveBeenCalled()
  rerender(options)
  unmount()
  act(() => vi.advanceTimersByTime(10_000))
  expect(start).not.toHaveBeenCalled()
})

it('does not treat the previous recording as an answer to a newly saved prompt', () => {
  vi.useFakeTimers()
  const start = vi.fn()
  const { rerender } = renderHook((props) => useAutomaticMicrophone({ ...props, start }), { initialProps: { ...options, answered: true } })
  rerender({ ...options, promptId: 'next-question', answered: true })
  rerender({ ...options, promptId: 'next-question', answered: false })
  act(() => vi.advanceTimersByTime(5_400))
  expect(start).toHaveBeenCalledOnce()
})
