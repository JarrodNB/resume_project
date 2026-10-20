/** The spoken demo presents saved state and keeps turn recovery separate from speech replay. */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderPage } from '@/test/renderPage'
import { InterviewDemoPage } from './InterviewDemoPage'
const { state, recorder, start } = vi.hoisted(() => ({
  state: { interview: null as unknown, loading: false, loadError: null, subscriptionError: null, busy: false, error: null, unresolved: null as unknown, answer: vi.fn(), checkSavedStatus: vi.fn(), retryOperation: vi.fn() },
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
  id: 'session', status: 'active', interviewType: 'basic', revision: 0, answerCap: 2, currentQuestionPosition: 1, expiresAt: '2026-10-27',
  questions: [{ id: 'question', content: 'Describe a project.', position: 1, acceptedAnswerCount: 0 }],
  messages: [{ id: 'opening', questionId: 'question', kind: 'opening', position: 1, content: 'Describe a project.' }],
  operations: [{ id: 'speech', questionId: 'question', messageId: 'opening', kind: 'speech', status: 'accepted', failureCode: null, checkpoint: null, submissionKey: null, canRetry: true }],
}
function renderDemo(url = '/interviews/demo/session') { return renderPage({ path: '/interviews/demo/:id?', url, element: <InterviewDemoPage /> }) }
beforeEach(() => { vi.stubEnv('VITE_INTERVIEW_DEMO_ENABLED', 'true'); state.interview = structuredClone(snapshot); state.unresolved = null; recorder.status = 'idle'; recorder.recording = null; recorder.error = null; vi.clearAllMocks(); state.answer.mockResolvedValue(true) })
describe('InterviewDemoPage', () => {
  it('discloses scripted output and keeps explicit recording and submission controls', async () => {
    renderDemo()
    expect(screen.getByRole('heading', { name: 'Basic Interview demo' })).toBeVisible()
    expect(screen.getByText(/does not transcribe or assess/i)).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Record answer' }))
    expect(recorder.start).toHaveBeenCalledOnce()
    expect(state.answer).not.toHaveBeenCalled()
  })
  it('submits exactly once after Done answering and the final recorder blob arrives', async () => {
    recorder.status = 'recording'
    renderDemo()
    await userEvent.dblClick(screen.getByRole('button', { name: 'Done answering' }))
    expect(state.answer).not.toHaveBeenCalled()
    recorder.status = 'ready'; recorder.recording = new Blob(['answer'], { type: 'audio/webm' })
    act(() => recorder.refresh())
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
    expect(screen.queryByRole('button', { name: 'Start demo' })).not.toBeInTheDocument()
    expect(screen.getByText(/demo is disabled/i)).toBeVisible()
  })
})
