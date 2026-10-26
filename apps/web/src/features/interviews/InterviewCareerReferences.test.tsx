/** Exercise saved references and queued recovery through Apollo without recording or paid providers. */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen } from '@testing-library/react'
import type { MockLink } from '@apollo/client/testing'
import { renderPage } from '@/test/renderPage'
import type { InterviewSnapshotFragment } from '@/graphql/generated/graphql'
import { InterviewCareerReferences } from './InterviewCareerReferences'
import { REQUEST_INTERVIEW_REFERENCES } from './interviewOperations'
import { AI_TASK_UPDATED_SUBSCRIPTION } from '@/features/ai-tasks/aiTaskOperations'

type Saved = NonNullable<InterviewSnapshotFragment['messages'][number]['careerReferences']> & { __typename?: 'InterviewCareerReferences' }
const body = 'I rebuilt the deployment checks and reduced failed releases.'
const entry = { __typename: 'CareerReference' as const, sourceType: 'ExperienceHighlight', sourceId: 'highlight', title: 'Engineer at Acme', body }
const saved: Saved = { __typename: 'InterviewCareerReferences', id: 'references', status: 'queued', attemptCount: 1, aiTaskId: 'task', deadline: '2099-01-01T00:00:00Z', references: [] }
const message = { __typename: 'InterviewSessionMessage', id: 'opening', questionId: 'question', kind: 'opening', position: 0,
  content: 'Describe an improvement you made.', avoided: false, acknowledgement: null, spokenContent: 'Describe an improvement you made.', clarification: null, careerReferences: null } as InterviewSnapshotFragment['messages'][number]
function renderReferences(record: Saved | null = null, mocks: MockLink.MockedResponse[] = []) {
  return renderPage({ path: '/test', url: '/test', mocks, element: <><textarea aria-label="Your answer" defaultValue="My own answer" /><InterviewCareerReferences interviewId="interview" message={{ ...message, careerReferences: record }} disabled={false} /></> })
}
function requestMock(retryFailed = false, attemptCount = 1) {
  return { request: { query: REQUEST_INTERVIEW_REFERENCES, variables: { input: { interviewId: 'interview', messageId: 'opening', retryFailed } } },
    result: { data: { requestInterviewReferences: { __typename: 'RequestInterviewReferencesPayload', careerReferences: { ...saved, attemptCount, aiTaskId: attemptCount === 2 ? 'task-2' : 'task' }, errors: [] } } } }
}
function taskMock(status = 'COMPLETED', id = 'task', references = [entry]) {
  return { request: { query: AI_TASK_UPDATED_SUBSCRIPTION, variables: { id } }, result: { data: { aiTaskUpdated: {
    __typename: 'AiTask', id, taskType: 'INTERVIEW_REFERENCES', status,
    result: status === 'COMPLETED' ? { references: references.map((item) => ({ source_type: item.sourceType, source_id: item.sourceId, title: item.title, body: item.body })) } : null,
    input: {}, pendingQuestions: [], errorMessage: status === 'FAILED' ? 'References failed' : null, acceptedAt: null, createdAt: '2026-10-27', job: null,
  } } } }
}
afterEach(() => { cleanup(); vi.useRealTimers() })
it('offers a separate reference action without changing the answer draft', () => {
  renderReferences()
  expect(screen.getByRole('button', { name: 'Show career examples' })).toBeEnabled()
  fireEvent.change(screen.getByRole('textbox', { name: 'Your answer' }), { target: { value: 'Still my answer' } })
  expect(screen.getByRole('textbox', { name: 'Your answer' })).toHaveValue('Still my answer')
})
it('requests only prompt identity, displays the live saved wording and keeps answering available', async () => {
  const mock = requestMock()
  const result = vi.fn(() => mock.result)
  renderReferences(null, [{ ...mock, result, delay: 20 }, taskMock()])
  fireEvent.click(screen.getByRole('button', { name: 'Show career examples' }))
  expect(screen.getByRole('textbox', { name: 'Your answer' })).toBeEnabled()
  expect(await screen.findByText(body)).toBeVisible()
  expect(screen.getByText('Engineer at Acme')).toBeVisible()
  expect(screen.getByRole('textbox', { name: 'Your answer' })).toHaveValue('My own answer')
  fireEvent.click(screen.getByRole('button', { name: 'Hide career examples' }))
  expect(screen.queryByText(body)).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Show career examples' }))
  expect(screen.getByText(body)).toBeVisible()
  expect(result).toHaveBeenCalledOnce()
})
it('reopens saved references without another retrieval or task subscription', () => {
  renderReferences({ ...saved, status: 'completed', references: [entry] })
  expect(screen.queryByText(body)).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Show career examples' }))
  expect(screen.getByText(body)).toBeVisible()
})
it('shows an honest empty outcome and does not retry successful empty work', async () => {
  const mock = requestMock()
  const result = vi.fn(() => mock.result)
  renderReferences(null, [{ ...mock, result }, taskMock('COMPLETED', 'task', [])])
  fireEvent.click(screen.getByRole('button', { name: 'Show career examples' }))
  expect(await screen.findByText('No relevant saved examples found for this question.')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Hide career examples' }))
  fireEvent.click(screen.getByRole('button', { name: 'Show career examples' }))
  expect(result).toHaveBeenCalledOnce()
})
it('offers explicit retry after a saved deadline without polling', async () => {
  renderReferences({ ...saved, deadline: '2020-01-01T00:00:00Z' }, [taskMock('QUEUED'), requestMock(true, 2), taskMock('COMPLETED', 'task-2')])
  fireEvent.click(screen.getByRole('button', { name: 'Show career examples' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Retry career examples' }))
  expect(await screen.findByText(body)).toBeVisible()
})
it('does not offer a third attempt and preserves the independent answer', async () => {
  renderReferences({ ...saved, status: 'failed', attemptCount: 2 }, [taskMock('FAILED')])
  fireEvent.click(screen.getByRole('button', { name: 'Show career examples' }))
  expect(screen.getByText(/reached its career example retry limit/)).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Retry career examples' })).not.toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: 'Your answer' })).toBeEnabled()
})
it('allows checking saved status after a lost request receipt', async () => {
  const mock = requestMock()
  renderReferences(null, [{ request: mock.request, error: new Error('lost receipt') }, requestMock(true), taskMock()])
  fireEvent.click(screen.getByRole('button', { name: 'Show career examples' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not confirm career examples')
  fireEvent.click(screen.getByRole('button', { name: 'Retry career examples' }))
  expect(await screen.findByText(body)).toBeVisible()
})
