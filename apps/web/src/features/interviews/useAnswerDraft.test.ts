/** Protect manual corrections as speech recognition revises and extends its transcript. */
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { useAnswerDraft } from './useAnswerDraft'

afterEach(cleanup)

it('keeps corrections when recognition revises earlier words before adding a new detail', () => {
  const { result } = renderHook(() => useAnswerDraft('question'))
  let ticket!: ReturnType<typeof result.current.beginCapture>
  act(() => { ticket = result.current.beginCapture() })
  act(() => result.current.previewCapture(ticket, 'I built tool'))
  act(() => result.current.editCapture('I designed a scheduling tool'))
  act(() => result.current.previewCapture(ticket, 'I built a tool for the team'))
  expect(result.current.text).toBe('I designed a scheduling tool for the team')
  act(() => result.current.editCapture(''))
  act(() => result.current.finishCapture(ticket, 'I built a tool for the team last year.'))
  expect(result.current.text).toBe('last year.')
})

it('keeps edits and ignores captures belonging to an earlier prompt', () => {
  const { result, rerender } = renderHook((context) => useAnswerDraft(context), { initialProps: 'first' })
  let ticket!: ReturnType<typeof result.current.beginCapture>
  act(() => { ticket = result.current.beginCapture() })
  act(() => result.current.previewCapture(ticket, 'First answer'))
  rerender('second')
  act(() => result.current.setText('Second answer'))
  act(() => result.current.previewCapture(ticket, 'Late words'))
  act(() => result.current.finishCapture(ticket, 'Late final words'))
  expect(result.current.text).toBe('Second answer')
})
