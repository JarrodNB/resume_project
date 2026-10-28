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
import { AVOID_INTERVIEW_PROMPT, REQUEST_INTERVIEW_CLARIFICATION, INTERVIEW_PLAYBACK, REQUEST_INTERVIEW_REFERENCES } from './interviewOperations'
import { JOBS_QUERY } from '@/features/jobs/jobsOperations'
const { state, recorder, start } = vi.hoisted(() => ({
  state: { interview: null as unknown, loading: false, loadError: null as unknown, subscriptionError: null, busy: false, error: null, unresolved: null as unknown, transcribeRecording: vi.fn(), cancelTranscription: vi.fn(), answer: vi.fn(), answerText: vi.fn(), checkSavedStatus: vi.fn(), retryOperation: vi.fn(), beginInterview: vi.fn(), abandonInterview: vi.fn(), skipQuestion: vi.fn() },
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
  setup: { questionCount: 9, questionFormat: 'mixed', difficulty: 'realistic', interviewer: 'daniel', focusAreas: [] },
  id: 'session', status: 'active', interviewType: 'basic', executionMode: 'real', speechPlaybackMode: 'provider', revision: 0, answerCap: 2, currentQuestionPosition: 1, expiresAt: '2099-10-27',
  questions: [{ id: 'question', content: 'Describe a project.', position: 1, acceptedAnswerCount: 0 }],
  messages: [{ id: 'opening', questionId: 'question', kind: 'opening', position: 1, content: 'Describe a project.', careerReferences: { id: 'saved-references', status: 'empty', attemptCount: 1, aiTaskId: null, deadline: null, references: [] } }],
  operations: [{ id: 'speech', questionId: 'question', messageId: 'opening', kind: 'speech', status: 'accepted', failureCode: null, checkpoint: null, submissionKey: null, canRetry: true }],
}
function renderInterview(url = '/practice/interviews/session', mocks: MockLink.MockedResponse[] = [], savedJobs = jobsMock(), historyState?: unknown) { return renderPage({ path: '/practice/interviews/:id?', url, historyState, mocks: [...mocks, savedJobs], element: <InterviewPage />, extraRoutes: [{ path: '/practice/questions', element: <p>Written practice</p> }, { path: '/jobs/:jobId/interview', element: <p>Job practice setup</p> }] }) }
type SavedJob = { id: string; title: string; company: string | null; stage: 'UNAPPLIED' | 'APPLIED' | 'INTERVIEWING' | 'REJECTED' | 'OFFER' }
/** Saved jobs offered on the role step; mocked on every render so setup never waits on an unmocked query. */
function jobsMock(jobs: SavedJob[] = []): MockLink.MockedResponse {
  return { request: { query: JOBS_QUERY }, result: { data: { jobs: jobs.map((job) => ({ __typename: 'Job' as const, location: null, createdAt: '2026-10-01T00:00:00Z', ...job })) } } }
}
/** Opens the mock interview overview and picks the default practice role, landing on round setup. */
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
beforeEach(() => { localStorage.clear(); recorder.candidateTranscript = null; recorder.transcript = ''; recorder.effectiveMode = 'browser'; recorder.fallbackReason = null; vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:preview'), revokeObjectURL: vi.fn() })); state.interview = structuredClone(snapshot); state.busy = false; state.error = null; state.unresolved = null; state.loadError = null; recorder.status = 'idle'; recorder.recording = null; recorder.error = null; vi.clearAllMocks(); vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(); vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {}); state.answer.mockResolvedValue(true); state.transcribeRecording.mockResolvedValue('capture'); state.cancelTranscription.mockResolvedValue(true) })
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
describe('InterviewPage', () => {
  it.each(['preparing', 'ready'])('identifies the saved job and return path when resuming %s preparation', (status) => {
    state.interview = { ...snapshot, status, preparedRole: { title: 'Original laboratory technician', requirements: [], responsibilities: [] },
      jobContext: { id: 'job-1', title: 'Original laboratory technician', company: 'Original Labs', description: null, requirements: [], responsibilities: [], niceToHaves: [] } }
    renderInterview()
    expect(screen.getByText('Original Labs')).toBeVisible()
    expect(screen.getByRole('link', { name: 'Back to job' })).toHaveAttribute('href', '/jobs/job-1')
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
  it('reviews the saved job snapshot without labelling it as a fictional role', async () => {
    state.interview = { ...snapshot, status: 'ready', preparedRole: { title: 'Laboratory technician', requirements: [], responsibilities: [] },
      jobContext: { id: 'job-1', title: 'Laboratory technician', company: 'Sample Labs', description: null, requirements: [], responsibilities: [], niceToHaves: [] } }
    renderInterview()
    expect(screen.getByRole('heading', { name: 'Review your saved job' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Laboratory technician' })).toBeVisible()
    expect(screen.queryByText(/imagined vacancy/)).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Enter interview room' }))
    expect(state.beginInterview).toHaveBeenCalledOnce()
  })

  it('locks setup while preparation is pending and permits retry after failure', async () => {
    let finish!: (id: null) => void
    start.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    await renderPracticeRoleSetup()
    fireEvent.click(screen.getByRole('button', { name: 'Prepare interview' }))
    expect(screen.getByRole('button', { name: 'Preparing…' })).toBeDisabled()
    expect(screen.getByRole('radio', { name: /Mixed Interview/ })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Preparing…' }))
    expect(start).toHaveBeenCalledOnce()
    await act(async () => finish(null))
    expect(screen.getByRole('button', { name: 'Prepare interview' })).toBeEnabled()
    expect(screen.getByRole('radio', { name: /Mixed Interview/ })).toBeChecked()
    expect(recorder.start).not.toHaveBeenCalled()
  })

  it('shares microphone preferences from setup without starting capture', async () => {
    const view = await renderPracticeRoleSetup()
    await userEvent.click(screen.getByRole('switch', { name: 'Turn the microphone on automatically' }))
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Thinking time before the mic opens' }), '10')
    expect(recorder.start).not.toHaveBeenCalled()
    view.unmount()
    renderInterview()
    await userEvent.click(screen.getByRole('button', { name: 'Interview settings' }))
    expect(screen.getByRole('switch', { name: 'Turn the microphone on automatically' })).toBeChecked()
    expect(screen.getByRole('combobox', { name: 'Thinking time before the mic opens' })).toHaveValue('10')
  })

  it('submits selected difficulty, interviewer and optional focus areas', async () => {
    await renderPracticeRoleSetup()
    await userEvent.click(screen.getByRole('radio', { name: /Stretch/ }))
    await userEvent.click(screen.getByRole('radio', { name: /Priya/ }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Leadership' }))
    await userEvent.click(screen.getByRole('button', { name: 'Prepare interview' }))
    expect(start).toHaveBeenCalledWith('', { questionCount: 8, questionFormat: 'mixed', difficulty: 'stretch', interviewer: 'priya', focusAreas: ['leadership'] })
  })
  it('passes the selected question format with the requested length', async () => {
    await renderPracticeRoleSetup()
    await userEvent.click(screen.getByRole('radio', { name: /HR Screening/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Prepare interview' }))
    expect(start).toHaveBeenCalledWith('', { questionCount: 8, questionFormat: 'screening', difficulty: 'realistic', interviewer: 'daniel', focusAreas: [] })
  })
  it('defaults to eight core questions and sends the selected interview length', async () => {
    await renderPracticeRoleSetup()
    expect(screen.getByRole('radio', { name: /Standard/ })).toBeChecked()
    await userEvent.click(screen.getByRole('radio', { name: /Full loop/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Prepare interview' }))
    expect(start).toHaveBeenCalledWith('', { questionCount: 12, questionFormat: 'mixed', difficulty: 'realistic', interviewer: 'daniel', focusAreas: [] })
  })
  it('clarifies the latest follow-up while preserving typed draft and progress', async () => {
    state.interview = { ...snapshot, messages: [...snapshot.messages,
      { ...snapshot.messages[0], id: 'follow-up', kind: 'follow_up', content: 'How did you test it?' }] }
    renderInterview('/practice/interviews/session', [{ request: { query: REQUEST_INTERVIEW_CLARIFICATION,
      variables: { input: { interviewId: 'session', messageId: 'follow-up', retryFailed: false } } },
      result: { data: { requestInterviewClarification: { __typename: 'RequestInterviewClarificationPayload', errors: [],
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
    recorder.status = 'ready'; recorder.recording = recording
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
    ['ready', 'Review your recording'],
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
    expect(await screen.findByText('Interview ended. You can prepare another whenever you’re ready.')).toBeVisible()
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
    await userEvent.click(screen.getByRole('button', { name: 'Prepare interview' }))
    expect(start).toHaveBeenCalledWith('', { questionCount: 8, questionFormat: 'mixed', difficulty: 'realistic', interviewer: 'daniel', focusAreas: [] })
  })
  it('retires old scripted sessions without recording or retry controls', () => {
    state.interview = { ...snapshot, executionMode: 'fake' }
    renderInterview()
    expect(screen.getByText(/older scripted session is retired/i)).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Record answer' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Start a new interview' })).toBeVisible()
  })
  it('reviews after Stop recording without uploading until explicit Transcribe', async () => {
    recorder.status = 'recording'
    renderInterview()
    const answerActions = within(screen.getByRole('group', { name: 'Answer controls' }))
    expect(answerActions.getByRole('button', { name: 'Stop recording' })).toBeEnabled()
    expect(answerActions.getByRole('button', { name: 'Submit answer' })).toBeDisabled()
    await userEvent.dblClick(screen.getByRole('button', { name: 'Stop recording' }))
    expect(state.answer).not.toHaveBeenCalled()
    recorder.status = 'ready'; recorder.recording = new Blob(['answer'], { type: 'audio/webm' })
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
  it('never submits a ready blob without explicit Stop recording intent', () => {
    recorder.status = 'ready'; recorder.recording = new Blob(['answer'], { type: 'audio/webm' })
    renderInterview()
    expect(state.answer).not.toHaveBeenCalled()
  })
  it('locks conflicting actions and prevents duplicate explicit submissions', async () => {
    recorder.status = 'ready'; recorder.recording = new Blob(['answer'], { type: 'audio/webm' })
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
    recorder.status = 'ready'; recorder.recording = new Blob(['answer'])
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
    recorder.status = 'ready'; recorder.recording = new Blob(['audio'], { type: 'audio/webm' })
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
    expect(screen.getByRole('button', { name: 'Prepare interview' })).toBeVisible()
  })
})

it('shows durable preparation progress and retry without recording controls', async () => {
  state.interview = { ...snapshot, status: 'preparing', questions: [], messages: [], operations: [
    { ...snapshot.operations[0], id: 'prep', kind: 'preparation', status: 'failed', canRetry: true, failureCode: 'dependency_unavailable' },
  ] }
  renderInterview()
  expect(screen.getByRole('heading', { name: 'Preparing your interview' })).toBeVisible()
  expect(screen.getByText(/fictional role and 9 core questions/)).toBeVisible()
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
  await userEvent.click(screen.getByRole('button', { name: 'Prepare interview' }))
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
  localStorage.setItem('Careergrind:interview-transcription:owner', 'recorded')
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
  fireEvent.click(screen.getByRole('button', { name: 'Stop recording' }))
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
  expect(within(group).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
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
  await userEvent.click(screen.getByRole('button', { name: 'Fictional role' }))
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
  fireEvent.click(screen.getByRole('button', { name: 'Stop recording to transcribe' }))
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
  expect(screen.getByRole('checkbox', { name: 'Leadership' })).toBeChecked()
  expect(start).not.toHaveBeenCalled()
  expect(state.beginInterview).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Prepare interview' }))
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
  fireEvent.click(screen.getByRole('button', { name: 'Prepare interview' }))
  expect(start).toHaveBeenCalledWith('', { questionCount: 8, questionFormat: 'mixed', difficulty: 'realistic', interviewer: 'daniel', focusAreas: ['leadership'] })
})

it('saves the visible follow-up after retry while preserving text and recording', async () => {
  state.interview = { ...snapshot, messages: [...snapshot.messages, { ...snapshot.messages[0], id: 'follow-up', position: 2, kind: 'follow_up', content: 'What changed afterward?', avoided: false }] }
  recorder.recording = new Blob(['saved audio'])
  recorder.status = 'ready'
  const request = { query: AVOID_INTERVIEW_PROMPT, variables: { interviewId: 'session', messageId: 'follow-up' } }
  renderInterview('/practice/interviews/session', [
    { request, result: { data: { avoidInterviewPrompt: { __typename: 'AvoidInterviewPromptPayload', saved: false, errors: ['Try saving again.'] } } } },
    { request, result: { data: { avoidInterviewPrompt: { __typename: 'AvoidInterviewPromptPayload', saved: true, errors: [] } } } },
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
    variables: { input: { interviewId: 'session', messageId: 'opening', retryFailed: false } } }, delay: 30,
    result: { data: { requestInterviewReferences: { __typename: 'RequestInterviewReferencesPayload', errors: [], careerReferences: {
      __typename: 'InterviewCareerReferences', id: 'references', status: 'empty', attemptCount: 1, aiTaskId: null, deadline: null, references: [],
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
  it('offers a practice role and every saved job except rejected ones', async () => {
    renderInterview('/practice/interviews', [], jobsMock(savedJobs))
    const group = screen.getByRole('group', { name: 'Interview for' })
    expect(within(group).getByRole('radio', { name: /A practice role/ })).toBeChecked()
    expect(await within(group).findByRole('radio', { name: /Laboratory technician.*Sample Labs · Applied/ })).not.toBeChecked()
    expect(within(group).getByRole('radio', { name: /Quality analyst.*Unknown company · Not applied/ })).toBeVisible()
    expect(within(group).queryByRole('radio', { name: /Rejected role/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Prepare interview' })).not.toBeInTheDocument()
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
    expect(screen.getByRole('button', { name: 'Prepare interview' })).toBeVisible()
    expect(screen.queryByRole('group', { name: 'Interview for' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Change role' }))
    expect(screen.getByRole('heading', { name: 'Who is this interview for?' })).toBeVisible()
    expect(screen.getByRole('radio', { name: /A practice role/ })).toBeChecked()
    expect(screen.queryByRole('button', { name: 'Prepare interview' })).not.toBeInTheDocument()
  })
  it('still allows a practice role when saved jobs fail to load', async () => {
    renderInterview('/practice/interviews', [], { request: { query: JOBS_QUERY }, error: new Error('network down') })
    expect(await screen.findByText(/Couldn’t load saved jobs/)).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByRole('button', { name: 'Prepare interview' })).toBeVisible()
  })
  it('points to job search when there are no saved jobs to practise for', async () => {
    renderInterview('/practice/interviews', [], jobsMock([savedJobs[2]]))
    expect(await screen.findByRole('link', { name: 'Find jobs' })).toHaveAttribute('href', '/jobs/find')
    expect(screen.getAllByRole('radio')).toHaveLength(1)
  })
  it('starts at round setup with the saved choices when practising again', () => {
    renderInterview('/practice/interviews', [], jobsMock(), { practiceSetup: { ...snapshot.setup, difficulty: 'stretch' } })
    expect(screen.getByRole('radio', { name: /Stretch/ })).toBeChecked()
    expect(screen.getByRole('button', { name: 'Change role' })).toBeVisible()
    expect(screen.queryByRole('heading', { name: 'Who is this interview for?' })).not.toBeInTheDocument()
  })
})
