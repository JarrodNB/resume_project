/** The interview page presents saved state and keeps turn recovery separate from speech replay. */
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MockedProvider } from '@apollo/client/testing/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import type { MockLink } from '@apollo/client/testing'
import { act, render, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderPage } from '@/test/renderPage'
import { InterviewPage } from './InterviewPage'
import { AUTHORIZE_INTERVIEW_OUTPUT, AVOID_INTERVIEW_PROMPT, REQUEST_INTERVIEW_CLARIFICATION, INTERVIEW_PLAYBACK, REQUEST_INTERVIEW_REFERENCES } from './interviewOperations'
import { cancelInterviewTiming, startInterviewTiming } from './interviewLatency'
import { JOBS_QUERY } from '@/features/jobs/jobsOperations'
const { state, recorder, start } = vi.hoisted(() => ({
  state: { interview: null as unknown, loading: false, loadError: null as unknown, subscriptionError: null, busy: false, error: null as string | null, errorCode: null as string | null, unresolved: null as unknown, transcribeRecording: vi.fn(), cancelTranscription: vi.fn(), answer: vi.fn(), answerText: vi.fn(), checkSavedStatus: vi.fn(), retryOperation: vi.fn(), beginInterview: vi.fn(), abandonInterview: vi.fn(), skipQuestion: vi.fn() },
  recorder: { candidateTranscript: null as string | null, transcript: '', effectiveMode: 'browser', fallbackReason: null as string | null, liveFailed: false, limitReached: false, options: {} as { pauseAtLimit?: boolean }, status: 'idle', recording: null as Blob | null, error: null, start: vi.fn(), stop: vi.fn(), resume: vi.fn(), reset: vi.fn(), microphoneStream: (() => null) as () => unknown, refresh: (() => {}) as () => void },
  start: vi.fn(),
}))
vi.mock('./useInterviewSession', () => ({ useInterviewSession: () => state, useStartInterview: () => ({ start, loading: false, error: null }) }))
vi.mock('./useInterviewRecorder', async () => {
  const { useState } = await import('react')
  return { useInterviewRecorder: (options: { pauseAtLimit?: boolean }) => { const [, setTick] = useState(0); recorder.refresh = () => setTick((value) => value + 1); recorder.options = options; return recorder } }
})
vi.mock('./RecentInterviews', () => ({ RecentInterviews: () => <p>Recent saved interviews</p> }))
vi.mock('@/features/auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'owner' } }) }))
const snapshot = {
  setup: { questionCount: 9, questionFormat: 'mixed', difficulty: 'realistic', interviewer: 'daniel', focusAreas: [] },
  id: 'session', status: 'active', interviewType: 'basic', executionMode: 'real', speechPlaybackMode: 'provider', revision: 0, answerCap: 2, currentQuestionPosition: 1, expiresAt: '2099-10-27',
  questions: [{ id: 'question', content: 'Describe a project.', position: 1, acceptedAnswerCount: 0 }],
  messages: [{ id: 'opening', questionId: 'question', kind: 'opening', position: 1, content: 'Describe a project.', careerReferences: { id: 'saved-references', status: 'empty', canRetry: true, attemptCount: 1, aiTaskId: null, deadline: null, references: [] } }],
  operations: [{ id: 'speech', questionId: 'question', messageId: 'opening', kind: 'speech', status: 'accepted', failureCode: null, checkpoint: null, submissionKey: null, canRetry: true }],
}
function renderInterview(url = '/practice/interviews/session', mocks: MockLink.MockedResponse[] = [], savedJobs = jobsMock(), historyState?: unknown) { return renderPage({ path: '/practice/interviews/:id?', url, historyState, mocks: [...mocks, { request: { query: REQUEST_INTERVIEW_REFERENCES, variables: () => true }, maxUsageCount: Infinity, result: { data: { requestInterviewReferences: { __typename: 'RequestInterviewReferencesPayload', errorCode: null, errors: [], careerReferences: { __typename: 'InterviewCareerReferences', ...snapshot.messages[0].careerReferences } } } } }, savedJobs], element: <InterviewPage />, extraRoutes: [{ path: '/practice/questions', element: <p>Written practice</p> }, { path: '/jobs/:jobId/interview', element: <p>Job practice setup</p> }] }) }
type SavedJob = { id: string; title: string; company: string | null; stage: 'UNAPPLIED' | 'APPLIED' | 'INTERVIEWING' | 'REJECTED' | 'OFFER' }
/** Saved jobs offered on the role step; mocked on every render so setup never waits on an unmocked query. */
function jobsMock(jobs: SavedJob[] = []): MockLink.MockedResponse {
  return { request: { query: JOBS_QUERY }, result: { data: { jobs: jobs.map((job) => ({ __typename: 'Job' as const, location: null, url: null, createdAt: '2026-10-01T00:00:00Z', ...job })) } } }
}
/** Opens the mock interview overview and picks the default practice role, landing on round setup. */
function stubMicrophoneSupport() {
  vi.stubGlobal('MediaRecorder', class {})
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn() } })
}
async function renderPracticeRoleSetup() {
  const view = renderInterview('/practice/interviews')
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
  return view
}
function playbackMock(messageId = 'opening') {
  return { delay: 0, request: { query: INTERVIEW_PLAYBACK, variables: { input: { interviewId: 'session', messageId } } }, result: { data: {
    interviewPlayback: { __typename: 'InterviewPlaybackPayload', errors: [], playback: { __typename: 'InterviewPlayback', playbackUrl: 'https://storage.test/speech', expiresIn: 60, contentType: 'audio/wav' } },
  } } }
}
beforeEach(() => { vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000001'); localStorage.clear(); recorder.candidateTranscript = null; recorder.transcript = ''; recorder.effectiveMode = 'browser'; recorder.fallbackReason = null; recorder.liveFailed = false; recorder.limitReached = false; vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:preview'), revokeObjectURL: vi.fn() })); state.interview = structuredClone(snapshot); state.busy = false; state.error = null; state.errorCode = null; state.unresolved = null; state.loadError = null; recorder.status = 'idle'; recorder.recording = null; recorder.error = null; vi.clearAllMocks(); vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(); vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {}); state.answer.mockResolvedValue(true); state.transcribeRecording.mockResolvedValue('capture'); state.cancelTranscription.mockResolvedValue(true) })
afterEach(async () => {
  cleanup()
  // Unmounting stops the mocked Apollo client and rejects requests still in flight (for example the
  // career examples request). Let those settle now, while the test environment still exists, so a late
  // state update cannot run after the last test has torn down the window.
  await new Promise((resolve) => setTimeout(resolve, 0))
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
describe('InterviewPage', () => {
  it('pauses automatic microphone capture while reviewing a Career context copy', async () => {
    vi.useFakeTimers()
    try {
      localStorage.setItem('Careerdrafter:interview-microphone:owner', JSON.stringify({ automatic: true, seconds: 0 }))
      state.interview = { ...snapshot, messages: [
        ...snapshot.messages,
        { id: 'answer', questionId: 'question', kind: 'answer', position: 2, content: 'Reduced processing time.' },
      ] }
      renderInterview()
      fireEvent.click(screen.getByRole('button', { name: 'Save to Career context' }))
      await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
      expect(recorder.start).not.toHaveBeenCalled()
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
      expect(recorder.start).toHaveBeenCalledOnce()
    } finally { vi.useRealTimers() }
  })

  it('offers editable career context copies beside accepted core and follow-up answers in history', async () => {
    state.interview = { ...snapshot, messages: [
      ...snapshot.messages,
      { id: 'answer-1', questionId: 'question', kind: 'answer', position: 2, content: 'Built a scheduling tool.' },
      { id: 'follow-up', questionId: 'question', kind: 'follow_up', position: 3, content: 'What improved?', acknowledgement: 'Thank you.' },
      { id: 'answer-2', questionId: 'question', kind: 'answer', position: 4, content: 'Saved two hours each week.' },
    ] }
    renderInterview()
    const history = within(screen.getByRole('complementary', { name: 'History' }))
    const actions = history.getAllByRole('button', { name: 'Save to Career context' })
    expect(actions).toHaveLength(2)
    await userEvent.click(actions[0])
    expect(screen.getByLabelText('Topic or question')).toHaveValue('Describe a project.')
    expect(screen.getByLabelText('Response')).toHaveValue('Built a scheduling tool.')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await userEvent.click(actions[1])
    expect(screen.getByLabelText('Topic or question')).toHaveValue('What improved?')
    expect(screen.getByLabelText('Response')).toHaveValue('Saved two hours each week.')
    expect(state.answerText).not.toHaveBeenCalled()
  })

  it.each(['preparing', 'ready'])('identifies the saved job and return path when resuming %s preparation', (status) => {
    state.interview = { ...snapshot, status, preparedRole: { title: 'Original laboratory technician', requirements: [], responsibilities: [] },
      jobContext: { id: 'job-1', title: 'Original laboratory technician', company: 'Original Labs', description: null, requirements: [], responsibilities: [], niceToHaves: [] } }
    renderInterview()
    expect(screen.getByText('Original Labs')).toBeVisible()
    expect(screen.getByRole('link', { name: 'Back to job' })).toHaveAttribute('href', '/jobs/job-1')
  })
  it('shows a waiting line with readable steps instead of raw operation states while preparing', () => {
    vi.useFakeTimers()
    try {
      state.interview = { ...snapshot, status: 'preparing', questions: [], preparedRole: null, jobContext: null,
        operations: [{ id: 'prep', questionId: null, messageId: null, kind: 'preparation', status: 'pending', failureCode: null, checkpoint: null, submissionKey: null, canRetry: false }] }
      renderInterview()
      expect(screen.getByRole('status')).toHaveTextContent('Getting your interview ready…')
      expect(screen.getByText('Waiting to start…')).toBeVisible()
      expect(screen.queryByText(/pending/)).not.toBeInTheDocument()
      state.interview = { ...(state.interview as typeof snapshot), operations: [{ ...(state.interview as typeof snapshot).operations[0], status: 'running' }] }
      act(() => { recorder.refresh() })
      expect(screen.getByText('Looking through your career library…')).toBeVisible()
      act(() => { vi.advanceTimersByTime(4000) })
      expect(screen.getByText('Imagining a role that fits your background…')).toBeVisible()
      expect(screen.queryByText(/running/)).not.toBeInTheDocument()
    } finally { vi.useRealTimers() }
  })
  it('identifies the frozen job and offers return navigation when resuming an active interview', () => {
    state.interview = { ...snapshot, jobContext: { id: 'job-1', title: 'Original laboratory technician', company: 'Original Labs', description: null, requirements: [], responsibilities: [], niceToHaves: [] } }
    renderInterview()
    expect(screen.getByText('Original laboratory technician')).toBeVisible()
    expect(screen.getByText('Original Labs')).toBeVisible()
    expect(screen.getByRole('link', { name: 'Back to job' })).toHaveAttribute('href', '/jobs/job-1')
  })
  it.each(['active', 'completed'])('keeps deleted-job %s practice readable without linking to the removed job', (status) => {
    state.interview = { ...snapshot, status, jobContext: { id: null, title: 'Original laboratory technician', company: 'Original Labs', description: null, requirements: [], responsibilities: [], niceToHaves: [] } }
    renderInterview()
    expect(screen.getByText('Original laboratory technician')).toBeVisible()
    expect(screen.getByText('Original Labs')).toBeVisible()
    expect(screen.queryByRole('link', { name: 'Back to job' })).not.toBeInTheDocument()
    expect(screen.getByText(/original job was deleted/i)).toBeVisible()
    if (status === 'completed') {
      expect(screen.queryByRole('button', { name: 'Fictional role' })).not.toBeInTheDocument()
      expect(screen.queryByRole('link', { name: 'Practice again' })).not.toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Choose another job' })).toHaveAttribute('href', '/jobs')
    }
  })
  it('reviews and repeats practice for the same live job, with the saved setup choices', async () => {
    state.interview = { ...snapshot, status: 'completed', jobContext: { id: 'job-1', title: 'Original laboratory technician', company: 'Original Labs', description: 'Saved role description.', requirements: [], responsibilities: [], niceToHaves: [] } }
    const { router } = renderPage({ path: '/practice/interviews/:id', url: '/practice/interviews/session', element: <InterviewPage />,
      extraRoutes: [{ path: '/jobs/:jobId/interview', element: <p>Job practice setup</p> }] })
    expect(screen.getByText('Original laboratory technician')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Fictional role' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to job' })).toHaveAttribute('href', '/jobs/job-1')
    await userEvent.click(screen.getByRole('link', { name: 'Practice again' }))
    expect(router.state.location.pathname).toBe('/jobs/job-1/interview')
    expect(router.state.location.state).toEqual({ practiceSetup: snapshot.setup })
  })
  it('returns an abandoned job interview to that job’s Interview tab', async () => {
    state.interview = { ...snapshot, jobContext: { id: 'job-1', title: 'Original laboratory technician', company: 'Original Labs', description: null, requirements: [], responsibilities: [], niceToHaves: [] } }
    state.abandonInterview.mockResolvedValue(true)
    const { router } = renderPage({ path: '/practice/interviews/:id', url: '/practice/interviews/session', element: <InterviewPage />,
      extraRoutes: [{ path: '/jobs/:jobId/interview', element: <p>Job practice setup</p> }] })
    await userEvent.click(screen.getByRole('button', { name: 'Abandon interview' }))
    await userEvent.click(screen.getByRole('button', { name: 'Confirm abandonment' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/jobs/job-1/interview'))
    expect(router.state.location.state).toEqual({ interviewEnded: 'abandoned' })
  })
  it('reviews the live saved job without labelling it as a fictional role', async () => {
    state.interview = { ...snapshot, status: 'ready', preparedRole: {},
      jobContext: { id: 'job-1', title: 'Laboratory technician', company: 'Sample Labs', description: null, requirements: [], responsibilities: [], niceToHaves: [] } }
    renderInterview()
    expect(screen.getByRole('heading', { name: 'Review your saved job' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Laboratory technician' })).toBeVisible()
    expect(screen.queryByText(/imagined vacancy/)).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Enter interview room' }))
    expect(state.beginInterview).toHaveBeenCalledOnce()
  })

  it('enters a prepared interview after its original job is deleted', async () => {
    state.interview = { ...snapshot, status: 'ready', preparedRole: {}, jobContext: null }
    renderInterview()
    expect(screen.getByRole('heading', { name: 'Review your prepared interview' })).toBeVisible()
    expect(screen.queryByText(/imagined vacancy/)).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Enter interview room' }))
    expect(state.beginInterview).toHaveBeenCalledOnce()
  })

  it('locks setup while preparation is pending and permits retry after failure', async () => {
    let finish!: (id: null) => void
    start.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    stubMicrophoneSupport()
    await renderPracticeRoleSetup()
    fireEvent.click(screen.getByRole('button', { name: 'Continue to settings' }))
    fireEvent.click(screen.getByRole('button', { name: 'Start interview' }))
    expect(screen.getByRole('button', { name: 'Starting…' })).toBeDisabled()
    expect(screen.getByRole('radio', { name: 'Automatic' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Starting…' }))
    expect(start).toHaveBeenCalledOnce()
    await act(async () => finish(null))
    expect(screen.getByRole('button', { name: 'Start interview' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Back to round' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Change role' })).not.toBeInTheDocument()
    expect(recorder.start).not.toHaveBeenCalled()
  })

  it('shares microphone preferences from setup without starting capture', async () => {
    stubMicrophoneSupport()
    const view = await renderPracticeRoleSetup()
    expect(screen.queryByRole('radiogroup', { name: 'Microphone' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Continue to settings' }))
    await userEvent.click(screen.getByRole('radio', { name: 'Streaming' }))
    expect(screen.getByText(/Try it if Browser misses words/)).toBeVisible()
    expect(screen.queryByRole('radiogroup', { name: 'Thinking time' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('radio', { name: 'Automatic' }))
    await userEvent.click(within(screen.getByRole('radiogroup', { name: 'Thinking time' })).getByRole('radio', { name: '10 sec' }))
    expect(recorder.start).not.toHaveBeenCalled()
    view.unmount()
    renderInterview()
    await userEvent.click(screen.getByRole('button', { name: 'Interview settings' }))
    expect(screen.getByRole('switch', { name: 'Turn the microphone on automatically' })).toBeChecked()
    expect(screen.getByRole('combobox', { name: 'Thinking time before the mic opens' })).toHaveValue('10')
    expect(screen.getByRole('combobox', { name: 'Answer transcription' })).toHaveValue('streaming')
  })

  it('says typing still works when this browser cannot record', async () => {
    await renderPracticeRoleSetup()
    await userEvent.click(screen.getByRole('button', { name: 'Continue to settings' }))
    expect(screen.getByText('This browser can’t record. You can type every answer.')).toBeVisible()
    expect(screen.queryByRole('radiogroup', { name: 'Microphone' })).not.toBeInTheDocument()
    expect(screen.getByRole('radiogroup', { name: 'Transcription' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Start interview' })).toBeEnabled()
  })

  it('submits selected difficulty, interviewer and optional focus areas', async () => {
    await renderPracticeRoleSetup()
    await userEvent.click(screen.getByRole('radio', { name: /Stretch/ }))
    await userEvent.click(screen.getByRole('radio', { name: /Priya/ }))
    await userEvent.click(screen.getByRole('button', { name: /Focus areas/ }))
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Leadership' }))
    await userEvent.keyboard('{Escape}')
    await userEvent.click(screen.getByRole('button', { name: 'Continue to settings' }))
    await userEvent.click(screen.getByRole('button', { name: 'Start interview' }))
    expect(start).toHaveBeenCalledWith('', { questionCount: 8, questionFormat: 'mixed', difficulty: 'stretch', interviewer: 'priya', focusAreas: ['leadership'] })
  })
  it('passes the selected question format with the requested length', async () => {
    await renderPracticeRoleSetup()
    await userEvent.click(screen.getByRole('radio', { name: /HR Screening/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Continue to settings' }))
    await userEvent.click(screen.getByRole('button', { name: 'Start interview' }))
    expect(start).toHaveBeenCalledWith('', { questionCount: 8, questionFormat: 'screening', difficulty: 'realistic', interviewer: 'daniel', focusAreas: [] })
  })
  it('defaults to eight core questions and sends the selected interview length', async () => {
    await renderPracticeRoleSetup()
    expect(screen.getByRole('radio', { name: /Standard/ })).toBeChecked()
    await userEvent.click(screen.getByRole('radio', { name: /Full loop/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue to settings' }))
    fireEvent.click(screen.getByRole('button', { name: 'Start interview' }))
    expect(start).toHaveBeenCalledWith('', { questionCount: 12, questionFormat: 'mixed', difficulty: 'realistic', interviewer: 'daniel', focusAreas: [] })
  })
  it('clarifies the latest follow-up while preserving typed draft and progress', async () => {
    state.interview = { ...snapshot, messages: [...snapshot.messages,
      { ...snapshot.messages[0], id: 'follow-up', kind: 'follow_up', content: 'How did you test it?' }] }
    renderInterview('/practice/interviews/session', [{ request: { query: REQUEST_INTERVIEW_CLARIFICATION,
      variables: { input: { interviewId: 'session', messageId: 'follow-up', retryFailed: false } } },
      result: { data: { requestInterviewClarification: { __typename: 'RequestInterviewClarificationPayload', errorCode: null, errors: [],
        clarification: { __typename: 'InterviewClarification', id: 'clarification', status: 'completed', explanation: 'Describe how you checked that the project worked.',
          attemptCount: 1, aiTaskId: null, deadline: null } } } } }])
    await userEvent.type(screen.getByRole('textbox', { name: 'Your answer' }), 'I wrote tests and reviewed the results.')
    fireEvent.click(screen.getByRole('button', { name: 'Clarify question' }))
    expect(await screen.findByText('Describe how you checked that the project worked.')).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'Your answer' })).toHaveValue('I wrote tests and reviewed the results.')
    expect(screen.getByText('Describe a project.')).toBeVisible()
    expect(within(screen.getByRole('region', { name: 'Current interview turn' })).getByText('How did you test it?')).toBeVisible()
    expect(state.answerText).not.toHaveBeenCalled()
    expect(state.answer).not.toHaveBeenCalled()
  })

  it('offers clarification beside the latest prompt without replacing the answer editor', async () => {
    renderInterview()
    expect(screen.getByRole('button', { name: 'Clarify question' })).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'Your answer' })).toBeVisible()
  })

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
    renderInterview()
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

  it('walks a submitted answer through sending, thinking and the next question arriving', async () => {
    vi.useFakeTimers()
    try {
      let finish!: (saved: boolean) => void
      state.answerText.mockImplementation(() => {
        state.busy = true
        recorder.refresh()
        return new Promise<boolean>((resolve) => { finish = resolve })
      })
      renderInterview()
      const stage = screen.getByRole('region', { name: 'Current interview turn' })
      expect(stage).toHaveAttribute('data-waiting', 'false')
      fireEvent.change(screen.getByRole('textbox', { name: 'Your answer' }), { target: { value: 'My reviewed answer.' } })
      fireEvent.click(screen.getByRole('button', { name: 'Submit answer' }))
      const spinner = () => screen.getByRole('heading', { level: 2, name: /Saving changes|Your interviewer is thinking/ }).querySelector('svg.animate-spin')
      expect(stage).toHaveAttribute('data-waiting', 'true')
      expect(screen.getByRole('heading', { name: 'Saving changes' })).toBeVisible()
      expect(spinner()).not.toBeNull()
      await act(async () => {
        state.busy = false
        state.interview = { ...snapshot, operations: [...snapshot.operations, { id: 'turn', kind: 'turn', status: 'running' }] }
        finish(true)
        recorder.refresh()
      })
      expect(stage).toHaveAttribute('data-waiting', 'true')
      expect(screen.getByRole('heading', { name: 'Your interviewer is thinking' })).toBeVisible()
      expect(spinner()).not.toBeNull()
      expect(screen.getByText('Answer received')).toBeVisible()
      expect(screen.queryByText('Next question ready')).not.toBeInTheDocument()
      act(() => {
        state.interview = { ...snapshot, messages: [...snapshot.messages,
          { ...snapshot.messages[0], id: 'answer', kind: 'answer', position: 2, content: 'My reviewed answer.' },
          { ...snapshot.messages[0], id: 'follow-up', kind: 'follow_up', position: 3, content: 'How did you test it?' },
        ], operations: [...snapshot.operations, { id: 'turn', kind: 'turn', status: 'completed' }] }
        recorder.refresh()
      })
      expect(stage).toHaveAttribute('data-waiting', 'false')
      expect(screen.queryByText('Answer received')).not.toBeInTheDocument()
      expect(screen.getByText('Next question ready')).toBeVisible()
      await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
      expect(screen.queryByText('Next question ready')).not.toBeInTheDocument()
    } finally { vi.useRealTimers() }
  })

  it('does not announce a next question when a reply arrives without a submitted answer', () => {
    renderInterview()
    act(() => {
      state.interview = { ...snapshot, messages: [...snapshot.messages,
        { ...snapshot.messages[0], id: 'follow-up', kind: 'follow_up', position: 2, content: 'How did you test it?' },
      ] }
      recorder.refresh()
    })
    expect(within(screen.getByRole('region', { name: 'Current interview turn' })).getByText('How did you test it?')).toBeVisible()
    expect(screen.queryByText('Next question ready')).not.toBeInTheDocument()
  })

  it('does not announce a next question after a submit that was not saved', async () => {
    state.answerText.mockResolvedValue(false)
    renderInterview()
    fireEvent.change(screen.getByRole('textbox', { name: 'Your answer' }), { target: { value: 'My reviewed answer.' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Submit answer' })) })
    act(() => {
      state.interview = { ...snapshot, messages: [...snapshot.messages,
        { ...snapshot.messages[0], id: 'follow-up', kind: 'follow_up', position: 2, content: 'How did you test it?' },
      ] }
      recorder.refresh()
    })
    expect(within(screen.getByRole('region', { name: 'Current interview turn' })).getByText('How did you test it?')).toBeVisible()
    expect(screen.queryByText('Next question ready')).not.toBeInTheDocument()
  })

  it('appends the active interviewer message to history immediately and once', () => {
    renderInterview()
    const history = within(screen.getByRole('complementary', { name: 'History' }))
    expect(history.getByText('Describe a project.')).toBeVisible()
    state.interview = { ...snapshot, messages: [...snapshot.messages,
      { ...snapshot.messages[0], id: 'answer', kind: 'answer', content: 'I built a booking tool.' },
      { ...snapshot.messages[0], id: 'follow-up', kind: 'follow_up', content: 'How did you test it?' },
    ] }
    act(() => recorder.refresh())
    expect(history.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'InterviewerDescribe a project.', 'Your transcriptI built a booking tool.', 'InterviewerHow did you test it?',
    ])
    expect(within(screen.getByRole('region', { name: 'Current interview turn' })).getByText('How did you test it?')).toBeVisible()
  })

  it('shows the latest question in the stage with complete dialogue in history', () => {
    state.interview = { ...snapshot, messages: [
      snapshot.messages[0],
      { ...snapshot.messages[0], id: 'answer', kind: 'answer', content: 'I built a booking tool.' },
      { ...snapshot.messages[0], id: 'follow-up', kind: 'follow_up', content: 'How did you test it?' },
    ] }
    renderInterview()
    const current = within(screen.getByRole('region', { name: 'Current interview turn' }))
    expect(current.queryByText('Describe a project.')).not.toBeInTheDocument()
    expect(current.queryByRole('heading', { name: 'Follow-up' })).not.toBeInTheDocument()
    expect(current.getByText('How did you test it?')).toBeVisible()
    expect(screen.getAllByText('Describe a project.')).toHaveLength(1)
    expect(screen.getByText('I built a booking tool.')).toBeVisible()
  })

  it('uses the newly active question and keeps a previous prompt out of its current turn', () => {
    state.interview = { ...snapshot, currentQuestionPosition: 2,
      questions: [...snapshot.questions, { ...snapshot.questions[0], id: 'next-question', position: 2, content: 'How do you review code?' }],
    }
    renderInterview()
    const current = within(screen.getByRole('region', { name: 'Current interview turn' }))
    expect(current.getByText('How do you review code?')).toBeVisible()
    expect(current.queryByText('Describe a project.')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Waiting for your question' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Record answer' })).toBeDisabled()
  })

  it('hides the saved closing after completion', () => {
    state.interview = { ...snapshot, status: 'completed', messages: [
      ...snapshot.messages, { ...snapshot.messages[0], id: 'closing', kind: 'closing', content: 'Thank you. This interview is complete.' },
    ] }
    renderInterview()
    expect(screen.getByRole('heading', { name: 'Interview complete' })).toBeVisible()
    expect(screen.queryByText('Thank you. This interview is complete.')).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Current interview turn' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to interviews' })).toHaveAttribute('href', '/practice/interviews')
    expect(screen.queryByRole('button', { name: 'Interview settings' })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('shows the saved acknowledgement separately and speaks the whole accepted interviewer turn', async () => {
    const speak = vi.fn()
    vi.stubGlobal('speechSynthesis', { speak, cancel: vi.fn() })
    vi.stubGlobal('SpeechSynthesisUtterance', class { text: string; constructor(text: string) { this.text = text } })
    const acknowledgement = 'You rebuilt the scheduler with a teammate.'
    const message = { ...snapshot.messages[0], acknowledgement, spokenContent: `${acknowledgement}\n\n${snapshot.messages[0].content}` }
    state.interview = { ...snapshot, speechPlaybackMode: 'browser', operations: [], messages: [message] }
    renderInterview()
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
    renderInterview()
    expect(screen.getByRole('region', { name: 'Current interview turn' })).toHaveAttribute('data-speaking', 'false')
    await userEvent.click(within(screen.getByRole('region', { name: 'Current interview turn' })).getByRole('button', { name: 'Play interviewer audio' }))
    expect(speak.mock.calls[0][0].text).toBe('Describe a project.')
    expect(screen.getByRole('button', { name: 'Record answer' })).toBeDisabled()
    expect(screen.getByRole('region', { name: 'Current interview turn' })).toHaveAttribute('data-speaking', 'true')
    await userEvent.click(screen.getByRole('button', { name: 'Stop interviewer audio' }))
    expect(screen.getByRole('button', { name: 'Record answer' })).toBeEnabled()
    expect(screen.getByRole('region', { name: 'Current interview turn' })).toHaveAttribute('data-speaking', 'false')
    state.interview = { ...snapshot, speechPlaybackMode: 'browser', revision: 1, operations: [], messages: [...snapshot.messages, { ...snapshot.messages[0], id: 'followup', content: 'What changed?' }] }
    act(() => recorder.refresh())
    await waitFor(() => expect(speak).toHaveBeenCalledTimes(2))
    expect(speak.mock.calls[1][0].text).toBe('What changed?')
  })

  it.each(['pending', 'failed', 'expired'])('allows a saved question to be answered when speech is %s', async (status) => {
    state.interview = { ...snapshot, operations: [{ ...snapshot.operations[0], status, failureCode: status === 'pending' ? null : 'speech_failed' }] }
    renderInterview()
    expect(within(screen.getByRole('region', { name: 'Current interview turn' })).getByText('Describe a project.')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Record answer' }))
    expect(recorder.start).toHaveBeenCalledOnce()
    const recording = new Blob(['answer'], { type: 'audio/webm' })
    recorder.status = 'ready'; recorder.effectiveMode = 'recorded'; recorder.recording = recording
    act(() => recorder.refresh())
    expect(screen.getByRole('button', { name: 'Transcribe recording' })).toBeEnabled()
    await userEvent.click(screen.getByRole('button', { name: 'Transcribe recording' }))
    expect(state.transcribeRecording).toHaveBeenCalledWith(recording)
  })
  it('leaves hydrated speech and earlier conversation silent until explicitly played', async () => {
    renderInterview('/practice/interviews/session', [playbackMock()])
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled()
    await userEvent.click(within(screen.getByRole('region', { name: 'Current interview turn' })).getByRole('button', { name: 'Play interviewer audio' }))
    await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce())
    expect(screen.getByRole('button', { name: 'Record answer' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Pause interviewer audio' }))
    expect(screen.getByRole('button', { name: 'Record answer' })).toBeEnabled()
  })
  it('automatically plays speech accepted after waiting, without replaying hydrated speech', async () => {
    state.interview = { ...snapshot, operations: [{ ...snapshot.operations[0], status: 'pending' }] }
    renderInterview('/practice/interviews/session', [playbackMock()])
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled()
    state.interview = { ...snapshot, revision: 1 }
    act(() => recorder.refresh())
    await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce())
    act(() => recorder.refresh())
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce()
    expect(recorder.start).not.toHaveBeenCalled()
  })
  it('autoplays a new reply but never its repeated or stale receipt', async () => {
    renderInterview('/practice/interviews/session', [playbackMock('reply')])
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
      renderInterview('/practice/interviews/session', [playbackMock()])
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
    renderInterview()
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
      renderInterview()
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
    renderInterview('/practice/interviews/session', [playbackMock('reply')])
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
  it.each(['provider', 'browser'])('shows text-only history with %s playback on the current question', async (speechPlaybackMode) => {
    vi.stubGlobal('speechSynthesis', { speak: vi.fn(), cancel: vi.fn() })
    vi.stubGlobal('SpeechSynthesisUtterance', class { text: string; constructor(text: string) { this.text = text } })
    state.interview = { ...snapshot, speechPlaybackMode, messages: [{ ...snapshot.messages[0], id: 'earlier', content: 'Earlier question' }, ...snapshot.messages], operations: [...snapshot.operations, { ...snapshot.operations[0], id: 'earlier-speech', messageId: 'earlier' }] }
    renderInterview('/practice/interviews/session', [playbackMock()])
    const history = within(screen.getByRole('complementary', { name: 'History' }))
    expect(history.getByText('Earlier question')).toBeVisible()
    expect(history.queryByRole('button')).not.toBeInTheDocument()
    const current = within(screen.getByRole('region', { name: 'Current interview turn' }))
    expect(current.getByRole('button', { name: 'Play interviewer audio' })).toBeEnabled()
  })
  it('keeps the current turn in the stage and the complete dialogue in history', async () => {
    state.interview = { ...snapshot, messages: [
      { ...snapshot.messages[0], id: 'earlier', content: 'What did you build?' },
      { ...snapshot.messages[0], id: 'answer', kind: 'answer', content: 'I built a booking tool.' },
      snapshot.messages[0],
    ] }
    renderInterview()
    expect(screen.getByRole('heading', { name: 'Your turn' })).toBeVisible()
    expect(screen.getByRole('region', { name: 'Current interview turn' })).toHaveTextContent('Describe a project.')
    expect(screen.getByText('What did you build?')).toBeVisible()
    expect(screen.getByText('I built a booking tool.')).toBeVisible()
    expect(within(screen.getByRole('complementary', { name: 'History' })).getByText('Describe a project.')).toBeVisible()
  })
  it.each([
    ['recording', 'Your turn — recording'],
    ['requesting', 'Allow microphone access'],
    ['ready', 'Recording paused'],
  ])('makes the next action clear while the recorder is %s', (status, title) => {
    recorder.status = status
    if (status === 'ready') recorder.recording = new Blob(['answer'])
    renderInterview()
    expect(screen.getByRole('heading', { name: title })).toBeVisible()
  })
  it('shows understandable processing rather than internal checkpoint names', () => {
    state.interview = { ...snapshot, operations: [...snapshot.operations, { id: 'turn', kind: 'turn', status: 'running', checkpoint: 'transcription_saved' }] }
    renderInterview()
    expect(screen.getByRole('heading', { name: 'Your interviewer is thinking' })).toBeVisible()
    expect(screen.getByText(/You can reload safely/)).toBeVisible()
    expect(screen.queryByText(/transcription_saved/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Record answer' })).toBeDisabled()
  })
  it('releases microphone capture when the saved interview is abandoned elsewhere', () => {
    recorder.status = 'recording'
    renderInterview()
    state.interview = { ...snapshot, status: 'abandoned' }
    act(() => recorder.refresh())
    expect(recorder.reset).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: 'Record answer' })).not.toBeInTheDocument()
  })
  it('clearly ends an expired interview without offering recording or retries', () => {
    state.interview = { ...snapshot, status: 'expired', operations: [{ ...snapshot.operations[0], status: 'expired', canRetry: true }] }
    renderInterview()
    expect(screen.getByRole('heading', { name: 'Interview expired' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Record answer' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry speech' })).not.toBeInTheDocument()
  })
  it('requires explicit confirmation and preserves the recording when cancellation or abandonment fails', async () => {
    recorder.recording = new Blob(['answer'], { type: 'audio/webm' }); recorder.status = 'ready'
    const { router } = renderInterview()
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
    await waitFor(() => expect(router.state.location.pathname).toBe('/practice/interviews'))
    expect(await screen.findByText('Interview ended. You can start another whenever you’re ready.')).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Who is this interview for?' })).toBeVisible()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
  it.each(['preparing', 'ready'])('cancels unstarted preparation while %s without recording', async (status) => {
    state.interview = { ...snapshot, status }
    state.abandonInterview.mockResolvedValue(false)
    renderInterview()
    expect(screen.queryByRole('button', { name: 'Abandon interview' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel preparation' }))
    expect(screen.getByRole('dialog', { name: 'Cancel this preparation?' })).toBeVisible()
    expect(screen.queryByText(/This preparation cannot be started|You can set up another interview/)).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Confirm cancellation' }))
    expect(state.abandonInterview).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: 'Record answer' })).not.toBeInTheDocument()
  })
  it('keeps provider and retention details available without dominating the active room', async () => {
    state.interview = { ...snapshot, executionMode: 'real' }
    renderInterview()
    expect(screen.getByText(/Streaming mode sends audio to OpenAI/i)).not.toBeVisible()
    await userEvent.click(screen.getByText('Interview details and privacy'))
    expect(screen.getByText(/Streaming mode sends audio to OpenAI/i)).toBeVisible()
    expect(screen.getByText(/Interviewer text is read by your browser/i)).toBeVisible()
    expect(screen.queryByText(/does not transcribe or assess/i)).not.toBeInTheDocument()
  })
  it('keeps explicit recording and submission controls for real sessions', async () => {
    renderInterview()
    expect(screen.getByRole('heading', { name: 'Mock interview' })).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Record answer' }))
    expect(recorder.start).toHaveBeenCalledOnce()
    expect(state.answer).not.toHaveBeenCalled()
  })
  it('starts real interviews without offering a scripted mode', async () => {
    await renderPracticeRoleSetup()
    expect(screen.queryByRole('combobox', { name: /execution mode/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/offline scripted/i)).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Continue to settings' }))
    await userEvent.click(screen.getByRole('button', { name: 'Start interview' }))
    expect(start).toHaveBeenCalledWith('', { questionCount: 8, questionFormat: 'mixed', difficulty: 'realistic', interviewer: 'daniel', focusAreas: [] })
  })
  it('retires old scripted sessions without recording or retry controls', () => {
    state.interview = { ...snapshot, executionMode: 'fake' }
    renderInterview()
    expect(screen.getByText(/older scripted session is retired/i)).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Record answer' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Start a new interview' })).toBeVisible()
  })
  it('reviews after Pause recording without uploading until explicit Transcribe', async () => {
    recorder.status = 'recording'
    renderInterview()
    const answerActions = within(screen.getByRole('group', { name: 'Answer controls' }))
    expect(answerActions.getByRole('button', { name: 'Pause recording' })).toBeEnabled()
    expect(answerActions.getByRole('button', { name: 'Submit answer' })).toBeDisabled()
    await userEvent.dblClick(screen.getByRole('button', { name: 'Pause recording' }))
    expect(state.answer).not.toHaveBeenCalled()
    recorder.status = 'ready'; recorder.effectiveMode = 'recorded'; recorder.recording = new Blob(['answer'], { type: 'audio/webm' })
    act(() => recorder.refresh())
    expect(state.answer).not.toHaveBeenCalled()
    await userEvent.click(screen.getByText('Review recording'))
    expect(screen.getByLabelText('Your recording preview')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Transcribe recording' }))
    await waitFor(() => expect(state.transcribeRecording).toHaveBeenCalledOnce())
    expect(state.transcribeRecording).toHaveBeenCalledWith(recorder.recording)
    act(() => recorder.refresh())
    expect(state.transcribeRecording).toHaveBeenCalledOnce()
  })
  it('offers continuation and explains transcription when a paused recording has no text', async () => {
    recorder.status = 'ready'; recorder.effectiveMode = 'recorded'; recorder.recording = new Blob(['answer'], { type: 'audio/webm' })
    renderInterview()
    expect(screen.getByRole('heading', { name: 'Recording paused' })).toBeVisible()
    expect(screen.getByText('Continue recording to add more, or transcribe your recording to review the words.')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Continue recording' }))
    expect(recorder.resume).toHaveBeenCalledOnce()
    expect(recorder.start).not.toHaveBeenCalled()
  })
  it('hides Transcribe recording when live recognition already filled the answer', () => {
    recorder.status = 'ready'; recorder.recording = new Blob(['answer'], { type: 'audio/webm' }); recorder.candidateTranscript = 'I led the migration.'
    renderInterview()
    expect(screen.queryByRole('button', { name: 'Transcribe recording' })).not.toBeInTheDocument()
  })
  it('offers Transcribe recording when live recognition failed earlier in this recording', () => {
    recorder.status = 'ready'; recorder.recording = new Blob(['answer'], { type: 'audio/webm' }); recorder.liveFailed = true
    renderInterview()
    expect(screen.getByRole('button', { name: 'Transcribe recording' })).toBeEnabled()
  })
  it('never submits a ready blob without explicit Pause recording intent', () => {
    recorder.status = 'ready'; recorder.recording = new Blob(['answer'], { type: 'audio/webm' })
    renderInterview()
    expect(state.answer).not.toHaveBeenCalled()
  })
  it('locks conflicting actions and prevents duplicate explicit submissions', async () => {
    recorder.status = 'ready'; recorder.effectiveMode = 'recorded'; recorder.recording = new Blob(['answer'], { type: 'audio/webm' })
    let resolve!: (saved: boolean) => void
    state.transcribeRecording.mockReturnValue(new Promise((done) => { resolve = done }))
    renderInterview()
    await userEvent.dblClick(screen.getByRole('button', { name: 'Transcribe recording' }))
    expect(state.transcribeRecording).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Discard recording' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Re-record' })).toBeDisabled()
    await act(async () => resolve(true))
    expect(recorder.reset).not.toHaveBeenCalled()
  })
  it('lets the user discard or explicitly replace a review recording', async () => {
    recorder.status = 'ready'; recorder.recording = new Blob(['answer'])
    renderInterview()
    await userEvent.click(screen.getByRole('button', { name: 'Re-record' }))
    expect(recorder.start).toHaveBeenCalledOnce()
    await userEvent.click(screen.getByRole('button', { name: 'Discard recording' }))
    expect(recorder.reset).toHaveBeenCalledOnce()
    expect(state.answer).not.toHaveBeenCalled()
  })
  it('keeps submit and re-record available after preview playback fails', async () => {
    recorder.status = 'ready'; recorder.effectiveMode = 'recorded'; recorder.recording = new Blob(['answer'])
    renderInterview()
    fireEvent.error(screen.getByLabelText('Your recording preview'))
    expect(screen.getByRole('alert')).toHaveTextContent('could not play')
    expect(screen.getByRole('button', { name: 'Transcribe recording' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Re-record' })).toBeEnabled()
  })
  it('warns on reload and in-app navigation, and clears the warning after discard', async () => {
    recorder.status = 'ready'; recorder.recording = new Blob(['answer'])
    const { router } = renderInterview()
    const unload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(unload)
    expect(unload.defaultPrevented).toBe(true)
    await act(async () => { await router.navigate('/practice/interviews') })
    expect(screen.getByRole('dialog')).toHaveTextContent('Leave without submitting?')
    await userEvent.click(screen.getByRole('button', { name: 'Keep reviewing' }))
    expect(router.state.location.pathname).toBe('/practice/interviews/session')
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
    renderInterview()
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
    const { router } = renderInterview()
    await act(async () => { await router.navigate('/practice/interviews') })
    await userEvent.click(screen.getByRole('button', { name: 'Discard and leave' }))
    expect(router.state.location.pathname).toBe('/practice/interviews')
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview')
    expect(state.answer).not.toHaveBeenCalled()
  })
  it('keeps warning when a saved-state refresh fails during local review', () => {
    recorder.status = 'ready'; recorder.recording = new Blob(['answer'])
    renderInterview()
    state.loadError = new Error('offline')
    act(() => recorder.refresh())
    const unload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(unload)
    expect(unload.defaultPrevented).toBe(true)
  })
  it('keeps speech retry independent of answering the saved question', async () => {
    state.interview = { ...snapshot, operations: [{ ...snapshot.operations[0], status: 'failed', failureCode: 'speech_failed' }] }
    renderInterview()
    expect(screen.getByRole('button', { name: 'Record answer' })).toBeEnabled()
    await userEvent.click(screen.getByRole('button', { name: 'Retry speech' }))
    expect(state.retryOperation).toHaveBeenCalledWith('speech')
  })
  it.each([{ messages: [] }, { messages: [{ ...snapshot.messages[0], content: '   ' }] }])('waits for visible question text before recording', ({ messages }) => {
    state.interview = { ...snapshot, messages }
    renderInterview()
    expect(screen.getByRole('heading', { name: 'Waiting for your question' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Record answer' })).toBeDisabled()
  })
  it('preserves ambiguous submission recovery and disables new recording', async () => {
    state.unresolved = { submissionKey: 'stable' }
    renderInterview()
    expect(screen.getByRole('button', { name: 'Record answer' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Retry same submission' }))
    expect(state.checkSavedStatus).toHaveBeenCalledWith(true)
  })
  it('keeps the recording when upload or authorization fails before durable submission', async () => {
    recorder.status = 'ready'; recorder.effectiveMode = 'recorded'; recorder.recording = new Blob(['audio'], { type: 'audio/webm' })
    state.transcribeRecording.mockResolvedValue(null)
    renderInterview()
    await userEvent.click(screen.getByRole('button', { name: 'Transcribe recording' }))
    expect(state.transcribeRecording).toHaveBeenCalledWith(recorder.recording)
    expect(recorder.reset).not.toHaveBeenCalled()
  })
  it('directs a permanent turn failure to a new recording instead of retrying invalid input', () => {
    state.interview = { ...snapshot, operations: [...snapshot.operations, { id: 'turn', kind: 'turn', status: 'failed', canRetry: false, failureCode: 'invalid_recording' }] }
    renderInterview()
    expect(screen.queryByRole('button', { name: 'Retry answer processing' })).not.toBeInTheDocument()
    expect(screen.getByText('Record a new answer to continue.')).toBeVisible()
    expect(screen.getByRole('alert')).not.toHaveTextContent('response slot')
    expect(screen.getByRole('button', { name: 'Record answer' })).toBeEnabled()
  })
  it('shows the integrated interview setup', async () => {
    await renderPracticeRoleSetup()
    expect(screen.getByRole('button', { name: 'Continue to settings' })).toBeVisible()
  })
})

it('shows durable preparation progress and retry without recording controls', async () => {
  state.interview = { ...snapshot, status: 'preparing', questions: [], messages: [], operations: [
    { ...snapshot.operations[0], id: 'prep', kind: 'preparation', status: 'failed', canRetry: true, failureCode: 'dependency_unavailable' },
  ] }
  renderInterview()
  expect(screen.getByRole('heading', { name: 'Getting your interview ready' })).toBeVisible()
  expect(screen.getByText(/setting up a fictional role for your interview/)).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Record answer' })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Retry preparation' }))
  expect(state.retryOperation).toHaveBeenCalledWith('prep')
})

it('shows the frozen fictional role for review before any speech or recording', () => {
  state.interview = { ...snapshot, status: 'ready', preparedRole: { title: 'Laboratory technician',
    responsibilities: ['Maintain instruments'], requirements: ['Understand calibration'] }, messages: [], operations: [] }
  renderInterview()
  expect(screen.getByRole('heading', { name: 'Review your fictional role' })).toBeVisible()
  expect(screen.getByText('Laboratory technician')).toBeVisible()
  expect(screen.getByText('Maintain instruments')).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Record answer' })).not.toBeInTheDocument()
})

it('prepares without a career-focus field or library review link', async () => {
  await renderPracticeRoleSetup()
  expect(screen.queryByRole('textbox', { name: /Career focus/i })).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'Review your career library' })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Continue to settings' }))
  await userEvent.click(screen.getByRole('button', { name: 'Start interview' }))
  expect(start).toHaveBeenCalledWith('', { questionCount: 8, questionFormat: 'mixed', difficulty: 'realistic', interviewer: 'daniel', focusAreas: [] })
})


describe('prepared interview begin', () => {
  it('keeps role review free of recent links and describes the actual follow-up limit', () => {
    state.interview = { ...snapshot, status: 'ready', answerCap: 3, preparedRole: { title: 'Fictional technician', responsibilities: ['Maintain instruments'], requirements: ['Calibration'] } }
    renderInterview()
    expect(screen.queryByRole('link', { name: 'Recent interviews' })).not.toBeInTheDocument()
    expect(screen.getByText(/Each core question may be followed by up to 2 related questions/)).toBeVisible()
    expect(screen.queryByText(/saved responses/)).not.toBeInTheDocument()
  })

  it('offers explicit Begin after role review, without microphone capture', async () => {
    state.interview = { ...snapshot, status: 'ready', preparedRole: { title: 'Fictional technician', responsibilities: ['Maintain instruments'], requirements: ['Calibration'] } }
    renderInterview()
    expect(screen.getByText('Review your fictional role')).toBeVisible()
    expect(state.beginInterview).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Enter interview room' }))
    expect(state.beginInterview).toHaveBeenCalledOnce()
    expect(recorder.start).not.toHaveBeenCalled()
  })

  it('shows saved interview progress beside history without response counts', async () => {
    state.interview = { ...snapshot, answerCap: 3, currentQuestionPosition: 4,
      questions: Array.from({ length: 9 }, (_, position) => ({ id: `q${position}`, position, content: 'Question', questionType: 'technical', acceptedAnswerCount: position === 4 ? 2 : 0 })) }
    renderInterview()
    expect(screen.getByText(/Question 5 of 9/)).toBeVisible()
    expect(screen.queryByText(/responses saved/)).not.toBeInTheDocument()
    expect(screen.queryByText('Accepted answers appear here after processing.')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Open written interview practice' })).not.toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: 'History' })).toBeVisible()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Recent interviews' })).not.toBeInTheDocument()
  })
})


it('defaults to browser recognition, remembers a choice, and locks it while an answer is captured', async () => {
  const first = renderInterview()
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Interview settings' }))
  const select = screen.getByRole('combobox', { name: 'Answer transcription' })
  expect(select).toHaveValue('browser')
  expect(screen.getByText(/Browser recognition fills your answer while you speak/)).toBeVisible()
  expect(screen.getByText(/try Streaming transcription or Recorded audio transcription/)).toBeVisible()
  await userEvent.selectOptions(select, 'recorded')
  expect(screen.getByText(/After you finish, choose Transcribe recording/)).toBeVisible()
  first.unmount()
  renderInterview()
  await userEvent.click(screen.getByRole('button', { name: 'Interview settings' }))
  expect(screen.getByRole('combobox', { name: 'Answer transcription' })).toHaveValue('recorded')
  recorder.status = 'recording'
  act(() => recorder.refresh())
  expect(screen.getByRole('combobox', { name: 'Answer transcription' })).toBeDisabled()
})
it('confirms switching modes then discards current audio and answer text', async () => {
  localStorage.setItem('Careerdrafter:interview-transcription:owner', 'recorded')
  recorder.status = 'ready'; recorder.recording = new Blob(['saved audio']); recorder.effectiveMode = 'recorded'
  renderInterview()
  fireEvent.change(screen.getByRole('textbox', { name: 'Your answer' }), { target: { value: 'Keep this draft' } })
  await userEvent.click(screen.getByRole('button', { name: 'Interview settings' }))
  const select = screen.getByRole('combobox', { name: 'Answer transcription' })
  expect(select).toBeEnabled()
  await userEvent.selectOptions(select, 'streaming')
  expect(select).toHaveValue('recorded')
  await userEvent.click(screen.getByRole('button', { name: 'Keep current mode' }))
  expect(recorder.reset).not.toHaveBeenCalled()
  await userEvent.selectOptions(select, 'streaming')
  await userEvent.click(screen.getByRole('button', { name: 'Discard and switch' }))
  expect(select).toHaveValue('streaming')
  expect(recorder.reset).toHaveBeenCalledOnce()
  await userEvent.keyboard('{Escape}')
  expect(screen.getByRole('textbox', { name: 'Your answer' })).toHaveValue('')
})
it('shows a waiting-for-words status while live transcription has not produced text', () => {
  recorder.status = 'recording'
  renderInterview()
  expect(screen.getByText(/Listening for words/)).toBeVisible()
  expect(screen.getByText(/If you are speaking and no words appear/)).toBeVisible()
  expect(screen.queryByText('Live transcription stopped')).not.toBeInTheDocument()
})
it.each(['browser', 'streaming'])('reviews %s dictation in the editor and submits exact edits without retranscription', async (mode) => {
  state.answerText.mockResolvedValue(false)
  renderInterview()
  await userEvent.click(screen.getByRole('button', { name: 'Interview settings' }))
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Answer transcription' }), mode)
  await userEvent.keyboard('{Escape}')
  fireEvent.click(screen.getByRole('button', { name: 'Record answer' }))
  recorder.status = 'recording'; recorder.transcript = 'Interim answer'
  act(() => recorder.refresh())
  const editor = screen.getByRole('textbox', { name: 'Your answer' })
  expect(editor).toBeEnabled()
  expect(editor).toHaveValue('Interim answer')
  expect(screen.queryByText(/Live recognition/)).not.toBeInTheDocument()
  recorder.transcript = 'Revised interim answer'
  act(() => recorder.refresh())
  expect(editor).toHaveValue('Revised interim answer')
  fireEvent.click(screen.getByRole('button', { name: 'Pause recording' }))
  recorder.status = 'finalizing'
  act(() => recorder.refresh())
  expect(editor).toBeEnabled()
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
it('shows the effective recorded fallback and keeps explicit submission available', async () => {
  recorder.status = 'ready'; recorder.recording = new Blob(['audio']); recorder.effectiveMode = 'recorded'; recorder.fallbackReason = 'Recognition interrupted. Recorded fallback will be used.'
  renderInterview()
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Interview settings' }))
  expect(screen.queryByText(/Selected mode:|Effective mode:/)).not.toBeInTheDocument()
  await userEvent.keyboard('{Escape}')
  expect(screen.getByText(recorder.fallbackReason)).toBeVisible()
  expect(screen.getByText('Live transcription stopped')).toBeVisible()
  expect(screen.getByText(/Your microphone is paused and your recording is safe/)).toBeVisible()
  expect(screen.getByRole('button', { name: 'Transcribe recording' })).toBeEnabled()
})


it('lets a candidate type without audio, keeps failed text, and warns before leaving', async () => {
  state.answerText.mockResolvedValue(false)
  const { router } = renderInterview()
  const editor = screen.getByRole('textbox', { name: 'Your answer' })
  fireEvent.change(editor, { target: { value: 'My exact typed answer.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Submit answer' }))
  await waitFor(() => expect(state.answerText).toHaveBeenCalledWith('My exact typed answer.'))
  expect(state.answer).not.toHaveBeenCalled()
  expect(recorder.start).not.toHaveBeenCalled()
  expect(editor).toHaveValue('My exact typed answer.')
  await act(async () => { await router.navigate('/practice/interviews') })
  expect(await screen.findByRole('dialog', { name: 'Leave without submitting?' })).toHaveTextContent('answer')
  fireEvent.click(screen.getByRole('button', { name: 'Keep reviewing' }))
  state.answerText.mockResolvedValue(true)
  fireEvent.click(screen.getByRole('button', { name: 'Submit answer' }))
  await waitFor(() => expect(editor).toHaveValue(''))
})

it('releases capture when another saved revision arrives and ignores its late text', async () => {
  renderInterview()
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
  renderInterview()
  const editor = screen.getByRole('textbox', { name: 'Your answer' })
  fireEvent.change(editor, { target: { value: 'My authored introduction.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Record answer' }))
  recorder.status = 'ready'; recorder.recording = new Blob(['audio']); recorder.candidateTranscript = 'First dictated detail.'
  act(() => recorder.refresh())
  await waitFor(() => expect(editor).toHaveValue('My authored introduction.\n\nFirst dictated detail.'))
  fireEvent.change(editor, { target: { value: 'My corrected answer.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Re-record' }))
  recorder.status = 'recording'; recorder.candidateTranscript = null; recorder.recording = null; recorder.transcript = 'Second interim'
  act(() => recorder.refresh())
  expect(editor).toHaveValue('My corrected answer.\n\nSecond interim')
  expect(editor).toBeEnabled()
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
  await userEvent.click(screen.getByText('Review recording'))
    expect(screen.getByLabelText('Your recording preview')).toBeVisible()
  expect(state.answer).not.toHaveBeenCalled()
  expect(state.answerText).not.toHaveBeenCalled()
  expect(JSON.stringify(localStorage)).not.toContain('My corrected answer')
})

it('transcribes recorded audio into editable text before explicit submission', async () => {
  state.transcribeRecording.mockResolvedValue('capture')
  state.answerText.mockResolvedValue(true)
  renderInterview()
  await userEvent.click(screen.getByRole('button', { name: 'Interview settings' }))
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Answer transcription' }), 'recorded')
  await userEvent.keyboard('{Escape}')
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
  renderInterview()
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

it.each(['edit', 'revision', 'cancel'])('fences a recorded upload receipt invalidated by %s before it arrives', async (action) => {
  let complete!: (id: string) => void
  state.transcribeRecording.mockReturnValueOnce(new Promise((resolve) => { complete = resolve }))
  renderInterview()
  fireEvent.click(screen.getByRole('button', { name: 'Record answer' }))
  recorder.status = 'ready'; recorder.recording = new Blob(['audio']); recorder.effectiveMode = 'recorded'
  act(() => recorder.refresh())
  fireEvent.click(screen.getByRole('button', { name: 'Transcribe recording' }))
  expect(screen.getByRole('button', { name: 'Transcribing recording…' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Re-record' })).toBeDisabled()
  const editor = screen.getByRole('textbox', { name: 'Your answer' })
  if (action === 'edit') fireEvent.change(editor, { target: { value: 'My replacement before the upload finished.' } })
  if (action === 'revision') { state.interview = { ...snapshot, revision: 1 }; act(() => recorder.refresh()) }
  if (action === 'cancel') {
    state.interview = { ...snapshot, operations: [...snapshot.operations, { id: 'capture', kind: 'transcription', status: 'running', expectedRevision: 0 }] }
    act(() => recorder.refresh())
    fireEvent.click(screen.getByRole('button', { name: 'Cancel transcription' }))
  }
  await act(async () => complete('capture'))
  expect(state.cancelTranscription).toHaveBeenCalledWith('capture')
  state.interview = { ...snapshot, revision: action === 'revision' ? 1 : 0, operations: [...snapshot.operations, {
    id: 'capture', kind: 'transcription', status: 'accepted', expectedRevision: 0, reviewTranscript: 'Obsolete uploaded words.',
  }] }
  act(() => recorder.refresh())
  expect(editor).toHaveValue(action === 'edit' ? 'My replacement before the upload finished.' : '')
  expect(state.answerText).not.toHaveBeenCalled()
})

it('restores capture progress after reload without cancelling on passive disposal', async () => {
  state.interview = { ...snapshot, operations: [...snapshot.operations, { id: 'capture', kind: 'transcription', status: 'running', expectedRevision: 0 }] }
  const view = renderInterview()
  expect(screen.getByText(/You can type a replacement/)).toBeVisible()
  expect(screen.getByRole('button', { name: 'Cancel transcription' })).toBeEnabled()
  view.unmount()
  expect(state.cancelTranscription).not.toHaveBeenCalled()
})

it('restores completed private capture text only on explicit review after reload', () => {
  state.interview = { ...snapshot, operations: [...snapshot.operations, { id: 'capture', kind: 'transcription', status: 'accepted', expectedRevision: 0, reviewTranscript: 'Recovered provider transcript.' }] }
  renderInterview()
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
  const router = createMemoryRouter([{ path: '/practice/interviews/:id', element: <InterviewPage /> }], { initialEntries: ['/practice/interviews/session'] })
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
  const view = renderInterview()
  fireEvent.click(screen.getByRole('button', { name: 'Transcribe recording' }))
  expect(state.transcribeRecording).toHaveBeenCalledOnce()
  view.unmount()
  await act(async () => complete('capture'))
  expect(state.cancelTranscription).not.toHaveBeenCalled()
  expect(state.answerText).not.toHaveBeenCalled()
})

it('keeps automatic microphone preferences in settings and remembers the thinking pause', async () => {
  const first = renderInterview()
  await userEvent.click(screen.getByRole('button', { name: 'Interview settings' }))
  const automatic = screen.getByRole('switch', { name: 'Turn the microphone on automatically' })
  expect(automatic).not.toBeChecked()
  const pause = screen.getByRole('combobox', { name: 'Thinking time before the mic opens' })
  expect(pause).toBeDisabled()
  expect(pause).toHaveValue('0')
  await userEvent.click(automatic)
  await userEvent.selectOptions(pause, '10')
  expect(recorder.start).not.toHaveBeenCalled()
  first.unmount()
  renderInterview()
  await userEvent.click(screen.getByRole('button', { name: 'Interview settings' }))
  expect(screen.getByRole('switch', { name: 'Turn the microphone on automatically' })).toBeChecked()
  expect(screen.getByRole('combobox', { name: 'Thinking time before the mic opens' })).toHaveValue('10')
  expect(recorder.start).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('switch', { name: 'Turn the microphone on automatically' }))
  const restoredPause = screen.getByRole('combobox', { name: 'Thinking time before the mic opens' })
  expect(restoredPause).toBeDisabled()
  expect(restoredPause).toHaveValue('0')
  await userEvent.click(screen.getByRole('switch', { name: 'Turn the microphone on automatically' }))
  expect(restoredPause).toBeEnabled()
  expect(restoredPause).toHaveValue('0')
})

it.each(['browser', 'streaming'])('keeps live %s corrections while new dictated words arrive', async (mode) => {
  renderInterview()
  await userEvent.click(screen.getByRole('button', { name: 'Interview settings' }))
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Answer transcription' }), mode)
  await userEvent.keyboard('{Escape}')
  fireEvent.click(screen.getByRole('button', { name: 'Record answer' }))
  recorder.status = 'recording'; recorder.transcript = 'I built a tool'
  act(() => recorder.refresh())
  const editor = screen.getByRole('textbox', { name: 'Your answer' })
  expect(editor).toBeEnabled()
  fireEvent.change(editor, { target: { value: 'I designed a scheduling tool' } })
  recorder.transcript = 'I built a tool for our team'
  act(() => recorder.refresh())
  expect(editor).toHaveValue('I designed a scheduling tool for our team')
  expect(screen.getByRole('button', { name: 'Submit answer' })).toBeDisabled()
  fireEvent.change(editor, { target: { value: 'I designed a scheduling tool for support' } })
  recorder.status = 'finalizing'; recorder.transcript = 'I built a tool for our team to reduce errors'
  act(() => recorder.refresh())
  expect(editor).toBeEnabled()
  expect(editor).toHaveValue('I designed a scheduling tool for support to reduce errors')
  recorder.status = 'ready'; recorder.recording = new Blob(['audio']); recorder.candidateTranscript = 'I built a tool for our team to reduce errors.'
  act(() => recorder.refresh())
  expect(editor).toHaveValue('I designed a scheduling tool for support to reduce errors.')
  expect(screen.getByRole('button', { name: 'Submit answer' })).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: 'Submit answer' }))
  await waitFor(() => expect(state.answerText).toHaveBeenCalledWith('I designed a scheduling tool for support to reduce errors.'))
})

 it('returns an old abandoned interview URL to the overview', async () => {
  state.interview = { ...snapshot, status: 'abandoned' }
  const { router } = renderInterview()
  await waitFor(() => expect(router.state.location.pathname).toBe('/practice/interviews'))
  expect(screen.getByRole('heading', { name: 'Who is this interview for?' })).toBeVisible()
  expect(screen.queryByText(/Audio is queued for deletion/)).not.toBeInTheDocument()
})

it('offers skipping but keeps the draft and recording when the server rejects it', async () => {
  state.skipQuestion.mockResolvedValue(false)
  recorder.recording = new Blob(['recording'], { type: 'audio/webm' })
  renderInterview()
  await userEvent.type(screen.getByRole('textbox', { name: 'Your answer' }), 'Keep my draft')
  await userEvent.click(screen.getByRole('button', { name: 'Skip question' }))
  await userEvent.click(screen.getByRole('button', { name: 'Skip and discard' }))
  expect(state.skipQuestion).toHaveBeenCalledOnce()
  expect(screen.getByRole('textbox', { name: 'Your answer', hidden: true })).toHaveValue('Keep my draft')
  expect(recorder.reset).not.toHaveBeenCalled()
})

it('groups retained completed dialogue by core question and remembers expanded review sections', async () => {
  state.interview = { ...snapshot, status: 'completed', preparedRole: { title: 'Scheduling engineer', responsibilities: ['Maintain bookings'], requirements: ['Testing'] }, questions: [
    { ...snapshot.questions[0], position: 0, skipped: true, acceptedAnswerCount: 2 }, { ...snapshot.questions[0], id: 'second', position: 1, content: 'Describe teamwork.', skipped: false },
  ], messages: [...snapshot.messages,
    { id: 'answer1', questionId: 'question', kind: 'answer', position: 2, content: 'I built a scheduler.' },
    { id: 'followup', questionId: 'question', kind: 'follow_up', position: 3, content: 'How did you test it?' },
    { id: 'answer2', questionId: 'question', kind: 'answer', position: 4, content: 'I wrote integration tests.' },
  ] }
  const view = renderInterview()
  expect(screen.getByText(/2 core questions/)).toBeVisible()
  expect(screen.queryByText('I built a scheduler.')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Fictional role' }))
  expect(screen.getByRole('heading', { name: 'Scheduling engineer' })).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: 'Core question 1 · Remaining follow-up skipped' }))
  expect(screen.getByText('Remaining follow-up skipped. Your earlier answers are saved below.')).toBeVisible()
  const group = screen.getByText('I built a scheduler.').closest('ol')!
  expect(within(group).getAllByRole('listitem').map((item) => Array.from(item.querySelectorAll('p')).map((paragraph) => paragraph.textContent).join(''))).toEqual([
    'Your answerI built a scheduler.', 'Follow-upHow did you test it?', 'Your answerI wrote integration tests.',
  ])
  await userEvent.click(screen.getByRole('button', { name: 'Core question 2' }))
  expect(screen.getByText('No saved answer for this question.')).toBeVisible()
  view.unmount()
  renderInterview()
  expect(screen.getByText('I wrote integration tests.')).toBeVisible()
  expect(screen.queryByRole('button', { name: /^(Record|Submit|Abandon|Clarify|Skip|Play speech)/i })).not.toBeInTheDocument()
  expect(recorder.start).not.toHaveBeenCalled()
})

it('switches directly from the live room to review and lets the candidate return to interviews', async () => {
  const { router } = renderInterview()
  expect(screen.getByRole('textbox', { name: 'Your answer' })).toBeVisible()
  state.interview = { ...snapshot, status: 'completed', revision: 1 }
  act(() => recorder.refresh())
  expect(screen.getByRole('heading', { name: 'Interview complete' })).toBeVisible()
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('link', { name: 'Back to interviews' }))
  expect(router.state.location.pathname).toBe('/practice/interviews')
  expect(screen.getByRole('heading', { name: 'Who is this interview for?' })).toBeVisible()
})

it('allows read-only review of a legacy completed session without role or audio', async () => {
  state.interview = { ...snapshot, executionMode: 'scripted', status: 'completed', operations: [] }
  renderInterview()
  expect(screen.getByRole('heading', { name: 'Interview complete' })).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: 'Prepared interview' }))
  expect(screen.getByText('Role details were not saved for this interview.')).toBeVisible()
  expect(screen.queryByText(/scripted session is retired/)).not.toBeInTheDocument()
})

it('keeps a return path when saved text has expired and loading fails', async () => {
  state.interview = null
  state.loadError = new Error('expired')
  renderInterview()
  expect(screen.getByRole('alert')).toHaveTextContent('expired')
  expect(screen.getByRole('link', { name: 'Back to interviews' })).toHaveAttribute('href', '/practice/interviews')
  expect(screen.getByRole('button', { name: 'Check saved status' })).toBeEnabled()
})

it('distinguishes an unanswered skipped core question and unavailable retained text', async () => {
  state.interview = { ...snapshot, status: 'completed', questions: [{ ...snapshot.questions[0], position: 0, content: '', skipped: true }], messages: [] }
  renderInterview()
  expect(screen.getByText('Question text is unavailable.')).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: 'Core question 1 · Skipped' }))
  expect(screen.getByText('Skipped — no answer was submitted.')).toBeVisible()
  expect(screen.getByText('No saved answer for this question.')).toBeVisible()
})

it('guides live transcription recovery through stopping before transcription', () => {
  recorder.status = 'recording'; recorder.fallbackReason = 'Recognition failed; recording retained.'
  renderInterview()
  fireEvent.change(screen.getByRole('textbox', { name: 'Your answer' }), { target: { value: 'My edited answer' } })
  fireEvent.click(screen.getByRole('button', { name: 'Pause recording' }))
  expect(recorder.stop).toHaveBeenCalledOnce()
  expect(state.transcribeRecording).not.toHaveBeenCalled()
  expect(screen.getByRole('textbox', { name: 'Your answer' })).toHaveValue('My edited answer')
})

it('shows saved core progress and only the actual follow-up number', () => {
  state.interview = { ...snapshot, questions: [{ ...snapshot.questions[0], id: 'previous', position: 0, skipped: true }, snapshot.questions[0]], messages: [...snapshot.messages, { ...snapshot.messages[0], id: 'follow', kind: 'follow_up', content: 'What changed?', position: 2 }] }
  renderInterview()
  expect(screen.getByText('Question 2 of 2 · Follow-up 1')).toBeVisible()
  expect(screen.queryByText(/Follow-up 1 of/)).not.toBeInTheDocument()
})

it('summarizes disjoint review outcomes and repeats through editable setup without provider work', async () => {
  state.interview = { ...snapshot, status: 'completed', setup: { ...snapshot.setup, questionCount: 5, difficulty: 'stretch', focusAreas: ['leadership'] }, questions: [
    { ...snapshot.questions[0], acceptedAnswerCount: 1, skipped: true },
    { ...snapshot.questions[0], id: 'skipped', position: 2, skipped: true },
  ] }
  renderInterview()
  expect(screen.getByText('1 answered · 1 skipped without an answer · Remaining follow-ups skipped on 1 question')).toBeVisible()
  fireEvent.click(screen.getByRole('link', { name: 'Practice again' }))
  expect(await screen.findByRole('radio', { name: /Stretch/ })).toBeChecked()
  expect(screen.getByRole('radio', { name: /Short/ })).toBeChecked()
  expect(screen.getByRole('button', { name: 'Remove Leadership' })).toBeVisible()
  expect(start).not.toHaveBeenCalled()
  expect(state.beginInterview).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Continue to settings' }))
  fireEvent.click(screen.getByRole('button', { name: 'Start interview' }))
  expect(start).toHaveBeenCalledWith('', { questionCount: 5, questionFormat: 'mixed', difficulty: 'stretch', interviewer: 'daniel', focusAreas: ['leadership'] })
})

it('restores core progress without inventing follow-ups after early advancement', () => {
  state.interview = { ...snapshot, questions: [{ ...snapshot.questions[0], id: 'previous', position: 0, acceptedAnswerCount: 1 }, snapshot.questions[0]], operations: [{ ...snapshot.operations[0], kind: 'turn', status: 'running' }] }
  const view = renderInterview()
  expect(screen.getByText('Question 2 of 2')).toBeVisible()
  expect(screen.queryByText(/· Follow-up/)).not.toBeInTheDocument()
  view.unmount()
  renderInterview()
  expect(screen.getByText('Question 2 of 2')).toBeVisible()
})

it('uses supported defaults when repeating a legacy setup', async () => {
  state.interview = { ...snapshot, status: 'completed', setup: { questionCount: 99, questionFormat: 'old', difficulty: 'old', interviewer: 'old', focusAreas: ['leadership', 'unknown', 'leadership'] }, questions: [{ ...snapshot.questions[0], skipped: true }], messages: [{ ...snapshot.messages[0], kind: 'answer' }] }
  renderInterview()
  expect(screen.getByText('1 answered · 0 skipped without an answer · Remaining follow-ups skipped on 1 question')).toBeVisible()
  fireEvent.click(screen.getByRole('link', { name: 'Practice again' }))
  expect(await screen.findByRole('radio', { name: /Standard/ })).toBeChecked()
  expect(screen.getByRole('radio', { name: /Mixed Interview/ })).toBeChecked()
  expect(screen.getByRole('radio', { name: /Realistic/ })).toBeChecked()
  expect(screen.getByRole('radio', { name: /Daniel/ })).toBeChecked()
  fireEvent.click(screen.getByRole('button', { name: 'Continue to settings' }))
  fireEvent.click(screen.getByRole('button', { name: 'Start interview' }))
  expect(start).toHaveBeenCalledWith('', { questionCount: 8, questionFormat: 'mixed', difficulty: 'realistic', interviewer: 'daniel', focusAreas: ['leadership'] })
})

it('saves the visible follow-up after retry while preserving text and recording', async () => {
  state.interview = { ...snapshot, messages: [...snapshot.messages, { ...snapshot.messages[0], id: 'follow-up', position: 2, kind: 'follow_up', content: 'What changed afterward?', avoided: false }] }
  recorder.recording = new Blob(['saved audio'])
  recorder.status = 'ready'
  const request = { query: AVOID_INTERVIEW_PROMPT, variables: { interviewId: 'session', messageId: 'follow-up' } }
  renderInterview('/practice/interviews/session', [
    { request, result: { data: { avoidInterviewPrompt: { __typename: 'AvoidInterviewPromptPayload', errorCode: null, saved: false, errors: ['Try saving again.'] } } } },
    { request, result: { data: { avoidInterviewPrompt: { __typename: 'AvoidInterviewPromptPayload', errorCode: null, saved: true, errors: [] } } } },
  ])
  const editor = screen.getByRole('textbox', { name: /answer/i })
  fireEvent.change(editor, { target: { value: 'My unsaved answer.' } })
  await userEvent.click(screen.getByRole('button', { name: "Don't see this again" }))
  expect(await screen.findByText('Try saving again.')).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: "Don't see this again" }))
  expect(await screen.findByRole('button', { name: 'Question avoided' })).toBeDisabled()
  expect(editor).toHaveValue('My unsaved answer.')
  expect(recorder.recording).not.toBeNull()
  expect(state.skipQuestion).not.toHaveBeenCalled()
  expect(within(screen.getByRole('region', { name: 'Current interview turn' })).getByText('What changed afterward?')).toBeVisible()
})

it('restores a saved prompt preference without changing the current question', () => {
  state.interview = { ...snapshot, messages: [{ ...snapshot.messages[0], avoided: true }] }
  renderInterview()
  expect(screen.getByRole('button', { name: 'Question avoided' })).toBeDisabled()
  expect(within(screen.getByRole('region', { name: 'Current interview turn' })).getByText('Describe a project.')).toBeVisible()
})

it('automatically retrieves references by default without blocking the draft', async () => {
  state.interview = { ...snapshot, messages: [{ ...snapshot.messages[0], careerReferences: null }] }
  renderInterview('/practice/interviews/session', [{ request: { query: REQUEST_INTERVIEW_REFERENCES,
    variables: { input: { interviewId: 'session', messageId: 'opening', retryFailed: false, visitId: '00000000-0000-4000-8000-000000000001' } } }, delay: 30,
    result: { data: { requestInterviewReferences: { __typename: 'RequestInterviewReferencesPayload', errorCode: null, errors: [], careerReferences: {
      __typename: 'InterviewCareerReferences', id: 'references', status: 'empty', canRetry: true, attemptCount: 1, aiTaskId: null, deadline: null, references: [],
    } } } } }])
  const answer = screen.getByRole('textbox', { name: 'Your answer' })
  expect(answer).toBeEnabled()
  fireEvent.change(answer, { target: { value: 'I kept my draft while examples loaded.' } })
  expect(await screen.findByText('No relevant saved examples found for this question.')).toBeVisible()
  expect(answer).toHaveValue('I kept my draft while examples loaded.')
  expect(screen.getByRole('checkbox', { name: 'Blur reference text' })).toBeChecked()
})

it('shows saved reference headings and blur controls on the current follow-up', () => {
  state.interview = { ...snapshot, messages: [...snapshot.messages, {
    ...snapshot.messages[0], id: 'follow-up', kind: 'follow_up', content: 'What changed afterward?',
    careerReferences: { id: 'references', status: 'completed', attemptCount: 1, aiTaskId: null, deadline: null,
      references: [{ sourceType: 'Project', sourceId: 'project', title: 'Scheduling project', body: 'I reduced appointment waiting time.' }] },
  }] }
  renderInterview()
  expect(screen.getByText('Scheduling project')).toBeVisible()
  expect(screen.getByText('I reduced appointment waiting time.')).toHaveAttribute('aria-hidden', 'true')
  expect(screen.getByRole('textbox', { name: 'Your answer' })).toBeEnabled()
})

describe('choosing who the interview is for', () => {
  const savedJobs = [
    { id: 'job-1', title: 'Laboratory technician', company: 'Sample Labs', stage: 'APPLIED' as const },
    { id: 'job-2', title: 'Quality analyst', company: null, stage: 'UNAPPLIED' as const },
    { id: 'job-3', title: 'Rejected role', company: 'Closed Co', stage: 'REJECTED' as const },
  ]
  it('offers a practice role and saved jobs except rejected ones', async () => {
    renderInterview('/practice/interviews', [], jobsMock(savedJobs))
    const group = screen.getByRole('group', { name: 'Interview for' })
    expect(within(group).getByRole('radio', { name: /A practice role/ })).toBeChecked()
    expect(await within(group).findByRole('radio', { name: /Laboratory technician.*Sample Labs · Applied/ })).not.toBeChecked()
    expect(within(group).getByRole('radio', { name: /Quality analyst.*Unknown company · Not applied/ })).toBeVisible()
    expect(within(group).queryByRole('radio', { name: /Rejected role/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Start interview' })).not.toBeInTheDocument()
  })
  it('opens the chosen job\'s interview tab', async () => {
    const { router } = renderInterview('/practice/interviews', [], jobsMock(savedJobs))
    await userEvent.click(await screen.findByRole('radio', { name: /Laboratory technician/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(router.state.location.pathname).toBe('/jobs/job-1/interview')
    expect(screen.getByText('Job practice setup')).toBeVisible()
    expect(start).not.toHaveBeenCalled()
  })
  it('continues with a practice role to round setup and can change role again', async () => {
    renderInterview('/practice/interviews', [], jobsMock(savedJobs))
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByRole('button', { name: 'Continue to settings' })).toBeVisible()
    expect(screen.queryByRole('group', { name: 'Interview for' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Change role' }))
    expect(screen.getByRole('heading', { name: 'Who is this interview for?' })).toBeVisible()
    expect(screen.getByRole('radio', { name: /A practice role/ })).toBeChecked()
    expect(screen.queryByRole('button', { name: 'Start interview' })).not.toBeInTheDocument()
  })
  it('still allows a practice role when saved jobs fail to load', async () => {
    renderInterview('/practice/interviews', [], { request: { query: JOBS_QUERY }, error: new Error('network down') })
    expect(await screen.findByText(/Couldn’t load saved jobs/)).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByRole('button', { name: 'Continue to settings' })).toBeVisible()
  })
  it('points to job search when there are no saved jobs to practice for', async () => {
    renderInterview('/practice/interviews', [], jobsMock([savedJobs[2]]))
    expect(await screen.findByRole('link', { name: 'Find jobs' })).toHaveAttribute('href', '/jobs/find')
    expect(screen.getAllByRole('radio')).toHaveLength(1)
  })
  describe('with many saved jobs', () => {
    const manyJobs = Array.from({ length: 12 }, (_, index) => ({
      id: `many-${index + 1}`, title: `Role ${index + 1}`, company: index === 8 ? 'Harbour Clinic' : 'Acme', stage: 'UNAPPLIED' as const,
    }))
    it('shows only the newest jobs and says how to find the others', async () => {
      renderInterview('/practice/interviews', [], jobsMock(manyJobs))
      expect(await screen.findByText('Showing your 5 newest of 12 saved jobs. Search to find the others.')).toBeVisible()
      expect(screen.getAllByRole('radio')).toHaveLength(6)
      expect(screen.getByRole('radio', { name: /^Role 5(?!\d)/ })).toBeVisible()
      expect(screen.queryByRole('radio', { name: /^Role 6(?!\d)/ })).not.toBeInTheDocument()
    })
    it('finds an older job by company and opens its interview tab', async () => {
      const { router } = renderInterview('/practice/interviews', [], jobsMock(manyJobs))
      await userEvent.type(await screen.findByRole('searchbox', { name: 'Search saved jobs' }), 'harbour{Enter}')
      expect(router.state.location.pathname).toBe('/practice/interviews')
      expect(screen.getByText('1 saved job matches.')).toBeVisible()
      await userEvent.click(screen.getByRole('radio', { name: /Role 9.*Harbour Clinic/ }))
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
      expect(router.state.location.pathname).toBe('/jobs/many-9/interview')
    })
    it('keeps the chosen job in the list while searching', async () => {
      renderInterview('/practice/interviews', [], jobsMock(manyJobs))
      await userEvent.click(await screen.findByRole('radio', { name: /^Role 2(?!\d)/ }))
      await userEvent.type(screen.getByRole('searchbox', { name: 'Search saved jobs' }), 'nothing like this')
      expect(screen.getByText('No saved jobs match your search.')).toBeVisible()
      expect(screen.getByRole('radio', { name: /^Role 2(?!\d)/ })).toBeChecked()
    })
  })
  it('does not offer search when every saved job fits', async () => {
    renderInterview('/practice/interviews', [], jobsMock(savedJobs))
    await screen.findByRole('radio', { name: /Laboratory technician/ })
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
  })
  it('starts at round setup with the saved choices when practicing again', () => {
    renderInterview('/practice/interviews', [], jobsMock(), { practiceSetup: { ...snapshot.setup, difficulty: 'stretch' } })
    expect(screen.getByRole('radio', { name: /Stretch/ })).toBeChecked()
    expect(screen.getByRole('button', { name: 'Change role' })).toBeVisible()
    expect(screen.queryByRole('heading', { name: 'Who is this interview for?' })).not.toBeInTheDocument()
  })
})

it('keeps a reference visit through rerenders and gives a reopened interview a new visit', async () => {
  vi.mocked(crypto.randomUUID).mockReturnValueOnce('00000000-0000-4000-8000-000000000011').mockReturnValueOnce('00000000-0000-4000-8000-000000000012')
  const visits: string[] = []
  const result = vi.fn((variables) => {
    visits.push(variables.input.visitId)
    return { data: { requestInterviewReferences: { __typename: 'RequestInterviewReferencesPayload', errorCode: null, errors: [], careerReferences: { __typename: 'InterviewCareerReferences', ...snapshot.messages[0].careerReferences } } } }
  })
  const view = renderInterview('/practice/interviews/session', [{ request: { query: REQUEST_INTERVIEW_REFERENCES, variables: () => true }, maxUsageCount: Infinity, result }])
  await waitFor(() => expect(result).toHaveBeenCalledTimes(1))
  fireEvent.click(screen.getByRole('checkbox', { name: 'Blur reference text' }))
  fireEvent(document, new Event('visibilitychange'))
  expect(result).toHaveBeenCalledTimes(1)
  await act(() => view.router.navigate('/practice/questions'))
  await act(() => view.router.navigate('/practice/interviews/session'))
  await waitFor(() => expect(result).toHaveBeenCalledTimes(2))
  expect(visits).toEqual(['00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000012'])
})

it.each(['active', 'preparing'])('links a %s interview mutation refusal to billing', (status) => {
  state.interview = { ...snapshot, status }
  state.error = 'Subscribe to continue.'
  state.errorCode = 'PLAN_ENDED'
  renderInterview()
  expect(screen.getByRole('link', { name: 'Plan & billing' })).toHaveAttribute('href', '/account/billing')
})

describe('hands-free answers', () => {
  const microphone = { level: 0 }
  beforeEach(() => {
    vi.useFakeTimers()
    microphone.level = 0
    recorder.microphoneStream = () => ({ getAudioTracks: () => [] })
    vi.stubGlobal('MediaStream', class {})
    vi.stubGlobal('AudioContext', class {
      state = 'running'
      resume() { return Promise.resolve() }
      close() { return Promise.resolve() }
      createMediaStreamSource() { return { connect() {}, disconnect() {} } }
      createAnalyser() { return { fftSize: 32, getFloatTimeDomainData(target: Float32Array) { target.fill(microphone.level) } } }
    })
  })
  afterEach(() => { vi.useRealTimers(); recorder.microphoneStream = () => null })
  const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })
  function rememberMicrophone(settings: object, transcription = 'browser') {
    localStorage.setItem('Careerdrafter:interview-microphone:owner', JSON.stringify({ automatic: true, seconds: 0, ...settings }))
    localStorage.setItem('Careerdrafter:interview-transcription:owner', transcription)
  }
  /** The automatic mic opens, the candidate says some words, then goes quiet long enough to end the answer. */
  async function speakThenGoQuiet(words = 'I led the migration.') {
    renderInterview()
    await advance(1000)
    expect(recorder.start).toHaveBeenCalledOnce()
    recorder.status = 'recording'
    act(() => recorder.refresh())
    await advance(5000)
    expect(recorder.stop).not.toHaveBeenCalled()
    microphone.level = 0.2
    recorder.transcript = words
    act(() => recorder.refresh())
    await advance(1000)
    microphone.level = 0
  }
  function finishTranscript(words: string) {
    recorder.status = 'finalizing'
    act(() => recorder.refresh())
    recorder.status = 'ready'; recorder.recording = new Blob(['audio']); recorder.candidateTranscript = words
    act(() => recorder.refresh())
  }

  it('stops capture after 2.5 s of silence, counts down politely, and sends the final transcript', async () => {
    rememberMicrophone({ handsFree: true })
    await speakThenGoQuiet()
    await advance(2300)
    expect(recorder.stop).not.toHaveBeenCalled()
    await advance(300)
    expect(recorder.stop).toHaveBeenCalledOnce()
    finishTranscript('I led the migration.')
    expect(screen.getByRole('textbox', { name: 'Your answer' })).toHaveValue('I led the migration.')
    const countdown = screen.getByText('Sending in 3…')
    expect(countdown.closest('[aria-live="polite"]')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Keep editing' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Send now' })).toBeEnabled()
    await advance(1000)
    expect(screen.getByText('Sending in 2…')).toBeVisible()
    await advance(1000)
    expect(screen.getByText('Sending in 1…')).toBeVisible()
    expect(state.answerText).not.toHaveBeenCalled()
    await advance(1000)
    expect(state.answerText).toHaveBeenCalledExactlyOnceWith('I led the migration.')
  })

  it('sends at once with Send now', async () => {
    rememberMicrophone({ handsFree: true })
    await speakThenGoQuiet()
    await advance(2600)
    finishTranscript('I led the migration.')
    fireEvent.click(screen.getByRole('button', { name: 'Send now' }))
    await advance(0)
    expect(state.answerText).toHaveBeenCalledExactlyOnceWith('I led the migration.')
  })

  it('keeps the text and leaves manual Submit when the candidate chooses Keep editing', async () => {
    rememberMicrophone({ handsFree: true })
    await speakThenGoQuiet()
    await advance(2600)
    finishTranscript('I led the migration.')
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
    await advance(10_000)
    expect(screen.queryByText(/Sending in/)).not.toBeInTheDocument()
    expect(state.answerText).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox', { name: 'Your answer' })).toHaveValue('I led the migration.')
    fireEvent.click(screen.getByRole('button', { name: 'Submit answer' }))
    await advance(0)
    expect(state.answerText).toHaveBeenCalledExactlyOnceWith('I led the migration.')
  })

  it('cancels the countdown when the candidate edits the answer', async () => {
    rememberMicrophone({ handsFree: true })
    await speakThenGoQuiet()
    await advance(2600)
    finishTranscript('I led the migration.')
    fireEvent.change(screen.getByRole('textbox', { name: 'Your answer' }), { target: { value: 'I led the database migration.' } })
    await advance(10_000)
    expect(screen.queryByText(/Sending in/)).not.toBeInTheDocument()
    expect(state.answerText).not.toHaveBeenCalled()
  })

  it('cancels the countdown and keeps recording into the same answer when the candidate speaks again', async () => {
    rememberMicrophone({ handsFree: true })
    await speakThenGoQuiet()
    await advance(2600)
    finishTranscript('I led the migration.')
    expect(screen.getByText('Sending in 3…')).toBeVisible()
    microphone.level = 0.2
    await advance(100)
    expect(recorder.resume).not.toHaveBeenCalled()
    await advance(300)
    expect(recorder.resume).toHaveBeenCalledOnce()
    expect(screen.queryByText(/Sending in/)).not.toBeInTheDocument()
    recorder.status = 'recording'; recorder.recording = null; recorder.candidateTranscript = null; recorder.transcript = 'It shipped early.'
    act(() => recorder.refresh())
    expect(screen.getByRole('textbox', { name: 'Your answer' })).toHaveValue('I led the migration.\n\nIt shipped early.')
    await advance(10_000)
    expect(state.answerText).not.toHaveBeenCalled()
    microphone.level = 0
    await advance(2600)
    expect(recorder.stop).toHaveBeenCalledTimes(2)
  })

  it('starts the countdown when the recording limit pauses a hands-free answer, without offering to continue', async () => {
    rememberMicrophone({ handsFree: true })
    await speakThenGoQuiet()
    expect(recorder.options.pauseAtLimit).toBe(true)
    microphone.level = 0.2
    recorder.limitReached = true
    finishTranscript('I led the migration.')
    expect(recorder.stop).not.toHaveBeenCalled()
    expect(screen.getByText('Sending in 3…')).toBeVisible()
    expect(screen.getByText(/reached the 2-minute recording limit/)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Continue recording' })).toBeDisabled()
    await advance(1000)
    expect(recorder.resume).not.toHaveBeenCalled()
    for (const _second of [2, 1]) await advance(1000)
    expect(state.answerText).toHaveBeenCalledExactlyOnceWith('I led the migration.')
  })

  it('starts no countdown and keeps listening when the final transcript is blank', async () => {
    rememberMicrophone({ handsFree: true })
    await speakThenGoQuiet('um')
    await advance(2600)
    expect(recorder.stop).toHaveBeenCalledOnce()
    finishTranscript('')
    expect(recorder.resume).toHaveBeenCalledOnce()
    await advance(10_000)
    expect(screen.queryByText(/Sending in/)).not.toBeInTheDocument()
    expect(state.answerText).not.toHaveBeenCalled()
    expect(recorder.resume).toHaveBeenCalledOnce()
  })

  it('keeps the text after a failed automatic send and does not retry', async () => {
    state.answerText.mockResolvedValue(false)
    rememberMicrophone({ handsFree: true })
    await speakThenGoQuiet()
    await advance(2600)
    finishTranscript('I led the migration.')
    for (const _second of [3, 2, 1]) await advance(1000)
    expect(state.answerText).toHaveBeenCalledOnce()
    await advance(10_000)
    expect(state.answerText).toHaveBeenCalledOnce()
    expect(screen.queryByText(/Sending in/)).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Your answer' })).toHaveValue('I led the migration.')
  })

  it.each([['off', { handsFree: false }, 'browser'], ['in recorded mode', { handsFree: true }, 'recorded']])('never ends an answer on silence when hands-free is %s', async (_label, settings, transcription) => {
    rememberMicrophone(settings, transcription)
    await speakThenGoQuiet()
    await advance(10_000)
    expect(recorder.stop).not.toHaveBeenCalled()
    expect(screen.queryByText(/Sending in/)).not.toBeInTheDocument()
    expect(recorder.options.pauseAtLimit).toBe(false)
  })
})

describe('hands-free setting', () => {
  it('lets the candidate choose and keep the silence length in the room, and the detector waits that long', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      localStorage.setItem('Careerdrafter:interview-transcription:owner', 'browser')
      recorder.microphoneStream = () => ({ getAudioTracks: () => [] })
      vi.stubGlobal('MediaStream', class {})
      let level = 0
      vi.stubGlobal('AudioContext', class {
        state = 'running'
        resume() { return Promise.resolve() }
        close() { return Promise.resolve() }
        createMediaStreamSource() { return { connect() {}, disconnect() {} } }
        createAnalyser() { return { fftSize: 32, getFloatTimeDomainData(target: Float32Array) { target.fill(level) } } }
      })
      renderInterview()
      fireEvent.click(screen.getByRole('button', { name: 'Interview settings' }))
      const silence = screen.getByRole('combobox', { name: 'Silence before your answer ends' })
      expect(silence).toBeDisabled()
      fireEvent.click(screen.getByRole('switch', { name: 'Hands-free mode' }))
      expect(silence).toBeEnabled()
      expect(silence).toHaveValue('2.5')
      fireEvent.change(silence, { target: { value: '4' } })
      expect(JSON.parse(localStorage.getItem('Careerdrafter:interview-microphone:owner') ?? '{}')).toMatchObject({ handsFree: true, silenceSeconds: 4 })
      fireEvent.keyDown(silence, { key: 'Escape' })
      await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
      recorder.status = 'recording'; recorder.transcript = 'I led the migration.'; level = 0.2
      act(() => recorder.refresh())
      await act(async () => { await vi.advanceTimersByTimeAsync(500) })
      level = 0
      await act(async () => { await vi.advanceTimersByTimeAsync(3800) })
      expect(recorder.stop).not.toHaveBeenCalled()
      await act(async () => { await vi.advanceTimersByTimeAsync(300) })
      expect(recorder.stop).toHaveBeenCalledOnce()
    } finally { vi.useRealTimers(); recorder.microphoneStream = () => null }
  })

  it('turns automatic capture on with hands-free in the room, and hands-free off with automatic capture', async () => {
    renderInterview()
    await userEvent.click(screen.getByRole('button', { name: 'Interview settings' }))
    const handsFree = screen.getByRole('switch', { name: 'Hands-free mode' })
    const automatic = screen.getByRole('switch', { name: 'Turn the microphone on automatically' })
    expect(handsFree).not.toBeChecked()
    await userEvent.click(handsFree)
    expect(handsFree).toBeChecked()
    expect(automatic).toBeChecked()
    await userEvent.click(automatic)
    expect(automatic).not.toBeChecked()
    expect(handsFree).not.toBeChecked()
  })

  it('disables hands-free with a reason in recorded mode and keeps the saved choice', async () => {
    localStorage.setItem('Careerdrafter:interview-microphone:owner', JSON.stringify({ automatic: true, seconds: 0, handsFree: true }))
    localStorage.setItem('Careerdrafter:interview-transcription:owner', 'recorded')
    renderInterview()
    await userEvent.click(screen.getByRole('button', { name: 'Interview settings' }))
    expect(screen.getByRole('switch', { name: 'Hands-free mode' })).toBeDisabled()
    expect(screen.getByText(/Hands-free mode needs live transcription/)).toBeVisible()
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Answer transcription' }), 'browser')
    expect(screen.getByRole('switch', { name: 'Hands-free mode' })).toBeEnabled()
    expect(screen.getByRole('switch', { name: 'Hands-free mode' })).toBeChecked()
  })

  it('offers hands-free in setup, turning on automatic capture, and disables it for recorded transcription', async () => {
    stubMicrophoneSupport()
    await renderPracticeRoleSetup()
    await userEvent.click(screen.getByRole('button', { name: 'Continue to settings' }))
    const handsFree = within(screen.getByRole('radiogroup', { name: 'Hands-free' }))
    expect(handsFree.getByRole('radio', { name: 'Off' })).toBeChecked()
    await userEvent.click(handsFree.getByRole('radio', { name: 'On' }))
    expect(screen.getByRole('radio', { name: 'Automatic' })).toBeChecked()
    await userEvent.click(screen.getByRole('radio', { name: 'Tap to start' }))
    expect(handsFree.getByRole('radio', { name: 'Off' })).toBeChecked()
    await userEvent.click(handsFree.getByRole('radio', { name: 'On' }))
    const silence = within(screen.getByRole('radiogroup', { name: 'Silence length' }))
    expect(silence.getByRole('radio', { name: 'Normal 2.5 sec' })).toBeChecked()
    await userEvent.click(silence.getByRole('radio', { name: 'Quick 1.5 sec' }))
    expect(JSON.parse(localStorage.getItem('Careerdrafter:interview-microphone:owner') ?? '{}')).toMatchObject({ handsFree: true, silenceSeconds: 1.5 })
    expect(silence.getByRole('radio', { name: 'Patient 4 sec' })).toBeEnabled()
    await userEvent.click(screen.getByRole('radio', { name: 'Recorded' }))
    expect(handsFree.getByRole('radio', { name: 'On' })).toBeDisabled()
    expect(silence.getByRole('radio', { name: 'Quick 1.5 sec' })).toBeDisabled()
    expect(screen.getByText(/Hands-free mode needs live transcription/)).toBeVisible()
  })
})

describe('streamed interviewer speech', () => {
  class Socket {
    static instances: Socket[] = []
    onopen: (() => void) | null = null
    onmessage: ((event: { data: string }) => void) | null = null
    onclose: (() => void) | null = null
    onerror: (() => void) | null = null
    constructor() { Socket.instances.push(this) }
    send() {}
    close() {}
    receive(value: object) { act(() => this.onmessage?.({ data: JSON.stringify({ version: 1, feature: 'interviews', operation_id: 'turn', attempt_id: 'attempt', claim_generation: 1, ...value }) })) }
  }
  // Streaming is skipped on the last question, so these turns answer the first of two.
  const streamedSnapshot = { ...snapshot, questions: [...snapshot.questions, { ...snapshot.questions[0], id: 'next-question', position: 2, content: 'How do you review code?' }] }
  const speak = vi.fn()
  const cancel = vi.fn()
  const authorize = { request: { query: AUTHORIZE_INTERVIEW_OUTPUT, variables: { input: { feature: 'interviews', operationId: 'turn' } } }, maxUsageCount: Infinity,
    result: { data: { authorizeAiExecutionStream: { __typename: 'AuthorizeAiExecutionStreamPayload', token: 'observer-capability', expiresAt: '2099-12-01T00:01:00Z', errors: [] } } } }
  const answer = { id: 'answer', questionId: 'question', kind: 'answer', position: 2, content: 'I shortened the wait.' }
  const turn = (status: string, failureCode: string | null = null) => ({ id: 'turn', questionId: 'question', messageId: null, kind: 'turn', status, failureCode, checkpoint: null, submissionKey: 'key', canRetry: false })
  function interviewWith(status: string, revision: number, extra: object[] = [], failureCode: string | null = null) {
    return { ...streamedSnapshot, speechPlaybackMode: 'browser', revision, operations: [turn(status, failureCode)], messages: [snapshot.messages[0], answer, ...extra] }
  }
  const followUp = (content: string, acknowledgement: string | null) => ({ id: 'follow-up', questionId: 'question', kind: 'follow_up', position: 3, content, acknowledgement, spokenContent: [acknowledgement, content].filter(Boolean).join('\n\n') })
  async function streamTurn(text: string, beforeSubmit = () => {}) {
    state.interview = { ...streamedSnapshot, speechPlaybackMode: 'browser', operations: [] }
    renderInterview('/practice/interviews/session', [authorize])
    beforeSubmit()
    saveTurn(interviewWith('running', 1))
    await waitFor(() => expect(Socket.instances).toHaveLength(1))
    const socket = Socket.instances[0]
    act(() => socket.onopen?.())
    socket.receive({ type: 'attached' })
    socket.receive({ type: 'delta', text, cursor: '1-0' })
    return socket
  }
  function saveTurn(next: object) {
    state.interview = next
    act(() => recorder.refresh())
  }
  const spoken = () => speak.mock.calls.map(([utterance]) => utterance.text)
  beforeEach(() => {
    Socket.instances = []
    vi.stubGlobal('WebSocket', Socket)
    vi.stubGlobal('speechSynthesis', { speak, cancel })
    vi.stubGlobal('SpeechSynthesisUtterance', class { text: string; onstart: (() => void) | null = null; onend: (() => void) | null = null; onerror: (() => void) | null = null; constructor(text: string) { this.text = text } })
  })
  afterEach(() => {
    performance.clearMeasures()
    for (const stage of ['submit-to-reply', 'reply-to-audio', 'submit-to-audio'] as const) cancelInterviewTiming(stage)
  })

  it('speaks a streamed acknowledgement straight away, then the next question from the saved reply', async () => {
    await streamTurn('You cut the wait.\n\n')
    await waitFor(() => expect(spoken()).toEqual(['You cut the wait.']))
    act(() => speak.mock.calls[0][0].onstart())
    const next = { id: 'question-2', content: 'Tell me about a conflict.', position: 2, acceptedAnswerCount: 0 }
    const opening = { id: 'opening-2', questionId: 'question-2', kind: 'opening', position: 3, content: 'Tell me about a conflict.', acknowledgement: 'You cut the wait.', spokenContent: 'You cut the wait.\n\nTell me about a conflict.' }
    saveTurn({ ...interviewWith('accepted', 2, [opening]), currentQuestionPosition: 2, questions: [...snapshot.questions, next] })
    act(() => speak.mock.calls[0][0].onend())
    await waitFor(() => expect(spoken()).toEqual(['You cut the wait.', 'Tell me about a conflict.']))
    act(() => speak.mock.calls[1][0].onend())
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)))
    expect(spoken()).toEqual(['You cut the wait.', 'Tell me about a conflict.'])
  })

  it('stops the voice and leaves the saved reply to read when it differs from speech already heard', async () => {
    await streamTurn('You cut the wait.\n\nHow')
    await waitFor(() => expect(spoken()).toEqual(['You cut the wait.']))
    act(() => speak.mock.calls[0][0].onstart())
    saveTurn(interviewWith('accepted', 2, [followUp('What changed for the team?', 'You reduced the wait.')]))
    const room = within(screen.getByRole('region', { name: 'Current interview turn' }))
    expect(room.getByText('What changed for the team?')).toBeVisible()
    expect(cancel).toHaveBeenCalled()
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)))
    // Nothing already said is spoken again; the candidate can still replay the saved reply.
    expect(spoken()).toEqual(['You cut the wait.'])
    expect(room.getByRole('button', { name: 'Play interviewer audio' })).toBeEnabled()
  })

  it('speaks the saved reply as usual when it differs before any streamed speech was heard', async () => {
    await streamTurn('You cut the wait.\n\nHow')
    await waitFor(() => expect(spoken()).toEqual(['You cut the wait.']))
    saveTurn(interviewWith('accepted', 2, [followUp('What changed for the team?', 'You reduced the wait.')]))
    await waitFor(() => expect(spoken()).toEqual(['You cut the wait.', 'You reduced the wait.']))
  })

  it('carries on with the rest of the saved reply when the stream ends early, without repeating what was said', async () => {
    const socket = await streamTurn('You cut the wait.\n\nHow')
    await waitFor(() => expect(spoken()).toEqual(['You cut the wait.']))
    act(() => speak.mock.calls[0][0].onstart())
    // The relay can end the stream just as the turn is accepted.
    socket.receive({ type: 'reset', code: 'saved_state_required' })
    expect(cancel).not.toHaveBeenCalled()
    saveTurn(interviewWith('accepted', 2, [followUp('How did you measure it?', 'You cut the wait.')]))
    expect(within(screen.getByRole('region', { name: 'Current interview turn' })).getByText('How did you measure it?')).toBeVisible()
    act(() => speak.mock.calls[0][0].onend())
    await waitFor(() => expect(spoken()).toEqual(['You cut the wait.', 'How did you measure it?']))
  })

  it('stops the voice and shows the answer failure when the turn fails after speech began', async () => {
    await streamTurn('You cut the wait.\n\nHow')
    await waitFor(() => expect(spoken()).toEqual(['You cut the wait.']))
    act(() => speak.mock.calls[0][0].onstart())
    saveTurn(interviewWith('failed', 2, [], 'provider_error'))
    expect(cancel).toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('Answer failed: provider error.')
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)))
    expect(spoken()).toEqual(['You cut the wait.'])
  })

  it('measures streamed speech as its own mode when the first sentence starts before the saved reply', async () => {
    await streamTurn('You cut the wait.\n\nHow', () => {
      startInterviewTiming('submit-to-reply')
      startInterviewTiming('submit-to-audio', { mode: 'browser' })
    })
    await waitFor(() => expect(spoken()).toEqual(['You cut the wait.']))
    act(() => speak.mock.calls[0][0].onstart())
    const entries = performance.getEntriesByName('interview:submit-to-audio') as PerformanceMeasure[]
    expect(entries.map((entry) => entry.detail)).toEqual([{ mode: 'browser-streamed' }])
  })

  it('measures streamed speech as its own mode, even when the saved reply arrives before the first sentence', async () => {
    await streamTurn('You cut the wait', () => {
      startInterviewTiming('submit-to-reply')
      startInterviewTiming('submit-to-audio', { mode: 'browser' })
    })
    expect(speak).not.toHaveBeenCalled()
    saveTurn(interviewWith('accepted', 2, [followUp('How did you measure it?', 'You cut the wait.')]))
    await waitFor(() => expect(spoken()).toEqual(['You cut the wait.']))
    act(() => speak.mock.calls[0][0].onstart())
    for (const stage of ['submit-to-audio', 'reply-to-audio']) {
      const entries = performance.getEntriesByName(`interview:${stage}`) as PerformanceMeasure[]
      expect(entries.map((entry) => entry.detail)).toEqual([{ mode: 'browser-streamed' }])
    }
  })
})
