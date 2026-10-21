/** The spoken demo presents saved state and keeps turn recovery separate from speech replay. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MockLink } from '@apollo/client/testing'
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderPage } from '@/test/renderPage'
import { InterviewDemoPage } from './InterviewDemoPage'
import { INTERVIEW_PLAYBACK } from './interviewOperations'
const { state, recorder, start } = vi.hoisted(() => ({
  state: { interview: null as unknown, loading: false, loadError: null as unknown, subscriptionError: null, busy: false, error: null, unresolved: null as unknown, answer: vi.fn(), checkSavedStatus: vi.fn(), retryOperation: vi.fn(), beginInterview: vi.fn(), abandonInterview: vi.fn() },
  recorder: { status: 'idle', recording: null as Blob | null, error: null, start: vi.fn(), stop: vi.fn(), reset: vi.fn(), refresh: (() => {}) as () => void },
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
  id: 'session', status: 'active', interviewType: 'basic', executionMode: 'real', revision: 0, answerCap: 2, currentQuestionPosition: 1, expiresAt: '2026-10-27',
  questions: [{ id: 'question', content: 'Describe a project.', position: 1, acceptedAnswerCount: 0 }],
  messages: [{ id: 'opening', questionId: 'question', kind: 'opening', position: 1, content: 'Describe a project.' }],
  operations: [{ id: 'speech', questionId: 'question', messageId: 'opening', kind: 'speech', status: 'accepted', failureCode: null, checkpoint: null, submissionKey: null, canRetry: true }],
}
function renderDemo(url = '/interviews/demo/session', mocks: MockLink.MockedResponse[] = []) { return renderPage({ path: '/interviews/demo/:id?', url, mocks, element: <InterviewDemoPage />, extraRoutes: [{ path: '/interview-prep', element: <p>Written practice</p> }] }) }
function playbackMock(messageId = 'opening') {
  return { request: { query: INTERVIEW_PLAYBACK, variables: { input: { interviewId: 'session', messageId } } }, result: { data: {
    interviewPlayback: { __typename: 'InterviewPlaybackPayload', errors: [], playback: { __typename: 'InterviewPlayback', playbackUrl: 'https://storage.test/speech', expiresIn: 60, contentType: 'audio/wav' } },
  } } }
}
beforeEach(() => { vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:preview'), revokeObjectURL: vi.fn() })); vi.stubEnv('VITE_INTERVIEW_DEMO_ENABLED', 'true'); state.interview = structuredClone(snapshot); state.unresolved = null; state.loadError = null; recorder.status = 'idle'; recorder.recording = null; recorder.error = null; vi.clearAllMocks(); vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(); vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {}); state.answer.mockResolvedValue(true) })
afterEach(() => { cleanup(); vi.restoreAllMocks() })
describe('InterviewDemoPage', () => {
  it('leaves hydrated speech and earlier conversation silent until explicitly played', async () => {
    renderDemo('/interviews/demo/session', [playbackMock()])
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Play interviewer audio' }))
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
  it('does not automatically play a new reply accepted while microphone capture is active', async () => {
    recorder.status = 'recording'
    renderDemo()
    state.interview = { ...snapshot, revision: 1, messages: [...snapshot.messages, { ...snapshot.messages[0], id: 'reply', content: 'What changed?' }], operations: [...snapshot.operations, { ...snapshot.operations[0], id: 'next-speech', messageId: 'reply' }] }
    act(() => recorder.refresh())
    expect(screen.getByRole('button', { name: 'Play interviewer audio' })).toBeDisabled()
    recorder.status = 'idle'
    act(() => recorder.refresh())
    expect(screen.getByRole('button', { name: 'Play interviewer audio' })).toBeEnabled()
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled()
  })
  it('keeps the session muted across replies and stops speech when abandoned', async () => {
    renderDemo('/interviews/demo/session', [playbackMock('reply')])
    await userEvent.click(screen.getByRole('button', { name: 'Mute interviewer' }))
    state.interview = { ...snapshot, revision: 1, messages: [...snapshot.messages, { ...snapshot.messages[0], id: 'reply', content: 'What changed?' }], operations: [...snapshot.operations, { ...snapshot.operations[0], id: 'next-speech', messageId: 'reply' }] }
    act(() => recorder.refresh())
    expect(screen.getByRole('button', { name: 'Unmute interviewer' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Play interviewer audio' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Unmute interviewer' }))
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Play interviewer audio' }))
    await screen.findByRole('button', { name: 'Pause interviewer audio' })
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
    await userEvent.click(screen.getByRole('button', { name: /Saved conversation/ }))
    const earlier = within(screen.getByText('Earlier question').closest('li')!)
    await userEvent.click(earlier.getByRole('button', { name: 'Play interviewer audio' }))
    await earlier.findByRole('button', { name: 'Pause interviewer audio' })
    expect(current.getByRole('button', { name: 'Play interviewer audio' })).toBeEnabled()
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
    await userEvent.click(screen.getByRole('button', { name: /Saved conversation/ }))
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
    expect(screen.getByText(/submitted audio goes to OpenAI/i)).not.toBeVisible()
    await userEvent.click(screen.getByText('Interview details and privacy'))
    expect(screen.getByText(/submitted audio goes to OpenAI/i)).toBeVisible()
    expect(screen.getByText(/voice is AI-generated/i)).toBeVisible()
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
  it('reviews after Done answering without uploading until explicit Submit', async () => {
    recorder.status = 'recording'
    renderDemo()
    await userEvent.dblClick(screen.getByRole('button', { name: 'Done answering' }))
    expect(state.answer).not.toHaveBeenCalled()
    recorder.status = 'ready'; recorder.recording = new Blob(['answer'], { type: 'audio/webm' })
    act(() => recorder.refresh())
    expect(state.answer).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Your recording preview')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Submit recording' }))
    await waitFor(() => expect(state.answer).toHaveBeenCalledOnce())
    expect(state.answer).toHaveBeenCalledWith(recorder.recording)
    act(() => recorder.refresh())
    expect(state.answer).toHaveBeenCalledOnce()
  })
  it('never submits a ready blob without explicit Done answering intent', () => {
    recorder.status = 'ready'; recorder.recording = new Blob(['answer'], { type: 'audio/webm' })
    renderDemo()
    expect(state.answer).not.toHaveBeenCalled()
  })
  it('locks conflicting actions and prevents duplicate explicit submissions', async () => {
    recorder.status = 'ready'; recorder.recording = new Blob(['answer'], { type: 'audio/webm' })
    let resolve!: (saved: boolean) => void
    state.answer.mockReturnValue(new Promise((done) => { resolve = done }))
    renderDemo()
    await userEvent.dblClick(screen.getByRole('button', { name: 'Submit recording' }))
    expect(state.answer).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Discard recording' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Re-record' })).toBeDisabled()
    await act(async () => resolve(true))
    expect(recorder.reset).toHaveBeenCalledOnce()
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
    expect(screen.getByRole('button', { name: 'Submit recording' })).toBeEnabled()
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
    renderDemo()
    await userEvent.click(screen.getByRole('button', { name: 'Submit recording' }))
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
  it('blocks recording while speech is unavailable and offers only speech retry', async () => {
    state.interview = { ...snapshot, operations: [{ ...snapshot.operations[0], status: 'failed', failureCode: 'speech_failed' }] }
    renderDemo()
    expect(screen.getByRole('button', { name: 'Record answer' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Retry speech' }))
    expect(state.retryOperation).toHaveBeenCalledWith('speech')
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
    state.answer.mockResolvedValue(false)
    renderDemo()
    await userEvent.click(screen.getByRole('button', { name: 'Submit recording' }))
    expect(state.answer).toHaveBeenCalledWith(recorder.recording)
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
    await userEvent.click(screen.getByRole('button', { name: /Saved conversation/ }))
    expect(screen.getByText('2 of 3 responses saved.')).toBeVisible()
    expect(screen.getByRole('button', { name: /Saved conversation/ })).toBeVisible()
  })
})
