/** Observe saved reuse, live queue results and explicit recovery through Apollo, without browser providers. */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { MockLink } from '@apollo/client/testing'
import { renderPage } from '@/test/renderPage'
import type { InterviewSnapshotFragment } from '@/graphql/generated/graphql'
import { InterviewClarification } from './InterviewClarification'
import { REQUEST_INTERVIEW_CLARIFICATION } from './interviewOperations'
import { AI_TASK_UPDATED_SUBSCRIPTION } from '@/features/ai-tasks/aiTaskOperations'

const explanation = 'Describe which competing priorities you balanced and what you chose.'
type Saved = NonNullable<InterviewSnapshotFragment['messages'][number]['clarification']> & { __typename?: 'InterviewClarification' }
const saved: Saved = { __typename: 'InterviewClarification' as const, id: 'clarification', status: 'queued', explanation: null, attemptCount: 1, aiTaskId: 'task', deadline: '2099-01-01T00:00:00Z' }
const message = { __typename: 'InterviewSessionMessage', id: 'follow-up', questionId: 'question', kind: 'follow_up', position: 2,
  content: 'What trade-off did you make?', avoided: false, acknowledgement: 'You repaired the scheduler.', spokenContent: 'ack plus question', clarification: null, careerReferences: null } as InterviewSnapshotFragment['messages'][number]
function renderClarification(record: Saved | null = null, mocks: MockLink.MockedResponse[] = []) {
  return renderPage({ path: '/test', url: '/test', mocks, element: <div role="group" aria-label="Question controls"><InterviewClarification interviewId="interview" message={{ ...message, clarification: record }} disabled={false} /></div> })
}
function requestMock(retryFailed = false, attemptCount = 1) {
  return { request: { query: REQUEST_INTERVIEW_CLARIFICATION, variables: { input: { interviewId: 'interview', messageId: 'follow-up', retryFailed } } },
    result: { data: { requestInterviewClarification: { __typename: 'RequestInterviewClarificationPayload', clarification: { ...saved, attemptCount, aiTaskId: attemptCount === 2 ? 'task-2' : 'task' }, errors: [] } } } }
}
function taskMock(status = 'COMPLETED', id = 'task') {
  return { request: { query: AI_TASK_UPDATED_SUBSCRIPTION, variables: { id } }, result: { data: { aiTaskUpdated: {
    __typename: 'AiTask', id, taskType: 'INTERVIEW_CLARIFICATION', status,
    result: status === 'COMPLETED' ? { explanation } : null, input: {}, pendingQuestions: [],
    errorMessage: status === 'FAILED' ? 'Clarification failed' : null, acceptedAt: null, createdAt: '2026-10-22', job: null,
  } } } }
}
afterEach(() => { cleanup(); vi.useRealTimers() })
it('keeps clarification feedback outside the controls with a stable trigger and Escape dismissal', async () => {
  const failure = 'Question clarification is not configured'
  const mock = requestMock()
  renderClarification(null, [{ ...mock, result: { data: { requestInterviewClarification: { __typename: 'RequestInterviewClarificationPayload', clarification: null, errors: [failure] } } } }])
  fireEvent.click(screen.getByRole('button', { name: 'Clarify question' }))
  expect(await screen.findByText(failure)).toBeVisible()
  const panel = screen.getByRole('dialog', { name: 'Question clarification' })
  expect(within(panel).getByText(failure)).toBeVisible()
  expect(within(screen.getByRole('group', { name: 'Question controls' })).queryByText(failure)).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Clarify question' })).toHaveAttribute('aria-expanded', 'true')
  await userEvent.keyboard('{Escape}')
  expect(screen.queryByRole('dialog', { name: 'Question clarification' })).not.toBeInTheDocument()
})
it('requests identity only, shows progress and the live explanation, then reopens without another request', async () => {
  const mock = requestMock()
  const result = vi.fn(() => mock.result)
  renderClarification(null, [{ ...mock, result, delay: 20 }, taskMock()])
  fireEvent.click(screen.getByRole('button', { name: 'Clarify question' }))
  expect(screen.getByRole('button', { name: 'Clarify question' })).toHaveAttribute('aria-busy', 'true')
  expect(await screen.findByText(explanation)).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Close clarification' }))
  fireEvent.click(screen.getByRole('button', { name: 'Clarify question' }))
  expect(screen.getByText(explanation)).toBeVisible()
  expect(result).toHaveBeenCalledOnce()
})
it('reopens the saved explanation after reload without a generation request', async () => {
  renderClarification({ ...saved, status: 'completed', explanation }, [taskMock()])
  expect(screen.queryByText(explanation)).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Clarify question' }))
  expect(screen.getByText(explanation)).toBeVisible()
})
it('offers explicit retry after the saved deadline without polling', async () => {
  renderClarification({ ...saved, deadline: '2020-01-01T00:00:00Z' }, [taskMock('QUEUED'), requestMock(true, 2), taskMock('COMPLETED', 'task-2')])
  fireEvent.click(screen.getByRole('button', { name: 'Clarify question' }))
  expect(await screen.findByRole('button', { name: 'Retry clarification' })).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Retry clarification' }))
  expect(await screen.findByText(explanation)).toBeVisible()
})
it('does not offer a third attempt after failure', async () => {
  renderClarification({ ...saved, status: 'failed', attemptCount: 2 }, [taskMock('FAILED')])
  fireEvent.click(screen.getByRole('button', { name: 'Clarify question' }))
  expect(screen.getByText(/reached its clarification retry limit/)).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Retry clarification' })).not.toBeInTheDocument()
})
