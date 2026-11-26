/** Check that remembered microphone choices load safely and keep hands-free and automatic capture consistent. */
import { act, renderHook } from '@testing-library/react'
import { beforeEach, expect, it } from 'vitest'
import { useInterviewMicSettings } from './useInterviewMicSettings'

const key = 'Careerdrafter:interview-microphone:owner'
const saved = () => JSON.parse(localStorage.getItem(key) ?? 'null')
beforeEach(() => localStorage.clear())

it('loads older saved settings with hands-free off and the normal silence length', () => {
  localStorage.setItem(key, JSON.stringify({ automatic: true, seconds: 3 }))
  const { result } = renderHook(() => useInterviewMicSettings('owner'))
  expect(result.current).toMatchObject({ automatic: true, seconds: 3, handsFree: false, silenceSeconds: 2.5 })
})

it('turns on automatic capture with hands-free and turns hands-free off with automatic capture', () => {
  const { result, unmount } = renderHook(() => useInterviewMicSettings('owner'))
  expect(result.current).toMatchObject({ automatic: false, handsFree: false })
  act(() => result.current.update({ handsFree: true }))
  expect(result.current).toMatchObject({ automatic: true, handsFree: true })
  expect(saved()).toMatchObject({ automatic: true, handsFree: true, silenceSeconds: 2.5 })
  unmount()
  const reloaded = renderHook(() => useInterviewMicSettings('owner'))
  expect(reloaded.result.current).toMatchObject({ automatic: true, handsFree: true })
  act(() => reloaded.result.current.update({ automatic: false }))
  expect(reloaded.result.current).toMatchObject({ automatic: false, handsFree: false })
  expect(saved()).toMatchObject({ automatic: false, handsFree: false })
})
