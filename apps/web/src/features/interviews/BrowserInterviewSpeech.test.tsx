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

it('selects an available English voice and tunes a professional speaking delivery', () => {
  const english = { name: 'Google US English', lang: 'en-US', default: false }
  vi.stubGlobal('speechSynthesis', { speak, cancel, getVoices: () => [{ name: 'French', lang: 'fr-FR', default: true }, english] })
  render(<BrowserInterviewSpeech messageId="q" text="Question" />)
  fireEvent.click(screen.getByRole('button', { name: 'Play interviewer audio' }))
  expect(speak.mock.calls[0][0].voice).toBe(english)
  expect(speak.mock.calls[0][0].rate).toBe(1.02)
  expect(speak.mock.calls[0][0].pitch).toBe(0.95)
})

it('speaks sentence chunks in order without releasing recording between them', () => {
  const changed = vi.fn()
  render(<BrowserInterviewSpeech messageId="q" text="Describe your project. What did you learn?" onPlayingChange={changed} />)
  fireEvent.click(screen.getByRole('button', { name: 'Play interviewer audio' }))
  expect(speak.mock.calls[0][0].text).toBe('Describe your project.')
  const first = speak.mock.calls[0][0]
  act(() => first.onend())
  expect(speak.mock.calls[1][0].text).toBe('What did you learn?')
  expect(changed).toHaveBeenLastCalledWith(true, 'q')
  act(() => speak.mock.calls[1][0].onend())
  expect(changed).toHaveBeenLastCalledWith(false, 'q')
})

it('uses voices that load later, then keeps the same voice through the full reply', async () => {
  vi.useFakeTimers()
  try {
    let voices: unknown[] = []
    const events = new EventTarget()
    const engine = { speak, cancel, getVoices: () => voices, addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events) }
    vi.stubGlobal('speechSynthesis', engine)
    render(<BrowserInterviewSpeech messageId="q" text="First sentence. Second sentence." />)
    fireEvent.click(screen.getByRole('button', { name: 'Play interviewer audio' }))
    expect(speak).not.toHaveBeenCalled()
    const english = { name: 'Google US English', lang: 'en-US' }
    voices = [english]
    act(() => events.dispatchEvent(new Event('voiceschanged')))
    expect(speak.mock.calls[0][0].voice).toBe(english)
    voices = [{ name: 'Another', lang: 'en-GB' }]
    act(() => speak.mock.calls[0][0].onend())
    expect(speak.mock.calls[1][0].voice).toBe(english)
    await act(async () => vi.advanceTimersByTimeAsync(300))
    expect(speak).toHaveBeenCalledTimes(2)
  } finally { vi.useRealTimers() }
})

it('falls back to English after a bounded voice wait and cancels a wait on mute', async () => {
  vi.useFakeTimers()
  try {
    const events = new EventTarget()
    vi.stubGlobal('speechSynthesis', { speak, cancel, getVoices: () => [], addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events) })
    const props = { messageId: 'q', text: 'Question' }
    const view = render(<BrowserInterviewSpeech {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Play interviewer audio' }))
    view.rerender(<BrowserInterviewSpeech {...props} muted />)
    await act(async () => vi.advanceTimersByTimeAsync(300))
    expect(speak).not.toHaveBeenCalled()
    view.rerender(<BrowserInterviewSpeech {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Play interviewer audio' }))
    await act(async () => vi.advanceTimersByTimeAsync(300))
    expect(speak.mock.calls[0][0].lang).toBe('en-US')
    expect(speak.mock.calls[0][0].voice).toBeNull()
  } finally { vi.useRealTimers() }
})

it('does not advance cancelled or failed chunks, and replay starts at the beginning', () => {
  const props = { messageId: 'q', text: 'First sentence. Second sentence.' }
  const view = render(<BrowserInterviewSpeech {...props} />)
  fireEvent.click(screen.getByRole('button', { name: 'Play interviewer audio' }))
  const oldEnd = speak.mock.calls[0][0].onend
  fireEvent.click(screen.getByRole('button', { name: 'Stop interviewer audio' }))
  act(() => oldEnd())
  expect(speak).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: 'Replay question' }))
  expect(speak.mock.calls[1][0].text).toBe('First sentence.')
  act(() => speak.mock.calls[1][0].onerror())
  expect(speak).toHaveBeenCalledTimes(2)
  expect(screen.getByRole('alert')).toBeVisible()
  view.unmount()
})

it('ignores an old chunk error once the next chunk has started', () => {
  render(<BrowserInterviewSpeech messageId="q" text="First. Second." />)
  fireEvent.click(screen.getByRole('button', { name: 'Play interviewer audio' }))
  const first = speak.mock.calls[0][0]
  const lateError = first.onerror
  act(() => first.onend())
  act(() => lateError())
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Stop interviewer audio' })).toBeEnabled()
})

it('stops the sequence and releases recording if a started chunk never ends', async () => {
  vi.useFakeTimers()
  try {
    const changed = vi.fn()
    render(<BrowserInterviewSpeech messageId="q" text="First. Second." onPlayingChange={changed} />)
    fireEvent.click(screen.getByRole('button', { name: 'Play interviewer audio' }))
    act(() => speak.mock.calls[0][0].onstart())
    await act(async () => vi.advanceTimersByTimeAsync(15000))
    expect(changed).toHaveBeenLastCalledWith(false, 'q')
    expect(speak).toHaveBeenCalledTimes(1)
    expect(cancel).toHaveBeenCalled()
  } finally { vi.useRealTimers() }
})

it('releases recording if the browser cannot construct an utterance', () => {
  vi.stubGlobal('SpeechSynthesisUtterance', class { constructor() { throw new Error('Voice engine unavailable') } })
  const changed = vi.fn()
  render(<BrowserInterviewSpeech messageId="q" text="Question" onPlayingChange={changed} />)
  fireEvent.click(screen.getByRole('button', { name: 'Play interviewer audio' }))
  expect(changed).toHaveBeenLastCalledWith(false, 'q')
  expect(screen.getByRole('alert')).toBeVisible()
})

it('uses the English fallback if voice discovery throws', async () => {
  vi.useFakeTimers()
  try {
    vi.stubGlobal('speechSynthesis', { speak, cancel, getVoices: () => { throw new Error('Discovery unavailable') } })
    render(<BrowserInterviewSpeech messageId="q" text="Question" />)
    fireEvent.click(screen.getByRole('button', { name: 'Play interviewer audio' }))
    await act(async () => vi.advanceTimersByTimeAsync(300))
    expect(speak.mock.calls[0][0].lang).toBe('en-US')
    act(() => speak.mock.calls[0][0].onend())
    expect(screen.getByRole('button', { name: 'Play interviewer audio' })).toBeEnabled()
  } finally { vi.useRealTimers() }
})

it('cancels remaining sentences when microphone capture starts', () => {
  const props = { messageId: 'q', text: 'First. Second.' }
  const view = render(<BrowserInterviewSpeech {...props} />)
  fireEvent.click(screen.getByRole('button', { name: 'Play interviewer audio' }))
  const lateEnd = speak.mock.calls[0][0].onend
  view.rerender(<BrowserInterviewSpeech {...props} disabled />)
  act(() => lateEnd())
  expect(speak).toHaveBeenCalledTimes(1)
  expect(cancel).toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Play interviewer audio' })).toBeDisabled()
})
