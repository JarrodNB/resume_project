/** The spoken demo presents saved state and keeps turn recovery separate from speech replay. */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderPage } from '@/test/renderPage'
import { InterviewDemoPage } from './InterviewDemoPage'
const { state, recorder, start } = vi.hoisted(() => ({
  state: { interview: null as unknown, loading: false, loadError: null as unknown, subscriptionError: null, busy: false, error: null, unresolved: null as unknown, answer: vi.fn(), checkSavedStatus: vi.fn(), retryOperation: vi.fn() },
  recorder: { status: 'idle', recording: null as Blob | null, error: null, start: vi.fn(), stop: vi.fn(), reset: vi.fn(), refresh: (() => {}) as () => void },
  start: vi.fn(),
}))
vi.mock('./useInterviewSession', () => ({ useInterviewSession: () => state, useStartInterview: () => ({ start, loading: false, error: null }) }))
vi.mock('./useInterviewRecorder', async () => {
  const { useState } = await import('react')
  return { useInterviewRecorder: () => { const [, setTick] = useState(0); recorder.refresh = () => setTick((value) => value + 1); return recorder } }
})
vi.mock('./InterviewAudio', () => ({ InterviewAudio: () => <p>Saved audio</p> }))
vi.mock('@/features/auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'owner' } }) }))
const snapshot = {
  id: 'session', status: 'active', interviewType: 'basic', executionMode: 'real', revision: 0, answerCap: 2, currentQuestionPosition: 1, expiresAt: '2026-10-27',
  questions: [{ id: 'question', content: 'Describe a project.', position: 1, acceptedAnswerCount: 0 }],
  messages: [{ id: 'opening', questionId: 'question', kind: 'opening', position: 1, content: 'Describe a project.' }],
  operations: [{ id: 'speech', questionId: 'question', messageId: 'opening', kind: 'speech', status: 'accepted', failureCode: null, checkpoint: null, submissionKey: null, canRetry: true }],
}
function renderDemo(url = '/interviews/demo/session') { return renderPage({ path: '/interviews/demo/:id?', url, element: <InterviewDemoPage />, extraRoutes: [{ path: '/interview-prep', element: <p>Written practice</p> }] }) }
beforeEach(() => { vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:preview'), revokeObjectURL: vi.fn() })); vi.stubEnv('VITE_INTERVIEW_DEMO_ENABLED', 'true'); state.interview = structuredClone(snapshot); state.unresolved = null; state.loadError = null; recorder.status = 'idle'; recorder.recording = null; recorder.error = null; vi.clearAllMocks(); state.answer.mockResolvedValue(true) })
describe('InterviewDemoPage', () => {
  it('labels saved real sessions with submitted audio and generated voice disclosure', () => {
    state.interview = { ...snapshot, executionMode: 'real' }
    renderDemo()
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
