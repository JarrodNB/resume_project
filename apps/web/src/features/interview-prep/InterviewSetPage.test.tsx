/**
 * Description: Persisted generation restoration, live completion, failures, and ordered cards.
 * Index: taskFixture, setMock
 */
import { fireEvent, screen } from '@testing-library/react'
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
function setMock(status: 'QUEUED' | 'COMPLETED' | 'FAILED') {
  return { request: { query: INTERVIEW_SET_QUERY, variables: { id: 'set-1' } }, result: { data: { interviewQuestionSet: {
    __typename: 'InterviewQuestionSet', id: 'set-1', number: 1, setType: 'TECHNICAL', createdAt: '2026-10-11T00:00:00Z', latestTask: taskFixture(status),
    questions: status === 'COMPLETED' ? [5, 4, 3, 2, 1].map((position) => ({ __typename: 'InterviewQuestion', id: `question-${position}`, avoided: false, position, questionText: `Saved question text ${position}`, answerText: '', answerRevision: 1, questionRevision: 1, feedbackQuestionRevision: null, feedbackAnswerRevision: null, feedback: {}, feedbackOutdated: false, latestTask: null })) : [],
  } } } }
}

it('restores a queued task on reload and fetches five saved cards on live completion', async () => {
  renderPage({ path: '/interview-prep/:id', url: '/interview-prep/set-1', element: <InterviewSetPage />, mocks: [setMock('QUEUED'), {
    request: { query: AI_TASK_UPDATED_SUBSCRIPTION, variables: { id: 'task-1' } }, delay: 500,
    result: { data: { aiTaskUpdated: taskFixture('COMPLETED') } },
  }, setMock('COMPLETED')] })
  expect(await screen.findByRole('status')).toHaveTextContent('Generating questions…')
  expect(await screen.findByRole('button', { name: 'Question 1' })).toBeInTheDocument()
  expect(screen.queryByText('Generating questions…')).not.toBeInTheDocument()
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Technical')
  expect(screen.getAllByRole('button', { name: /Question \d/ }).map((button) => button.textContent)).toEqual(['Question 1', 'Question 2', 'Question 3', 'Question 4', 'Question 5'])
  expect(screen.queryByText('Questions ready.')).not.toBeInTheDocument()
  expect(screen.queryByText('Saved question text 1')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Question 1' }))
  expect(screen.getByText('Saved question text 1')).toBeInTheDocument()
})

it('restores failure details and keeps deletion available', async () => {
  renderPage({ path: '/interview-prep/:id', url: '/interview-prep/set-1', element: <InterviewSetPage />, mocks: [setMock('FAILED')] })
  expect(await screen.findByText('Add more career library details.')).toBeInTheDocument()
  expect(screen.getByText('Question generation failed')).toBeInTheDocument()
  expect(screen.queryByText('Generating questions…')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Delete set 1' })).toBeEnabled()
})

it('shows the persisted knowledge type and saved cards on reload', async () => {
  const mock = setMock('COMPLETED')
  mock.result.data.interviewQuestionSet.setType = 'KNOWLEDGE'
  renderPage({ path: '/interview-prep/:id', url: '/interview-prep/set-1', element: <InterviewSetPage />, mocks: [mock] })
  expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Knowledge')
  expect(screen.getAllByRole('button', { name: /Question \d/ })).toHaveLength(5)
})


it('keeps generation progress visible when live updates disconnect', async () => {
  renderPage({ path: '/interview-prep/:id', url: '/interview-prep/set-1', element: <InterviewSetPage />, mocks: [setMock('QUEUED'), {
    request: { query: AI_TASK_UPDATED_SUBSCRIPTION, variables: { id: 'task-1' } }, error: new Error('Connection interrupted'),
  }] })
  expect(await screen.findByRole('status')).toHaveTextContent('Generating questions…')
  expect(await screen.findByText('Live updates disconnected')).toBeInTheDocument()
})
