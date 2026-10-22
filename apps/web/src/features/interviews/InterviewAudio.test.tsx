/** Saved speech playback covers blocked autoplay, stale grants and local media recovery.
 * Requests exercise the real owned GraphQL operation; media methods are the external seam.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MockedProvider } from '@apollo/client/testing/react'
import { MockLink } from '@apollo/client/testing'
import { ApolloLink } from '@apollo/client'
import { Observable } from 'rxjs'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { InterviewAudio } from './InterviewAudio'
import { StrictMode } from 'react'
import { INTERVIEW_PLAYBACK } from './interviewOperations'

const grant = (url: string) => ({ data: { interviewPlayback: { __typename: 'InterviewPlaybackPayload', errors: [], playback: { __typename: 'InterviewPlayback', playbackUrl: url, expiresIn: 60, contentType: 'audio/wav' } } } })
function mock(url = 'https://storage.test/first', extra = {}) {
  return { request: { query: INTERVIEW_PLAYBACK, variables: { input: { interviewId: 'session', messageId: 'message' } } }, result: grant(url), ...extra }
}
function mount(mocks: MockLink.MockedResponse[], props = {}) {
  return render(<InterviewAudio interviewId="session" messageId="message" {...props} />, { wrapper: ({ children }) => <MockedProvider mocks={mocks}>{children}</MockedProvider> })
}
beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('renews an expired playback grant for the same saved message', async () => {
  mount([mock(), mock('https://storage.test/renewed')])
  await userEvent.click(screen.getByRole('button', { name: 'Play interviewer audio' }))
  await screen.findByRole('button', { name: 'Pause interviewer audio' })
  expect(screen.getByLabelText('Saved interviewer speech')).toHaveAttribute('src', 'https://storage.test/first')
  fireEvent.error(screen.getByLabelText('Saved interviewer speech'))
  expect(screen.getByRole('alert')).toHaveTextContent('may have expired')
  await userEvent.click(screen.getByRole('button', { name: 'Play interviewer audio' }))
  await screen.findByRole('button', { name: 'Pause interviewer audio' })
  expect(screen.getByLabelText('Saved interviewer speech')).toHaveAttribute('src', 'https://storage.test/renewed')
})

it('offers manual Play after blocked autoplay and reuses the grant for replay', async () => {
  vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(new DOMException('Blocked', 'NotAllowedError'))
  const result = vi.fn(() => grant('https://storage.test/first'))
  mount([mock(undefined, { result })], { automatic: true })
  await screen.findByRole('alert')
  expect(screen.getByRole('button', { name: 'Play interviewer audio' })).toBeEnabled()
  await userEvent.click(screen.getByRole('button', { name: 'Play interviewer audio' }))
  await screen.findByRole('button', { name: 'Pause interviewer audio' })
  fireEvent.ended(screen.getByLabelText('Saved interviewer speech'))
  await userEvent.click(screen.getByRole('button', { name: 'Replay interviewer audio' }))
  expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(3)
  expect(result).toHaveBeenCalledOnce()
})

it('pauses when muted and requires deliberate playback after unmuting', async () => {
  const view = mount([mock()], { automatic: true })
  await screen.findByRole('button', { name: 'Pause interviewer audio' })
  view.rerender(<InterviewAudio interviewId="session" messageId="message" automatic muted />)
  expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Play interviewer audio' })).toBeDisabled()
  view.rerender(<InterviewAudio interviewId="session" messageId="message" automatic />)
  expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce()
  expect(screen.getByRole('button', { name: 'Play interviewer audio' })).toBeEnabled()
})

it.each(['message change', 'recording', 'unmount'])('discards a late signed grant after %s', async (change) => {
  const result = vi.fn(() => grant('https://storage.test/late'))
  let release!: () => void
  // Keep the actual request behind a gate, rather than racing a 30ms response.
  // MockLink still validates the owned operation and variables when released.
  const gate = new ApolloLink((operation, forward) => new Observable((observer) => {
    let subscription: { unsubscribe: () => void } | undefined
    release = () => { subscription = forward(operation).subscribe(observer) }
    return () => subscription?.unsubscribe()
  }))
  const link = gate.concat(new MockLink([mock(undefined, { delay: 0, result })]))
  const view = render(<InterviewAudio interviewId="session" messageId="message" automatic />, {
    wrapper: ({ children }) => <MockedProvider link={link}>{children}</MockedProvider>,
  })
  expect(await screen.findByRole('button', { name: 'Loading audio…' })).toBeDisabled()
  if (change === 'message change') view.rerender(<InterviewAudio interviewId="session" messageId="new" />)
  else if (change === 'recording') view.rerender(<InterviewAudio interviewId="session" messageId="message" automatic disabled />)
  else view.rerender(<></>)
  await act(async () => release())
  await waitFor(() => expect(result).toHaveBeenCalledOnce())
  expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled()
  if (change !== 'unmount') expect(screen.getByLabelText('Saved interviewer speech')).not.toHaveAttribute('src')
})

it('pauses active playback on unmount and ignores a late play completion', async () => {
  let resolve!: () => void
  vi.mocked(HTMLMediaElement.prototype.play).mockImplementation(() => new Promise<void>((done) => { resolve = done }))
  const onPlayingChange = vi.fn()
  const view = mount([mock()], { automatic: true, onPlayingChange })
  await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce())
  view.unmount()
  await act(async () => resolve())
  expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled()
  expect(onPlayingChange).not.toHaveBeenCalledWith(true, 'message')
})

it('autoplays once under StrictMode without losing or duplicating the grant', async () => {
  const result = vi.fn(() => grant('https://storage.test/first'))
  render(<StrictMode><InterviewAudio interviewId="session" messageId="message" automatic /></StrictMode>, {
    wrapper: ({ children }) => <MockedProvider mocks={[mock(undefined, { result })]}>{children}</MockedProvider>,
  })
  await screen.findByRole('button', { name: 'Pause interviewer audio' })
  expect(result).toHaveBeenCalledOnce()
  expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce()
})

it('does not let a stale play promise pause a newer resumed play', async () => {
  mount([mock()], { automatic: true })
  await screen.findByRole('button', { name: 'Pause interviewer audio' })
  await userEvent.click(screen.getByRole('button', { name: 'Pause interviewer audio' }))
  let resolve!: () => void
  vi.mocked(HTMLMediaElement.prototype.play).mockImplementationOnce(() => new Promise<void>((done) => { resolve = done }))
  await userEvent.click(screen.getByRole('button', { name: 'Play interviewer audio' }))
  await userEvent.click(screen.getByRole('button', { name: 'Play interviewer audio' }))
  const pauses = vi.mocked(HTMLMediaElement.prototype.pause).mock.calls.length
  await act(async () => resolve())
  expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledTimes(pauses)
  expect(screen.getByRole('button', { name: 'Pause interviewer audio' })).toBeEnabled()
})

it('uses one playback control to pause, resume and replay a finished saved turn', async () => {
  const result = vi.fn(() => grant('https://storage.test/first'))
  mount([mock(undefined, { result })], { automatic: true })
  await screen.findByRole('button', { name: 'Pause interviewer audio' })
  expect(screen.getAllByRole('button')).toHaveLength(1)
  const element = screen.getByLabelText('Saved interviewer speech') as HTMLAudioElement
  element.currentTime = 8
  await userEvent.click(screen.getByRole('button', { name: 'Pause interviewer audio' }))
  await userEvent.click(screen.getByRole('button', { name: 'Play interviewer audio' }))
  await screen.findByRole('button', { name: 'Pause interviewer audio' })
  expect(element.currentTime).toBe(8)
  fireEvent.ended(element)
  await userEvent.click(screen.getByRole('button', { name: 'Replay interviewer audio' }))
  await screen.findByRole('button', { name: 'Pause interviewer audio' })
  expect(element.currentTime).toBe(0)
  expect(screen.getAllByRole('button')).toHaveLength(1)
  expect(result).toHaveBeenCalledOnce()
})

it('keeps a deliberate pause when an earlier play promise finishes later', async () => {
  let finish!: () => void
  vi.mocked(HTMLMediaElement.prototype.play).mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve }))
  mount([mock()], { automatic: true })
  await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce())
  fireEvent.play(screen.getByLabelText('Saved interviewer speech'))
  await userEvent.click(screen.getByRole('button', { name: 'Pause interviewer audio' }))
  await act(async () => finish())
  expect(screen.getByRole('button', { name: 'Play interviewer audio' })).toBeEnabled()
  expect(screen.queryByRole('button', { name: 'Pause interviewer audio' })).not.toBeInTheDocument()
})
