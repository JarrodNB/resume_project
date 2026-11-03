/**
 * Description: Set page tests: generation restoration, failures, individual questions,
 * and the warning when leaving with unsaved answers.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { expect, it } from 'vitest'
import { renderPage } from '@/test/renderPage'
import { AI_TASK_UPDATED_SUBSCRIPTION } from '@/features/ai-tasks/aiTaskOperations'
import { InterviewSetPage } from './InterviewSetPage'
import { INTERVIEW_SET_QUERY } from './interviewPrepOperations'

/** Supplies the shared subscription's full task shape. */
function taskFixture(status: 'QUEUED' | 'COMPLETED' | 'FAILED') {
  return { __typename: 'AiTask', id: 'task-1', status, taskType: 'GENERATE_INTERVIEW_QUESTIONS', errorMessage: status === 'FAILED' ? 'Add more career library details.' : null, result: null, input: {}, pendingQuestions: [], acceptedAt: null, createdAt: '2026-10-11T00:00:00Z', job: null }
}
/** Builds the detail response, intentionally returning questions in reverse order. */
function setMock(status: 'QUEUED' | 'COMPLETED' | 'FAILED', answered: number[] = []) {
  return { request: { query: INTERVIEW_SET_QUERY, variables: { id: 'set-1' } }, result: { data: { interviewQuestionSet: {
    __typename: 'InterviewQuestionSet', id: 'set-1', number: 1, setType: 'TECHNICAL', createdAt: '2026-10-11T00:00:00Z', latestTask: taskFixture(status),
    questions: status === 'COMPLETED' ? [5, 4, 3, 2, 1].map((position) => ({ __typename: 'InterviewQuestion', id: `question-${position}`, avoided: false, position, questionText: `Saved question text ${position}`, answerText: answered.includes(position) ? `Answer ${position}` : '', answerRevision: 1, questionRevision: 1, feedbackQuestionRevision: null, feedbackAnswerRevision: null, feedback: {}, feedbackOutdated: false, latestTask: null })) : [],
  } } } }
}
function render(url: string, mocks: unknown[]) {
  return renderPage({ path: '/practice/questions/:id/:questionId?', url, element: <InterviewSetPage />, mocks: mocks as never,
    extraRoutes: [{ path: '/practice/questions', element: <p>Question bank</p> }] })
}

it('restores a queued task on reload and opens the first question on live completion', async () => {
  const { router } = render('/practice/questions/set-1', [setMock('QUEUED'), {
    request: { query: AI_TASK_UPDATED_SUBSCRIPTION, variables: { id: 'task-1' } }, delay: 500,
    result: { data: { aiTaskUpdated: taskFixture('COMPLETED') } },
  }, setMock('COMPLETED')])
  expect(await screen.findByRole('status')).toHaveTextContent('Generating questions…')
  expect(await screen.findByRole('heading', { level: 2, name: 'Saved question text 1' })).toBeVisible()
  expect(screen.queryByText('Generating questions…')).not.toBeInTheDocument()
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Practice question')
  expect(screen.getByText(/Technical/)).toBeInTheDocument()
  expect(screen.queryByRole('navigation', { name: /set/i })).not.toBeInTheDocument()
  expect(screen.queryByText(/Question \d of \d|Set 1/)).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Dismiss|Delete/ })).not.toBeInTheDocument()
  await waitFor(() => expect(router.state.location.pathname).toBe('/practice/questions/set-1/question-1'))
})

it('opens the first unanswered question and keeps it open after saving elsewhere', async () => {
  const { router } = render('/practice/questions/set-1', [setMock('COMPLETED', [1, 2])])
  expect(await screen.findByRole('heading', { level: 2, name: 'Saved question text 3' })).toBeVisible()
  await waitFor(() => expect(router.state.location.pathname).toBe('/practice/questions/set-1/question-3'))
  expect(screen.queryByRole('heading', { level: 2, name: 'Saved question text 1', hidden: true })).not.toBeInTheDocument()
})

it('keeps the draft on canceled navigation and discards only after confirmation', async () => {
  const { router } = render('/practice/questions/set-1/question-2', [setMock('COMPLETED')])
  fireEvent.change(await screen.findByRole('textbox', { name: 'Your answer' }), { target: { value: 'Draft for two' } })
  fireEvent.click(screen.getByRole('link', { name: 'All questions' }))
  expect(await screen.findByText(/Leave and discard/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
  expect(router.state.location.pathname).toBe('/practice/questions/set-1/question-2')
  expect(screen.getByRole('textbox', { name: 'Your answer' })).toHaveValue('Draft for two')
  fireEvent.click(screen.getByRole('link', { name: 'All questions' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Leave page' }))
  expect(await screen.findByText('Question bank')).toBeInTheDocument()
})

it('restores failure details and keeps dismissal available', async () => {
  render('/practice/questions/set-1', [setMock('FAILED')])
  expect(await screen.findByText('Add more career library details.')).toBeInTheDocument()
  expect(screen.getByText('Question generation failed')).toBeInTheDocument()
  expect(screen.queryByText('Generating questions…')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Dismiss question generation' })).toBeEnabled()
})

it('shows the persisted knowledge type on reload', async () => {
  const mock = setMock('COMPLETED')
  mock.result.data.interviewQuestionSet.setType = 'KNOWLEDGE'
  render('/practice/questions/set-1', [mock])
  expect(await screen.findByText(/Knowledge/)).toBeInTheDocument()
  expect(screen.getAllByRole('textbox', { name: 'Your answer' })).toHaveLength(1)
})

it('keeps generation progress visible when live updates disconnect', async () => {
  render('/practice/questions/set-1', [setMock('QUEUED'), {
    request: { query: AI_TASK_UPDATED_SUBSCRIPTION, variables: { id: 'task-1' } }, error: new Error('Connection interrupted'),
  }])
  expect(await screen.findByRole('status')).toHaveTextContent('Generating questions…')
  expect(await screen.findByText('Live updates disconnected')).toBeInTheDocument()
})
