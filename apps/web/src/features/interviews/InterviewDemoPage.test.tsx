/** The spoken demo presents saved state and keeps turn recovery separate from speech replay. */
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MockedProvider } from '@apollo/client/testing/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import type { MockLink } from '@apollo/client/testing'
import { act, render, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderPage } from '@/test/renderPage'
import { InterviewDemoPage } from './InterviewDemoPage'
import { INTERVIEW_PLAYBACK } from './interviewOperations'
const { state, recorder, start } = vi.hoisted(() => ({
  state: { interview: null as unknown, loading: false, loadError: null as unknown, subscriptionError: null, busy: false, error: null, unresolved: null as unknown, transcribeRecording: vi.fn(), cancelTranscription: vi.fn(), answer: vi.fn(), answerText: vi.fn(), checkSavedStatus: vi.fn(), retryOperation: vi.fn(), beginInterview: vi.fn(), abandonInterview: vi.fn() },
  recorder: { candidateTranscript: null as string | null, transcript: '', effectiveMode: 'browser', fallbackReason: null as string | null, status: 'idle', recording: null as Blob | null, error: null, start: vi.fn(), stop: vi.fn(), reset: vi.fn(), refresh: (() => {}) as () => void },
  start: vi.fn(),
}))
vi.mock('./useInterviewSession', () => ({ useInterviewSession: () => state, useStartInterview: () => ({ start, loading: false, error: null }) }))
vi.mock('./useInterviewRecorder', async () => {
  const { useState } = await import('react')
  return { useInterviewRecorder: () => { const [, setTick] = useState(0); recorder.refresh = () => setTick((value) => value + 1); return recorder } }
})
vi.mock('./RecentInterviews', () => ({ RecentInterviews: () => <p>Recent saved interviews</p> }))
vi.mock('@/features/auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'owner' } }) }))
const snapshot = {
  id: 'session', status: 'active', interviewType: 'basic', executionMode: 'real', speechPlaybackMode: 'provider', revision: 0, answerCap: 2, currentQuestionPosition: 1, expiresAt: '2026-10-27',
  questions: [{ id: 'question', content: 'Describe a project.', position: 1, acceptedAnswerCount: 0 }],
  messages: [{ id: 'opening', questionId: 'question', kind: 'opening', position: 1, content: 'Describe a project.' }],
  operations: [{ id: 'speech', questionId: 'question', messageId: 'opening', kind: 'speech', status: 'accepted', failureCode: null, checkpoint: null, submissionKey: null, canRetry: true }],
}
function renderDemo(url = '/interviews/demo/session', mocks: MockLink.MockedResponse[] = []) { return renderPage({ path: '/interviews/demo/:id?', url, mocks, element: <InterviewDemoPage />, extraRoutes: [{ path: '/interview-prep', element: <p>Written practice</p> }] }) }
function playbackMock(messageId = 'opening') {
  return { delay: 0, request: { query: INTERVIEW_PLAYBACK, variables: { input: { interviewId: 'session', messageId } } }, result: { data: {
    interviewPlayback: { __typename: 'InterviewPlaybackPayload', errors: [], playback: { __typename: 'InterviewPlayback', playbackUrl: 'https://storage.test/speech', expiresIn: 60, contentType: 'audio/wav' } },
  } } }
}
beforeEach(() => { localStorage.clear(); recorder.candidateTranscript = null; recorder.transcript = ''; recorder.effectiveMode = 'browser'; recorder.fallbackReason = null; vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:preview'), revokeObjectURL: vi.fn() })); vi.stubEnv('VITE_INTERVIEW_DEMO_ENABLED', 'true'); state.interview = structuredClone(snapshot); state.busy = false; state.error = null; state.unresolved = null; state.loadError = null; recorder.status = 'idle'; recorder.recording = null; recorder.error = null; vi.clearAllMocks(); vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(); vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {}); state.answer.mockResolvedValue(true); state.transcribeRecording.mockResolvedValue('capture'); state.cancelTranscription.mockResolvedValue(true) })
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
describe('InterviewDemoPage', () => {
  it.each([true, false])('shows submission loading before resolving the request (saved=%s)', async (saved) => {
    let finish!: (saved: boolean) => void
    state.answerText.mockImplementation(() => {
      state.busy = true
      state.unresolved = { submissionKey: 'in-flight' }
      recorder.refresh()
      return new Promise<boolean>((resolve) => { finish = resolve })
    })
    recorder.status = 'ready'
    recorder.recording = new Blob(['answer'], { type: 'audio/webm' })
    renderDemo()
    fireEvent.change(screen.getByRole('textbox', { name: 'Your answer' }), { target: { value: 'My reviewed answer.' } })
    const submit = screen.getByRole('button', { name: 'Submit answer' })
    fireEvent.click(submit)
    fireEvent.click(submit)
    expect(screen.getByRole('heading', { name: 'Saving changes' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Submitting answer…' })).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('button', { name: 'Submitting answer…' })).toBeDisabled()
    expect(screen.queryByText(/submission response was not confirmed/)).not.toBeInTheDocument()
    expect(state.answerText).toHaveBeenCalledOnce()
    await act(async () => {
      state.busy = false
      if (saved) {
        state.unresolved = null
        state.interview = { ...snapshot, operations: [...snapshot.operations, { id: 'turn', kind: 'turn', status: 'running' }] }
      }
      finish(saved)
      recorder.refresh()
    })
    expect(screen.getByRole('heading', { name: saved ? 'Your interviewer is thinking' : 'Check your submission' })).toBeVisible()
    if (!saved) expect(screen.getByRole('alert')).toHaveTextContent('submission response was not confirmed')
  })

  it('keeps the main question visible once while identifying the latest follow-up', () => {
    state.interview = { ...snapshot, messages: [
      snapshot.messages[0],
      { ...snapshot.messages[0], id: 'answer', kind: 'answer', content: 'I built a booking tool.' },
      { ...snapshot.messages[0], id: 'follow-up', kind: 'follow_up', content: 'How did you test it?' },
    ] }
    renderDemo()
    const current = within(screen.getByRole('region', { name: 'Current interview turn' }))
    expect(current.getByText('Describe a project.')).toBeVisible()
    expect(current.getByRole('heading', { name: 'Follow-up' })).toBeVisible()
    expect(current.getByText('How did you test it?')).toBeVisible()
    expect(screen.getAllByText('Describe a project.')).toHaveLength(1)
    expect(screen.getByText('I built a booking tool.')).toBeVisible()
  })

  it('uses the newly active question and keeps a previous prompt out of its current turn', () => {
    state.interview = { ...snapshot, currentQuestionPosition: 2,
      questions: [...snapshot.questions, { ...snapshot.questions[0], id: 'next-question', position: 2, content: 'How do you review code?' }],
    }
    renderDemo()
    const current = within(screen.getByRole('region', { name: 'Current interview turn' }))
    expect(current.getByText('How do you review code?')).toBeVisible()
    expect(current.queryByText('Describe a project.')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Waiting for your question' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Record answer' })).toBeDisabled()
  })

  it('shows the saved closing without labelling it a follow-up after completion', () => {
    state.interview = { ...snapshot, status: 'completed', messages: [
      ...snapshot.messages, { ...snapshot.messages[0], id: 'closing', kind: 'closing', content: 'Thank you. This interview is complete.' },
    ] }
    renderDemo()
    const current = within(screen.getByRole('region', { name: 'Current interview turn' }))
    expect(current.getByText('Thank you. This interview is complete.')).toBeVisible()
    expect(current.queryByText('Describe a project.')).not.toBeInTheDocument()
    expect(current.queryByRole('heading', { name: 'Follow-up' })).not.toBeInTheDocument()
  })

  it('shows the saved acknowledgement separately and speaks the whole accepted interviewer turn', async () => {
    const speak = vi.fn()
    vi.stubGlobal('speechSynthesis', { speak, cancel: vi.fn() })
    vi.stubGlobal('SpeechSynthesisUtterance', class { text: string; constructor(text: string) { this.text = text } })
    const acknowledgement = 'You rebuilt the scheduler with a teammate.'
    const message = { ...snapshot.messages[0], acknowledgement, spokenContent: `${acknowledgement}\n\n${snapshot.messages[0].content}` }
    state.interview = { ...snapshot, speechPlaybackMode: 'browser', operations: [], messages: [message] }
    renderDemo()
    const room = within(screen.getByRole('region', { name: 'Current interview turn' }))
    expect(room.getByText(acknowledgement)).toBeVisible()
    expect(room.getByText(message.content)).toBeVisible()
    await userEvent.click(room.getByRole('button', { name: 'Play interviewer audio' }))
    expect(speak.mock.calls[0][0].text).toBe(acknowledgement)
    act(() => speak.mock.calls[0][0].onend())
    expect(speak.mock.calls.map(([utterance]) => utterance.text).join('\n\n')).toBe(message.spokenContent)
  })

  it('reads saved text with browser speech without a provider artifact and releases recording', async () => {
    const speak = vi.fn()
    vi.stubGlobal('speechSynthesis', { speak, cancel: vi.fn() })
    vi.stubGlobal('SpeechSynthesisUtterance', class { text: string; constructor(text: string) { this.text = text } })
    state.interview = { ...snapshot, speechPlaybackMode: 'browser', operations: [] }
    renderDemo()
    await userEvent.click(within(screen.getByRole('region', { name: 'Current interview turn' })).getByRole('button', { name: 'Play interviewer audio' }))
    expect(speak.mock.calls[0][0].text).toBe('Describe a project.')
    expect(screen.getByRole('button', { name: 'Record answer' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Stop interviewer audio' }))
    expect(screen.getByRole('button', { name: 'Record answer' })).toBeEnabled()
    state.interview = { ...snapshot, speechPlaybackMode: 'browser', revision: 1, operations: [], messages: [...snapshot.messages, { ...snapshot.messages[0], id: 'followup', content: 'What changed?' }] }
    act(() => recorder.refresh())
    await waitFor(() => expect(speak).toHaveBeenCalledTimes(2))
    expect(speak.mock.calls[1][0].text).toBe('What changed?')
  })

  it.each(['pending', 'failed', 'expired'])('allows a saved question to be answered when speech is %s', async (status) => {
    state.interview = { ...snapshot, operations: [{ ...snapshot.operations[0], status, failureCode: status === 'pending' ? null : 'speech_failed' }] }
    renderDemo()
    expect(screen.getByText('Describe a project.')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Record answer' }))
    expect(recorder.start).toHaveBeenCalledOnce()
    const recording = new Blob(['answer'], { type: 'audio/webm' })
    recorder.status = 'ready'; recorder.recording = recording
    act(() => recorder.refresh())
    expect(screen.getByRole('button', { name: 'Transcribe recording' })).toBeEnabled()
    await userEvent.click(screen.getByRole('button', { name: 'Transcribe recording' }))
    expect(state.transcribeRecording).toHaveBeenCalledWith(recording)
  })
  it('leaves hydrated speech and earlier conversation silent until explicitly played', async () => {
    renderDemo('/interviews/demo/session', [playbackMock()])
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled()
    await userEvent.click(within(screen.getByRole('region', { name: 'Current interview turn' })).getByRole('button', { name: 'Play interviewer audio' }))
    await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce())
    expect(screen.getByRole('button', { name: 'Record answer' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Pause interviewer audio' }))
    expect(screen.getByRole('button', { name: 'Record answer' })).toBeEnabled()
  })
  it('automatically plays speech accepted after waiting, without replaying hydrated speech', async () => {
    state.interview = { ...snapshot, operations: [{ ...snapshot.operations[0], status: 'pending' }] }
    renderDemo('/interviews/demo/session', [playbackMock()])
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled()
    state.interview = { ...snapshot, revision: 1 }
    act(() => recorder.refresh())
    await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce())
    act(() => recorder.refresh())
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce()
    expect(recorder.start).not.toHaveBeenCalled()
  })
  it('autoplays a new reply but never its repeated or stale receipt', async () => {
    renderDemo('/interviews/demo/session', [playbackMock('reply')])
    const next = { ...snapshot, revision: 2, messages: [...snapshot.messages, { ...snapshot.messages[0], id: 'reply', content: 'What changed?' }], operations: [...snapshot.operations, { ...snapshot.operations[0], id: 'next-speech', messageId: 'reply' }] }
    state.interview = next
    act(() => recorder.refresh())
    await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce())
    state.interview = { ...next }
    act(() => recorder.refresh())
    state.interview = snapshot
    act(() => recorder.refresh())
    state.interview = { ...next }
    act(() => recorder.refresh())
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce()
  })
  it('keeps new speech eligible when a duplicate receipt arrives before autoplay dispatch', async () => {
    vi.useFakeTimers()
    try {
      state.interview = { ...snapshot, operations: [{ ...snapshot.operations[0], status: 'pending' }] }
      renderDemo('/interviews/demo/session', [playbackMock()])
      state.interview = { ...snapshot, revision: 1 }
      act(() => recorder.refresh())
      state.interview = { ...snapshot, revision: 1 }
      act(() => recorder.refresh())
      expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled()
      await act(async () => vi.runAllTimersAsync())
      expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce()
      expect(screen.getByRole('button', { name: 'Pause interviewer audio' })).toBeEnabled()
    } finally { vi.useRealTimers() }
  })
  it('does not automatically play a new reply accepted while microphone capture is active', async () => {
    recorder.status = 'recording'
    renderDemo()
    state.interview = { ...snapshot, revision: 1, messages: [...snapshot.messages, { ...snapshot.messages[0], id: 'reply', content: 'What changed?' }], operations: [...snapshot.operations, { ...snapshot.operations[0], id: 'next-speech', messageId: 'reply' }] }
    act(() => recorder.refresh())
    expect(within(screen.getByRole('region', { name: 'Current interview turn' })).getByRole('button', { name: 'Play interviewer audio' })).toBeDisabled()
    recorder.status = 'idle'
    act(() => recorder.refresh())
    expect(within(screen.getByRole('region', { name: 'Current interview turn' })).getByRole('button', { name: 'Play interviewer audio' })).toBeEnabled()
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled()
  })
  it('keeps late speech silent when answering began before its audio was ready', async () => {
    vi.useFakeTimers()
    try {
      state.interview = { ...snapshot, operations: [{ ...snapshot.operations[0], status: 'pending' }] }
      renderDemo()
      expect(screen.getByRole('button', { name: 'Record answer' })).toBeEnabled()
      recorder.status = 'recording'
      act(() => recorder.refresh())
      state.interview = { ...snapshot, revision: 1 }
      act(() => recorder.refresh())
      await act(async () => vi.runAllTimersAsync())
      expect(within(screen.getByRole('region', { name: 'Current interview turn' })).getByRole('button', { name: 'Play interviewer audio' })).toBeDisabled()
      recorder.status = 'idle'
      act(() => recorder.refresh())
      await act(async () => vi.runAllTimersAsync())
      expect(within(screen.getByRole('region', { name: 'Current interview turn' })).getByRole('button', { name: 'Play interviewer audio' })).toBeEnabled()
      expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled()
    } finally { vi.useRealTimers() }
  })
  it('keeps the session muted across replies and stops speech when abandoned', async () => {
    renderDemo('/interviews/demo/session', [playbackMock('reply')])
    await userEvent.click(screen.getByRole('button', { name: 'Mute interviewer' }))
    state.interview = { ...snapshot, revision: 1, messages: [...snapshot.messages, { ...snapshot.messages[0], id: 'reply', content: 'What changed?' }], operations: [...snapshot.operations, { ...snapshot.operations[0], id: 'next-speech', messageId: 'reply' }] }
    act(() => recorder.refresh())
    expect(screen.getByRole('button', { name: 'Unmute interviewer' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(screen.getByRole('region', { name: 'Current interview turn' })).getByRole('button', { name: 'Play interviewer audio' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Unmute interviewer' }))
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled()
    await userEvent.click(within(screen.getByRole('region', { name: 'Current interview turn' })).getByRole('button', { name: 'Play interviewer audio' }))
    await within(screen.getByRole('region', { name: 'Current interview turn' })).findByRole('button', { name: 'Pause interviewer audio' })
    const pauses = vi.mocked(HTMLMediaElement.prototype.pause).mock.calls.length
    state.interview = { ...snapshot, status: 'abandoned', revision: 2 }
    act(() => recorder.refresh())
    expect(vi.mocked(HTMLMediaElement.prototype.pause).mock.calls.length).toBeGreaterThan(pauses)
    expect(screen.queryByRole('button', { name: 'Play interviewer audio' })).not.toBeInTheDocument()
  })
  it('pauses current speech when an earlier exchange is played and keeps recording blocked', async () => {
    state.interview = { ...snapshot, messages: [{ ...snapshot.messages[0], id: 'earlier', content: 'Earlier question' }, ...snapshot.messages], operations: [...snapshot.operations, { ...snapshot.operations[0], id: 'earlier-speech', messageId: 'earlier' }] }
    renderDemo('/interviews/demo/session', [playbackMock(), playbackMock('earlier')])
    const current = within(screen.getByRole('region', { name: 'Current interview turn' }))
    await userEvent.click(current.getByRole('button', { name: 'Play interviewer audio' }))
    await current.findByRole('button', { name: 'Pause interviewer audio' })
    const earlier = within(screen.getByText('Earlier question').closest('li')!)
    await userEvent.click(earlier.getByRole('button', { name: 'Play interviewer audio' }))
    await earlier.findByRole('button', { name: 'Pause interviewer audio' })
    expect(await current.findByRole('button', { name: 'Play interviewer audio' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Record answer' })).toBeDisabled()
    await userEvent.click(earlier.getByRole('button', { name: 'Pause interviewer audio' }))
    expect(screen.getByRole('button', { name: 'Record answer' })).toBeEnabled()
  })
  it('focuses the current turn once while keeping earlier dialogue available', async () => {
    state.interview = { ...snapshot, messages: [
      { ...snapshot.messages[0], id: 'earlier', content: 'What did you build?' },
      { ...snapshot.messages[0], id: 'answer', kind: 'answer', content: 'I built a booking tool.' },
      snapshot.messages[0],
    ] }
    renderDemo()
    expect(screen.getByRole('heading', { name: 'Your turn' })).toBeVisible()
    expect(screen.getByRole('region', { name: 'Current interview turn' })).toHaveTextContent('Describe a project.')
    expect(screen.getByText('What did you build?')).toBeVisible()
    expect(screen.getByText('I built a booking tool.')).toBeVisible()
    expect(screen.getAllByText('Describe a project.')).toHaveLength(1)
  })
  it.each([
    ['recording', 'Your turn — recording'],
    ['requesting', 'Allow microphone access'],
    ['ready', 'Review your recording'],
  ])('makes the next action clear while the recorder is %s', (status, title) => {
    recorder.status = status
    if (status === 'ready') recorder.recording = new Blob(['answer'])
    renderDemo()
    expect(screen.getByRole('heading', { name: title })).toBeVisible()
  })
  it('shows understandable processing rather than internal checkpoint names', () => {
    state.interview = { ...snapshot, operations: [...snapshot.operations, { id: 'turn', kind: 'turn', status: 'running', checkpoint: 'transcription_saved' }] }
    renderDemo()
    expect(screen.getByRole('heading', { name: 'Your interviewer is thinking' })).toBeVisible()
    expect(screen.getByText(/You can reload safely/)).toBeVisible()
    expect(screen.queryByText(/transcription_saved/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Record answer' })).toBeDisabled()
  })
  it('releases microphone capture when the saved interview is abandoned elsewhere', () => {
    recorder.status = 'recording'
    renderDemo()
    state.interview = { ...snapshot, status: 'abandoned' }
    act(() => recorder.refresh())
    expect(recorder.reset).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: 'Record answer' })).not.toBeInTheDocument()
  })
  it('clearly ends an expired interview without offering recording or retries', () => {
    state.interview = { ...snapshot, status: 'expired', operations: [{ ...snapshot.operations[0], status: 'expired', canRetry: true }] }
    renderDemo()
    expect(screen.getByRole('heading', { name: 'Interview expired' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Record answer' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry speech' })).not.toBeInTheDocument()
  })
  it('requires explicit confirmation and preserves the recording when cancellation or abandonment fails', async () => {
    recorder.recording = new Blob(['answer'], { type: 'audio/webm' }); recorder.status = 'ready'
    renderDemo()
    await userEvent.click(screen.getByRole('button', { name: 'Abandon interview' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('Your unsubmitted recording will be discarded')
    await userEvent.click(screen.getByRole('button', { name: 'Keep interview' }))
    expect(state.abandonInterview).not.toHaveBeenCalled()
    expect(recorder.reset).not.toHaveBeenCalled()
    state.abandonInterview.mockResolvedValue(false)
    await userEvent.click(screen.getByRole('button', { name: 'Abandon interview' }))
    await userEvent.click(screen.getByRole('button', { name: 'Confirm abandonment' }))
    expect(state.abandonInterview).toHaveBeenCalledOnce()
    expect(recorder.reset).not.toHaveBeenCalled()
    state.abandonInterview.mockResolvedValue(true)
    await userEvent.click(screen.getByRole('button', { name: 'Confirm abandonment' }))
    await waitFor(() => expect(recorder.reset).toHaveBeenCalledOnce())
  })
  it.each(['preparing', 'ready'])('allows deliberate abandonment while %s without recording', async (status) => {
    state.interview = { ...snapshot, status }
    renderDemo()
    await userEvent.click(screen.getByRole('button', { name: 'Abandon interview' }))
    expect(screen.getByRole('button', { name: 'Confirm abandonment' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Record answer' })).not.toBeInTheDocument()
  })
  it('keeps provider and retention details available without dominating the active room', async () => {
    state.interview = { ...snapshot, executionMode: 'real' }
    renderDemo()
    expect(screen.getByText(/Streaming mode sends audio to OpenAI/i)).not.toBeVisible()
    await userEvent.click(screen.getByText('Interview details and privacy'))
    expect(screen.getByText(/Streaming mode sends audio to OpenAI/i)).toBeVisible()
    expect(screen.getByText(/Interviewer text is read by your browser/i)).toBeVisible()
    expect(screen.queryByText(/does not transcribe or assess/i)).not.toBeInTheDocument()
  })
  it('keeps explicit recording and submission controls for real sessions', async () => {
    renderDemo()
    expect(screen.getByRole('heading', { name: 'Spoken interview' })).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Record answer' }))
    expect(recorder.start).toHaveBeenCalledOnce()
    expect(state.answer).not.toHaveBeenCalled()
  })
  it('starts real interviews without offering a scripted mode', async () => {
    renderDemo('/interviews/demo')
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryByText(/offline scripted demo/i)).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Prepare interview' }))
    expect(start).toHaveBeenCalledWith('')
  })
  it('retires old scripted sessions without recording or retry controls', () => {
    state.interview = { ...snapshot, executionMode: 'fake' }
    renderDemo()
    expect(screen.getByText(/older scripted session is retired/i)).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Record answer' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Start a new interview' })).toBeVisible()
  })
  it('reviews after Done answering without uploading until explicit Transcribe', async () => {
    recorder.status = 'recording'
    renderDemo()
    await userEvent.dblClick(screen.getByRole('button', { name: 'Done answering' }))
    expect(state.answer).not.toHaveBeenCalled()
    recorder.status = 'ready'; recorder.recording = new Blob(['answer'], { type: 'audio/webm' })
    act(() => recorder.refresh())
    expect(state.answer).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Your recording preview')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Transcribe recording' }))
    await waitFor(() => expect(state.transcribeRecording).toHaveBeenCalledOnce())
    expect(state.transcribeRecording).toHaveBeenCalledWith(recorder.recording)
    act(() => recorder.refresh())
    expect(state.transcribeRecording).toHaveBeenCalledOnce()
  })
  it('never submits a ready blob without explicit Done answering intent', () => {
    recorder.status = 'ready'; recorder.recording = new Blob(['answer'], { type: 'audio/webm' })
    renderDemo()
    expect(state.answer).not.toHaveBeenCalled()
  })
  it('locks conflicting actions and prevents duplicate explicit submissions', async () => {
    recorder.status = 'ready'; recorder.recording = new Blob(['answer'], { type: 'audio/webm' })
    let resolve!: (saved: boolean) => void
    state.transcribeRecording.mockReturnValue(new Promise((done) => { resolve = done }))
    renderDemo()
    await userEvent.dblClick(screen.getByRole('button', { name: 'Transcribe recording' }))
    expect(state.transcribeRecording).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Discard recording' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Re-record' })).toBeDisabled()
    await act(async () => resolve(true))
    expect(recorder.reset).not.toHaveBeenCalled()
  })
  it('lets the user discard or explicitly replace a review recording', async () => {
    recorder.status = 'ready'; recorder.recording = new Blob(['answer'])
    renderDemo()
    await userEvent.click(screen.getByRole('button', { name: 'Re-record' }))
    expect(recorder.start).toHaveBeenCalledOnce()
    await userEvent.click(screen.getByRole('button', { name: 'Discard recording' }))
    expect(recorder.reset).toHaveBeenCalledOnce()
    expect(state.answer).not.toHaveBeenCalled()
  })
  it('keeps submit and re-record available after preview playback fails', async () => {
    recorder.status = 'ready'; recorder.recording = new Blob(['answer'])
    renderDemo()
    fireEvent.error(screen.getByLabelText('Your recording preview'))
    expect(screen.getByRole('alert')).toHaveTextContent('could not play')
    expect(screen.getByRole('button', { name: 'Transcribe recording' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Re-record' })).toBeEnabled()
  })
  it('warns on reload and in-app navigation, and clears the warning after discard', async () => {
    recorder.status = 'ready'; recorder.recording = new Blob(['answer'])
    const { router } = renderDemo()
    const unload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(unload)
    expect(unload.defaultPrevented).toBe(true)
    await userEvent.click(screen.getByRole('link', { name: 'Open written interview practice' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('Leave without submitting?')
    await userEvent.click(screen.getByRole('button', { name: 'Keep reviewing' }))
    expect(router.state.location.pathname).toBe('/interviews/demo/session')
    recorder.recording = null; recorder.status = 'idle'
    act(() => recorder.refresh())
    const cleanUnload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(cleanUnload)
    expect(cleanUnload.defaultPrevented).toBe(false)
  })
  it('clears the local preview and warning after durable submission', async () => {
    recorder.status = 'ready'; recorder.recording = new Blob(['answer'])
    recorder.reset.mockImplementationOnce(() => {
      recorder.status = 'idle'; recorder.recording = null; recorder.refresh()
    })
    state.answerText.mockResolvedValue(true)
    renderDemo()
    fireEvent.change(screen.getByRole('textbox', { name: 'Your answer' }), { target: { value: 'Reviewed text.' } })
    await userEvent.click(screen.getByRole('button', { name: 'Submit answer' }))
    expect(screen.queryByLabelText('Your recording preview')).not.toBeInTheDocument()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview')
    const unload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(unload)
    expect(unload.defaultPrevented).toBe(false)
  })
  it('can explicitly leave and releases the local preview', async () => {
    recorder.status = 'ready'; recorder.recording = new Blob(['answer'])
    const { router } = renderDemo()
    await userEvent.click(screen.getByRole('link', { name: 'Open written interview practice' }))
    await userEvent.click(screen.getByRole('button', { name: 'Discard and leave' }))
    expect(router.state.location.pathname).toBe('/interview-prep')
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview')
    expect(state.answer).not.toHaveBeenCalled()
  })
  it('keeps warning when a saved-state refresh fails during local review', () => {
    recorder.status = 'ready'; recorder.recording = new Blob(['answer'])
    renderDemo()
    state.loadError = new Error('offline')
    act(() => recorder.refresh())
    const unload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(unload)
    expect(unload.defaultPrevented).toBe(true)
  })
  it('keeps speech retry independent of answering the saved question', async () => {
    state.interview = { ...snapshot, operations: [{ ...snapshot.operations[0], status: 'failed', failureCode: 'speech_failed' }] }
    renderDemo()
    expect(screen.getByRole('button', { name: 'Record answer' })).toBeEnabled()
    await userEvent.click(screen.getByRole('button', { name: 'Retry speech' }))
    expect(state.retryOperation).toHaveBeenCalledWith('speech')
  })
  it.each([{ messages: [] }, { messages: [{ ...snapshot.messages[0], content: '   ' }] }])('waits for visible question text before recording', ({ messages }) => {
    state.interview = { ...snapshot, messages }
    renderDemo()
    expect(screen.getByRole('heading', { name: 'Waiting for your question' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Record answer' })).toBeDisabled()
  })
  it('preserves ambiguous submission recovery and disables new recording', async () => {
    state.unresolved = { submissionKey: 'stable' }
    renderDemo()
    expect(screen.getByRole('button', { name: 'Record answer' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Retry same submission' }))
    expect(state.checkSavedStatus).toHaveBeenCalledWith(true)
  })
  it('keeps the recording when upload or authorization fails before durable submission', async () => {
    recorder.status = 'ready'; recorder.recording = new Blob(['audio'], { type: 'audio/webm' })
    state.transcribeRecording.mockResolvedValue(null)
    renderDemo()
    await userEvent.click(screen.getByRole('button', { name: 'Transcribe recording' }))
    expect(state.transcribeRecording).toHaveBeenCalledWith(recorder.recording)
    expect(recorder.reset).not.toHaveBeenCalled()
  })
  it('directs a permanent turn failure to a new recording instead of retrying invalid input', () => {
    state.interview = { ...snapshot, operations: [...snapshot.operations, { id: 'turn', kind: 'turn', status: 'failed', canRetry: false, failureCode: 'invalid_recording' }] }
    renderDemo()
    expect(screen.queryByRole('button', { name: 'Retry answer processing' })).not.toBeInTheDocument()
    expect(screen.getByText('Record a new answer to continue.')).toBeVisible()
    expect(screen.getByRole('alert')).toHaveTextContent('This did not use a response slot.')
    expect(screen.getByRole('button', { name: 'Record answer' })).toBeEnabled()
  })
  it('hides the entrypoint when not explicitly enabled', () => {
    vi.stubEnv('VITE_INTERVIEW_DEMO_ENABLED', 'false')
    renderDemo('/interviews/demo')
    expect(screen.queryByRole('button', { name: 'Start interview' })).not.toBeInTheDocument()
    expect(screen.getByText(/unavailable in this environment/i)).toBeVisible()
  })
})

it('shows durable preparation progress and retry without recording controls', async () => {
  state.interview = { ...snapshot, status: 'preparing', questions: [], messages: [], operations: [
    { ...snapshot.operations[0], id: 'prep', kind: 'preparation', status: 'failed', canRetry: true, failureCode: 'dependency_unavailable' },
  ] }
  renderDemo()
  expect(screen.getByRole('heading', { name: 'Preparing your interview' })).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Record answer' })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Retry preparation' }))
  expect(state.retryOperation).toHaveBeenCalledWith('prep')
})

it('shows the frozen fictional role for review before any speech or recording', () => {
  state.interview = { ...snapshot, status: 'ready', preparedRole: { title: 'Laboratory technician',
    responsibilities: ['Maintain instruments'], requirements: ['Understand calibration'] }, messages: [], operations: [] }
  renderDemo()
  expect(screen.getByRole('heading', { name: 'Review your fictional role' })).toBeVisible()
  expect(screen.getByText('Laboratory technician')).toBeVisible()
  expect(screen.getByText('Maintain instruments')).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Record answer' })).not.toBeInTheDocument()
})

it('passes an explicit career focus to preparation and offers a library review path', async () => {
  renderDemo('/interviews/demo')
  await userEvent.type(screen.getByRole('textbox', { name: 'Career focus (optional)' }), 'Laboratory equipment')
  await userEvent.click(screen.getByRole('button', { name: 'Prepare interview' }))
  expect(start).toHaveBeenCalledWith('Laboratory equipment')
  expect(screen.getByRole('link', { name: 'Review your career library' })).toHaveAttribute('href', '/library')
})


describe('prepared interview begin', () => {
  it('offers explicit Begin after role review, without microphone capture', async () => {
    state.interview = { ...snapshot, status: 'ready', preparedRole: { title: 'Fictional technician', responsibilities: ['Maintain instruments'], requirements: ['Calibration'] } }
    renderDemo()
    expect(screen.getByText('Review your fictional role')).toBeVisible()
    expect(state.beginInterview).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Begin interview' }))
    expect(state.beginInterview).toHaveBeenCalledOnce()
    expect(recorder.start).not.toHaveBeenCalled()
  })

  it('shows whole-interview progress with response counts available in saved conversation', async () => {
    state.interview = { ...snapshot, answerCap: 3, currentQuestionPosition: 4,
      questions: Array.from({ length: 9 }, (_, position) => ({ id: `q${position}`, position, content: 'Question', questionType: 'technical', acceptedAnswerCount: position === 4 ? 2 : 0 })) }
    renderDemo()
    expect(screen.getByText('Question 5 of 9 · Technical')).toBeVisible()
    expect(screen.getByText('2 of 3 responses saved.')).toBeVisible()
    expect(screen.getByRole('complementary', { name: 'Saved conversation' })).toBeVisible()
    expect(screen.getByRole('progressbar', { name: 'Interview progress' })).toHaveAttribute('aria-valuenow', '4')
  })
})


it('defaults to browser recognition, remembers a choice, and locks it while an answer is captured', async () => {
  const first = renderDemo()
  const select = screen.getByRole('combobox', { name: 'Answer transcription' })
  expect(select).toHaveValue('browser')
  await userEvent.selectOptions(select, 'recorded')
  first.unmount()
  renderDemo()
  expect(screen.getByRole('combobox', { name: 'Answer transcription' })).toHaveValue('recorded')
  recorder.status = 'recording'
  act(() => recorder.refresh())
  expect(screen.getByRole('combobox', { name: 'Answer transcription' })).toBeDisabled()
})
it.each(['browser', 'streaming'])('reviews %s dictation in the editor and submits exact edits without retranscription', async (mode) => {
  state.answerText.mockResolvedValue(false)
  renderDemo()
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Answer transcription' }), mode)
  fireEvent.click(screen.getByRole('button', { name: 'Record answer' }))
  recorder.status = 'recording'; recorder.transcript = 'Interim answer'
  act(() => recorder.refresh())
  const editor = screen.getByRole('textbox', { name: 'Your answer' })
  expect(editor).toBeDisabled()
  expect(screen.getByText(/Live recognition/)).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Done answering' }))
  recorder.status = 'finalizing'
  act(() => recorder.refresh())
  expect(editor).toBeDisabled()
  expect(screen.getByRole('heading', { name: 'Finalizing your transcript' })).toBeVisible()
  expect(state.answerText).not.toHaveBeenCalled()
  recorder.status = 'ready'; recorder.recording = new Blob(['audio']); recorder.candidateTranscript = 'Final answer'; recorder.transcript = 'Final answer'
  act(() => recorder.refresh())
  await waitFor(() => expect(editor).toHaveValue('Final answer'))
  fireEvent.change(editor, { target: { value: '  My corrected final answer.  ' } })
  recorder.candidateTranscript = 'Late words'; recorder.transcript = 'Late words'
  act(() => recorder.refresh())
  expect(editor).toHaveValue('  My corrected final answer.  ')
  fireEvent.click(screen.getByRole('button', { name: 'Submit answer' }))
  await waitFor(() => expect(state.answerText).toHaveBeenCalledExactlyOnceWith('  My corrected final answer.  '))
  expect(state.answer).not.toHaveBeenCalled()
  expect(editor).toHaveValue('  My corrected final answer.  ')
  expect(screen.queryByRole('button', { name: 'Transcribe recording' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Discard recording' })).toBeEnabled()
})
it('shows the effective recorded fallback and keeps explicit submission available', () => {
  recorder.status = 'ready'; recorder.recording = new Blob(['audio']); recorder.effectiveMode = 'recorded'; recorder.fallbackReason = 'Recognition interrupted. Recorded fallback will be used.'
  renderDemo()
  expect(screen.getByText('Effective mode: Recorded audio transcription')).toBeVisible()
  expect(screen.getByText(recorder.fallbackReason)).toBeVisible()
  expect(screen.getByRole('button', { name: 'Transcribe recording' })).toBeEnabled()
})


it('lets a candidate type without audio, keeps failed text, and warns before leaving', async () => {
  state.answerText.mockResolvedValue(false)
  renderDemo()
  const editor = screen.getByRole('textbox', { name: 'Your answer' })
  fireEvent.change(editor, { target: { value: 'My exact typed answer.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Submit answer' }))
  await waitFor(() => expect(state.answerText).toHaveBeenCalledWith('My exact typed answer.'))
  expect(state.answer).not.toHaveBeenCalled()
  expect(recorder.start).not.toHaveBeenCalled()
  expect(editor).toHaveValue('My exact typed answer.')
  fireEvent.click(screen.getByRole('link', { name: 'Open written interview practice' }))
  expect(await screen.findByRole('dialog', { name: 'Leave without submitting?' })).toHaveTextContent('answer')
  fireEvent.click(screen.getByRole('button', { name: 'Keep reviewing' }))
  state.answerText.mockResolvedValue(true)
  fireEvent.click(screen.getByRole('button', { name: 'Submit answer' }))
  await waitFor(() => expect(editor).toHaveValue(''))
})

it('releases capture when another saved revision arrives and ignores its late text', async () => {
  renderDemo()
  fireEvent.click(screen.getByRole('button', { name: 'Record answer' }))
  recorder.status = 'finalizing'
  act(() => recorder.refresh())
  state.interview = { ...snapshot, revision: 1 }
  act(() => recorder.refresh())
  expect(recorder.reset).toHaveBeenCalledOnce()
  recorder.status = 'idle'
  act(() => recorder.refresh())
  const editor = screen.getByRole('textbox', { name: 'Your answer' })
  fireEvent.change(editor, { target: { value: 'An answer for the new prompt.' } })
  recorder.status = 'ready'; recorder.recording = new Blob(['old']); recorder.candidateTranscript = 'Old prompt text'
  act(() => recorder.refresh())
  expect(editor).toHaveValue('An answer for the new prompt.')
})

it('retains authored corrections across re-record, discard and failed recognition', async () => {
  renderDemo()
  const editor = screen.getByRole('textbox', { name: 'Your answer' })
  fireEvent.change(editor, { target: { value: 'My authored introduction.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Record answer' }))
  recorder.status = 'ready'; recorder.recording = new Blob(['audio']); recorder.candidateTranscript = 'First dictated detail.'
  act(() => recorder.refresh())
  await waitFor(() => expect(editor).toHaveValue('My authored introduction.\n\nFirst dictated detail.'))
  fireEvent.change(editor, { target: { value: 'My corrected answer.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Re-record' }))
  recorder.status = 'recording'; recorder.candidateTranscript = null; recorder.recording = null
  act(() => recorder.refresh())
  expect(editor).toBeDisabled()
  recorder.status = 'ready'; recorder.recording = new Blob(['replacement']); recorder.candidateTranscript = 'Second detail.'
  act(() => recorder.refresh())
  await waitFor(() => expect(editor).toHaveValue('My corrected answer.\n\nSecond detail.'))
  fireEvent.click(screen.getByRole('button', { name: 'Discard recording' }))
  recorder.status = 'idle'; recorder.candidateTranscript = null; recorder.recording = null
  act(() => recorder.refresh())
  expect(editor).toHaveValue('My corrected answer.\n\nSecond detail.')
  fireEvent.click(screen.getByRole('button', { name: 'Record answer' }))
  recorder.status = 'ready'; recorder.recording = new Blob(['failed recognition']); recorder.effectiveMode = 'recorded'; recorder.fallbackReason = 'Recognition failed; recording retained.'
  act(() => recorder.refresh())
  expect(editor).toHaveValue('My corrected answer.\n\nSecond detail.')
  expect(screen.getByText('Recognition failed; recording retained.')).toBeVisible()
  expect(screen.getByLabelText('Your recording preview')).toBeVisible()
  expect(state.answer).not.toHaveBeenCalled()
  expect(state.answerText).not.toHaveBeenCalled()
  expect(JSON.stringify(localStorage)).not.toContain('My corrected answer')
})

it('transcribes recorded audio into editable text before explicit submission', async () => {
  state.transcribeRecording.mockResolvedValue('capture')
  state.answerText.mockResolvedValue(true)
  renderDemo()
  fireEvent.change(screen.getByRole('combobox', { name: 'Answer transcription' }), { target: { value: 'recorded' } })
  fireEvent.click(screen.getByRole('button', { name: 'Record answer' }))
  recorder.status = 'ready'; recorder.recording = new Blob(['complete audio']); recorder.effectiveMode = 'recorded'
  act(() => recorder.refresh())
  fireEvent.click(screen.getByRole('button', { name: 'Transcribe recording' }))
  await waitFor(() => expect(state.transcribeRecording).toHaveBeenCalledOnce())
  state.interview = { ...snapshot, operations: [...snapshot.operations, { id: 'capture', kind: 'transcription', status: 'accepted', reviewTranscript: 'I rebuilt the scheduler.' }] }
  act(() => recorder.refresh())
  const editor = screen.getByRole('textbox', { name: 'Your answer' })
  await waitFor(() => expect(editor).toHaveValue('I rebuilt the scheduler.'))
  expect(state.answer).not.toHaveBeenCalled()
  expect(state.answerText).not.toHaveBeenCalled()
  fireEvent.change(editor, { target: { value: 'I repaired the booking scheduler.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Submit answer' }))
  await waitFor(() => expect(state.answerText).toHaveBeenCalledWith('I repaired the booking scheduler.'))
})

it.each(['edit', 'discard', 'revision'])('fences late recorded text after %s', async (action) => {
  state.transcribeRecording.mockResolvedValue('capture')
  renderDemo()
  fireEvent.click(screen.getByRole('button', { name: 'Record answer' }))
  recorder.status = 'ready'; recorder.recording = new Blob(['audio']); recorder.effectiveMode = 'recorded'
  act(() => recorder.refresh())
  fireEvent.click(screen.getByRole('button', { name: 'Transcribe recording' }))
  await waitFor(() => expect(state.transcribeRecording).toHaveBeenCalledOnce())
  state.interview = { ...snapshot, operations: [...snapshot.operations, { id: 'capture', kind: 'transcription', status: 'running' }] }
  act(() => recorder.refresh())
  expect(screen.getByText(/You can type a replacement/)).toBeVisible()
  const editor = screen.getByRole('textbox', { name: 'Your answer' })
  if (action === 'edit') fireEvent.change(editor, { target: { value: 'My replacement.' } })
  if (action === 'discard') fireEvent.click(screen.getByRole('button', { name: 'Discard recording' }))
  if (action === 'revision') { state.interview = { ...snapshot, revision: 1 }; act(() => recorder.refresh()) }
  state.interview = { ...snapshot, revision: action === 'revision' ? 1 : 0, operations: [...snapshot.operations, { id: 'capture', kind: 'transcription', status: 'accepted', reviewTranscript: 'Late transcript' }] }
  act(() => recorder.refresh())
  expect(editor).toHaveValue(action === 'edit' ? 'My replacement.' : '')
  if (action !== 'revision') expect(state.cancelTranscription).toHaveBeenCalledWith('capture')
  expect(state.answerText).not.toHaveBeenCalled()
})

it('restores capture progress after reload without cancelling on passive disposal', async () => {
  state.interview = { ...snapshot, operations: [...snapshot.operations, { id: 'capture', kind: 'transcription', status: 'running', expectedRevision: 0 }] }
  const view = renderDemo()
  expect(screen.getByText(/You can type a replacement/)).toBeVisible()
  expect(screen.getByRole('button', { name: 'Cancel transcription' })).toBeEnabled()
  view.unmount()
  expect(state.cancelTranscription).not.toHaveBeenCalled()
})

it('restores completed private capture text only on explicit review after reload', () => {
  state.interview = { ...snapshot, operations: [...snapshot.operations, { id: 'capture', kind: 'transcription', status: 'accepted', expectedRevision: 0, reviewTranscript: 'Recovered provider transcript.' }] }
  renderDemo()
  const editor = screen.getByRole('textbox', { name: 'Your answer' })
  expect(editor).toHaveValue('')
  fireEvent.click(screen.getByRole('button', { name: 'Review saved transcript' }))
  expect(editor).toHaveValue('Recovered provider transcript.')
  expect(screen.queryByRole('button', { name: 'Review saved transcript' })).not.toBeInTheDocument()
  expect(state.answerText).not.toHaveBeenCalled()
})

it.each(['running', 'accepted'])('preserves hydrated %s capture through StrictMode effect replay', (status) => {
  state.interview = { ...snapshot, operations: [...snapshot.operations, {
    id: 'capture', kind: 'transcription', status, expectedRevision: 0,
    reviewTranscript: status === 'accepted' ? 'Saved capture text.' : null,
  }] }
  const router = createMemoryRouter([{ path: '/interviews/demo/:id', element: <InterviewDemoPage /> }], { initialEntries: ['/interviews/demo/session'] })
  const view = render(<StrictMode><MockedProvider><RouterProvider router={router} /></MockedProvider></StrictMode>)
  expect(state.cancelTranscription).not.toHaveBeenCalled()
  if (status === 'accepted') expect(screen.getByRole('button', { name: 'Review saved transcript' })).toBeEnabled()
  else expect(screen.getByRole('button', { name: 'Cancel transcription' })).toBeEnabled()
  view.unmount()
  expect(state.cancelTranscription).not.toHaveBeenCalled()
})

it('fences a capture receipt arriving after unmount without cancelling durable work', async () => {
  let complete!: (id: string) => void
  state.transcribeRecording.mockReturnValue(new Promise((resolve) => { complete = resolve }))
  recorder.status = 'ready'; recorder.recording = new Blob(['audio']); recorder.effectiveMode = 'recorded'
  const view = renderDemo()
  fireEvent.click(screen.getByRole('button', { name: 'Transcribe recording' }))
  expect(state.transcribeRecording).toHaveBeenCalledOnce()
  view.unmount()
  await act(async () => complete('capture'))
  expect(state.cancelTranscription).not.toHaveBeenCalled()
  expect(state.answerText).not.toHaveBeenCalled()
})
