/** Exercise saved references and queued recovery through Apollo without recording or paid providers. */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { MockLink } from '@apollo/client/testing'
import { StrictMode, useState } from 'react'
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
function renderReferences(record: Saved | null = null, mocks: MockLink.MockedResponse[] = [], ownerId = "owner") {
  return renderPage({ path: '/test', url: '/test', mocks, element: <><textarea aria-label="Your answer" defaultValue="My own answer" /><InterviewCareerReferences ownerId={ownerId} interviewId="interview" message={{ ...message, careerReferences: record }} disabled={false} /></> })
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
afterEach(() => { cleanup(); vi.useRealTimers(); localStorage.clear() })
it('automatically retrieves once and leaves the independent answer unchanged', async () => {
  const mock = requestMock()
  const result = vi.fn(() => mock.result)
  renderReferences(null, [{ ...mock, result, delay: 20 }, taskMock()])
  expect(await screen.findByText(body)).toHaveAttribute('aria-hidden', 'true')
  expect(screen.getByText('Engineer at Acme')).toBeVisible()
  expect(screen.getByRole('textbox', { name: 'Your answer' })).toBeEnabled()
  fireEvent.change(screen.getByRole('textbox', { name: 'Your answer' }), { target: { value: 'Still my answer' } })
  fireEvent.click(screen.getByRole('button', { name: 'Reveal Engineer at Acme' }))
  expect(screen.getByText(body)).toHaveAttribute('aria-hidden', 'false')
  expect(screen.getByRole('textbox', { name: 'Your answer' })).toHaveValue('Still my answer')
  expect(result).toHaveBeenCalledOnce()
})
it('restores saved results without another request and conceals bodies accessibly', async () => {
  renderReferences({ ...saved, status: 'completed', references: [entry] })
  expect(screen.getByRole('checkbox', { name: 'Blur reference text' })).toBeChecked()
  expect(screen.getByText(body)).toHaveAttribute('aria-hidden', 'true')
  expect(screen.getByText(body)).toHaveAttribute('inert')
  expect(screen.getByRole('button', { name: 'Reveal Engineer at Acme' })).toHaveAttribute('aria-expanded', 'false')
  screen.getByRole('button', { name: 'Reveal Engineer at Acme' }).focus()
  await userEvent.keyboard('{Enter}')
  expect(screen.getByText(body)).not.toHaveAttribute('inert')
  expect(screen.getByRole('button', { name: 'Hide Engineer at Acme' })).toHaveAttribute('aria-expanded', 'true')
  fireEvent.click(screen.getByRole('button', { name: 'Hide Engineer at Acme' }))
  expect(screen.getByText(body)).toHaveAttribute('inert')
})
it('remembers only the blur preference and isolates it by owner', () => {
  const first = renderReferences({ ...saved, status: 'completed', references: [entry] })
  fireEvent.click(screen.getByRole('checkbox', { name: 'Blur reference text' }))
  expect(screen.getByText(body)).toHaveAttribute('aria-hidden', 'false')
  expect(screen.queryByRole('button', { name: /Reveal/ })).not.toBeInTheDocument()
  expect(localStorage.getItem('Careergrind:interview-reference-blur:owner')).toBe('false')
  expect(JSON.stringify(localStorage)).not.toContain(body)
  first.unmount()
  const restored = renderReferences({ ...saved, status: 'completed', references: [entry] })
  expect(screen.getByRole('checkbox', { name: 'Blur reference text' })).not.toBeChecked()
  restored.unmount()
  renderReferences({ ...saved, status: 'completed', references: [entry] }, [], 'other-owner')
  expect(screen.getByRole('checkbox', { name: 'Blur reference text' })).toBeChecked()
})
it('resets per-card reveal when a new prompt replaces the current one', () => {
  const record = { ...saved, status: 'completed', references: [entry] }
  function Prompts() {
    const [id, setId] = useState(message.id)
    return <><button onClick={() => setId('follow-up')}>Next prompt</button><InterviewCareerReferences ownerId="owner" interviewId="interview" message={{ ...message, id, careerReferences: record }} disabled={false} /></>
  }
  renderPage({ path: '/test', url: '/test', element: <Prompts /> })
  fireEvent.click(screen.getByRole('button', { name: 'Reveal Engineer at Acme' }))
  fireEvent.click(screen.getByRole('button', { name: 'Next prompt' }))
  expect(screen.getByText(body)).toHaveAttribute('aria-hidden', 'true')
})
it('shows an honest saved empty outcome without another retrieval', () => {
  renderReferences({ ...saved, status: 'empty' })
  expect(screen.getByText('No relevant saved examples found for this question.')).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Retry career examples' })).not.toBeInTheDocument()
})
it('offers explicit retry after a saved deadline without polling', async () => {
  renderReferences({ ...saved, deadline: '2020-01-01T00:00:00Z' }, [taskMock('QUEUED'), requestMock(true, 2), taskMock('COMPLETED', 'task-2')])
  fireEvent.click(await screen.findByRole('button', { name: 'Retry career examples' }))
  expect(await screen.findByText(body)).toHaveAttribute('aria-hidden', 'true')
})
it('does not offer a third attempt and preserves the independent answer', () => {
  renderReferences({ ...saved, status: 'failed', attemptCount: 2 }, [taskMock('FAILED')])
  expect(screen.getByText(/reached its career example retry limit/)).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Retry career examples' })).not.toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: 'Your answer' })).toBeEnabled()
})
it('allows an explicit saved-status check after a lost request receipt without automatic retries', async () => {
  const mock = requestMock()
  const retry = requestMock(true)
  renderReferences(null, [{ request: mock.request, error: new Error('lost receipt') }, { ...retry, result: vi.fn(() => retry.result) }, taskMock()])
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not confirm career examples')
  fireEvent.click(screen.getByRole('button', { name: 'Retry career examples' }))
  expect(await screen.findByText(body)).toHaveAttribute('aria-hidden', 'true')
})
it('does not request again for already pending work', async () => {
  renderReferences(saved, [taskMock()])
  expect(await screen.findByText(body)).toHaveAttribute('aria-hidden', 'true')
})
it('deduplicates automatic requests under StrictMode and rerenders', async () => {
  const mock = requestMock()
  const result = vi.fn(() => mock.result)
  renderPage({ path: '/test', url: '/test', mocks: [{ ...mock, result }, taskMock()], element: <StrictMode><InterviewCareerReferences ownerId="owner" interviewId="interview" message={message} disabled={false} /></StrictMode> })
  expect(await screen.findByText(body)).toBeInTheDocument()
  expect(result).toHaveBeenCalledOnce()
})
it('waits until answer processing is over without disabling independent controls', async () => {
  const mock = requestMock()
  const result = vi.fn(() => mock.result)
  function Processing() {
    const [disabled, setDisabled] = useState(true)
    return <><button onClick={() => setDisabled(false)}>Answer saved</button><InterviewCareerReferences ownerId="owner" interviewId="interview" message={message} disabled={disabled} /></>
  }
  renderPage({ path: '/test', url: '/test', mocks: [{ ...mock, result }, taskMock()], element: <Processing /> })
  expect(result).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Answer saved' }))
  await waitFor(() => expect(result).toHaveBeenCalledOnce())
})
it('ignores a late request receipt after the displayed prompt changes', async () => {
  const mock = requestMock()
  const result = vi.fn(() => mock.result)
  const nextBody = 'I worked with the support team to improve triage.'
  function Prompts() {
    const [next, setNext] = useState(false)
    const current = next ? { ...message, id: 'next', careerReferences: { ...saved, status: 'completed', references: [{ ...entry, body: nextBody }] } } : message
    return <><button onClick={() => setNext(true)}>Next question</button><InterviewCareerReferences ownerId="owner" interviewId="interview" message={current} disabled={false} /></>
  }
  renderPage({ path: '/test', url: '/test', mocks: [{ ...mock, result, delay: 50 }], element: <Prompts /> })
  fireEvent.click(screen.getByRole('button', { name: 'Next question' }))
  await waitFor(() => expect(result).toHaveBeenCalledOnce())
  expect(screen.getByText(nextBody)).toHaveAttribute('aria-hidden', 'true')
  expect(screen.queryByText(body)).not.toBeInTheDocument()
})
it('keeps blur controls usable when local storage is unavailable', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('unavailable') })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('unavailable') })
  renderReferences({ ...saved, status: 'completed', references: [entry] })
  expect(screen.getByText(body)).toHaveAttribute('aria-hidden', 'true')
  fireEvent.click(screen.getByRole('checkbox', { name: 'Blur reference text' }))
  expect(screen.getByText(body)).toHaveAttribute('aria-hidden', 'false')
  vi.restoreAllMocks()
})
