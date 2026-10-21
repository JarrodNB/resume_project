/** Browser voice playback never requests saved provider audio and releases recording on failure. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { BrowserInterviewSpeech } from './BrowserInterviewSpeech'

const speak = vi.fn()
const cancel = vi.fn()
beforeEach(() => {
  vi.stubGlobal('speechSynthesis', { speak, cancel })
  vi.stubGlobal('SpeechSynthesisUtterance', class { text: string; onend: (() => void) | null = null; onerror: (() => void) | null = null; constructor(text: string) { this.text = text } })
  vi.clearAllMocks()
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
it('speaks the exact saved text and releases recording when speech ends', () => {
  const changed = vi.fn()
  render(<BrowserInterviewSpeech messageId="q" text="Describe your project." onPlayingChange={changed} />)
  fireEvent.click(screen.getByRole('button', { name: 'Play interviewer audio' }))
  const utterance = speak.mock.calls[0][0]
  expect(utterance.text).toBe('Describe your project.')
  expect(changed).toHaveBeenLastCalledWith(true, 'q')
  act(() => utterance.onend())
  expect(changed).toHaveBeenLastCalledWith(false, 'q')
  expect(screen.getByRole('button', { name: 'Replay question' })).toBeEnabled()
})
it('stops on mute, recording, another speaker and unmount without accepting stale callbacks', () => {
  const changed = vi.fn()
  const props = { messageId: 'q', text: 'Question', onPlayingChange: changed }
  const view = render(<BrowserInterviewSpeech {...props} />)
  fireEvent.click(screen.getByRole('button', { name: 'Play interviewer audio' }))
  const utterance = speak.mock.calls[0][0]
  view.rerender(<BrowserInterviewSpeech {...props} muted />)
  expect(cancel).toHaveBeenCalled()
  expect(changed).toHaveBeenLastCalledWith(false, 'q')
  act(() => utterance.onend?.())
  expect(screen.getByRole('button', { name: 'Play interviewer audio' })).toBeDisabled()
  view.unmount()
})
it('offers manual recovery after an error and leaves unsupported speech usable as text', () => {
  const changed = vi.fn()
  const view = render(<BrowserInterviewSpeech messageId="q" text="Question" onPlayingChange={changed} />)
  fireEvent.click(screen.getByRole('button', { name: 'Play interviewer audio' }))
  act(() => speak.mock.calls[0][0].onerror())
  expect(changed).toHaveBeenLastCalledWith(false, 'q')
  expect(screen.getByRole('alert')).toHaveTextContent('Press Play')
  view.unmount()
  vi.stubGlobal('speechSynthesis', undefined)
  render(<BrowserInterviewSpeech messageId="q" text="Question" />)
  expect(screen.getByText(/Browser speech is unavailable/)).toBeVisible()
})
it('consumes automatic speech during recording without starting it later', async () => {
  const consume = vi.fn()
  const props = { messageId: 'q', text: 'Question', automatic: true, onAutomaticAttempt: consume }
  const view = render(<BrowserInterviewSpeech {...props} disabled />)
  await act(() => new Promise((resolve) => setTimeout(resolve, 5)))
  expect(consume).toHaveBeenCalledWith('q')
  view.rerender(<BrowserInterviewSpeech {...props} />)
  expect(speak).not.toHaveBeenCalled()
})

it('releases recording when the browser silently refuses to start', async () => {
  vi.useFakeTimers()
  try {
    const changed = vi.fn()
    render(<BrowserInterviewSpeech messageId="q" text="Question" onPlayingChange={changed} />)
    fireEvent.click(screen.getByRole('button', { name: 'Play interviewer audio' }))
    expect(changed).toHaveBeenLastCalledWith(true, 'q')
    await act(async () => vi.advanceTimersByTimeAsync(5000))
    expect(changed).toHaveBeenLastCalledWith(false, 'q')
    expect(cancel).toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('Press Play')
  } finally { vi.useRealTimers() }
})

it('does not cancel the new player when the previous player releases the shared queue', () => {
  const first = render(<BrowserInterviewSpeech messageId="first" text="First" />)
  const second = render(<BrowserInterviewSpeech messageId="second" text="Second" />)
  fireEvent.click(within(first.container).getByRole('button', { name: 'Play interviewer audio' }))
  fireEvent.click(within(second.container).getByRole('button', { name: 'Play interviewer audio' }))
  const cancellations = cancel.mock.calls.length
  first.rerender(<BrowserInterviewSpeech messageId="first" text="First" otherSpeechPlaying />)
  expect(cancel).toHaveBeenCalledTimes(cancellations)
  expect(within(second.container).getByRole('button', { name: 'Stop interviewer audio' })).toBeEnabled()
})
