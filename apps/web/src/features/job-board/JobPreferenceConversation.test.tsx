/** Explain preferences through owned saved dialogue and explicit queued turns. */
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { renderPage } from '@/test/renderPage'
import { JobPreferenceConversation } from './JobPreferenceConversation'
import { JOB_PREFERENCE_CONVERSATION, START_JOB_PREFERENCE_CONVERSATION } from './jobPreferenceOperations'

vi.mock('@/features/ai-tasks/useAiTaskUpdates', () => ({ useAiTaskUpdates: () => ({ aiTask: null, error: null }) }))

it('reopens accepted dialogue and sends only the newest answer and owned previous identity', async () => {
  const user = userEvent.setup()
  const task = { __typename: 'AiTask' as const, id: 'task-1', status: 'NEEDS_USER_INPUT' as const, result: null,
    pendingQuestions: [{id: 'q1', question: 'Which location?'}], errorMessage: null, input: {message: 'I need remote work'} }
  renderPage({ path: '/jobs/find', url: '/jobs/find', element: <JobPreferenceConversation version={0} disabled={false} onBusyChange={() => {}} onAccepted={async () => {}} />, mocks: [
    {request: {query: JOB_PREFERENCE_CONVERSATION}, result: {data: {jobPreferenceConversation: {__typename: 'JobPreferenceConversation', aiTask: task, stale: false,
      turns: [{__typename: 'JobPreferenceConversationTurn', userMessage: 'I need remote work', assistantMessage: 'Which location?'}]}}}},
    {request: {query: START_JOB_PREFERENCE_CONVERSATION, variables: {message: 'United States', expectedVersion: 0, previousTaskId: 'task-1'}}, result: {data: {startJobPreferenceConversation: {__typename: 'StartConversationPayload', errors: [], aiTask: {...task, id: 'task-2', status: 'QUEUED', pendingQuestions: []}}}}},
  ] })
  expect(await screen.findByText('Which location?')).toBeInTheDocument()
  await user.type(screen.getByRole('textbox', {name: 'Tell me what you want next'}), 'United States')
  await user.click(screen.getByRole('button', {name: 'Send preferences'}))
  expect(await screen.findByText('Working on your preferences…')).toBeInTheDocument()
})

it('restores a failed message after reopening so retry does not lose the explanation', async () => {
  const task = { __typename: 'AiTask' as const, id: 'failed-1', status: 'FAILED' as const, result: null,
    pendingQuestions: [], errorMessage: 'Provider unavailable', input: {message: 'Climate work is a bonus', profile_version: 2} }
  renderPage({ path: '/jobs/find', url: '/jobs/find', element: <JobPreferenceConversation version={2} disabled={false} onBusyChange={() => {}} onAccepted={async () => {}} />, mocks: [
    {request: {query: JOB_PREFERENCE_CONVERSATION}, result: {data: {jobPreferenceConversation: {__typename: 'JobPreferenceConversation', aiTask: task, stale: false, turns: []}}}},
  ] })
  expect(await screen.findByDisplayValue('Climate work is a bonus')).toBeInTheDocument()
  expect(screen.getByText('Provider unavailable')).toBeInTheDocument()
  expect(screen.getByRole('button', {name: 'Send preferences'})).toBeEnabled()
})

it('starts from the current draft after manual changes and refreshes the accepted summary', async () => {
  const user = userEvent.setup()
  const accepted = vi.fn(async () => {})
  const task = { __typename: 'AiTask' as const, id: 'old', status: 'COMPLETED' as const,
    result: {reply: 'Old draft', criteria: [], profile_version: 1}, pendingQuestions: [], errorMessage: null, input: {profile_version: 0} }
  const current = {...task, id: 'new', result: {reply: 'Review the new draft', criteria: [], profile_version: 3}, input: {profile_version: 2} }
  renderPage({ path: '/jobs/find', url: '/jobs/find', element: <JobPreferenceConversation version={2} disabled={false} onBusyChange={() => {}} onAccepted={accepted} />, mocks: [
    {request: {query: JOB_PREFERENCE_CONVERSATION}, result: {data: {jobPreferenceConversation: {__typename: 'JobPreferenceConversation', aiTask: task, stale: true, turns: []}}}},
    {request: {query: START_JOB_PREFERENCE_CONVERSATION, variables: {message: 'Keep only remote work', expectedVersion: 2, previousTaskId: null}}, result: {data: {startJobPreferenceConversation: {__typename: 'StartConversationPayload', errors: [], aiTask: current}}}},
    {request: {query: JOB_PREFERENCE_CONVERSATION}, result: {data: {jobPreferenceConversation: {__typename: 'JobPreferenceConversation', aiTask: current, stale: false,
      turns: [{__typename: 'JobPreferenceConversationTurn', userMessage: 'Keep only remote work', assistantMessage: 'Review the new draft'}]}}}},
  ] })
  expect(await screen.findByText('Your preferences changed after this conversation. Your next message starts from the current draft.')).toBeInTheDocument()
  await user.type(screen.getByRole('textbox', {name: 'Tell me what you want next'}), 'Keep only remote work')
  await user.click(screen.getByRole('button', {name: 'Send preferences'}))
  expect(await screen.findByText('Review the new draft', {exact: false})).toBeInTheDocument()
  expect(accepted).toHaveBeenCalledOnce()
})

it('allows a fresh conversation after clear while the old revision is still running', async () => {
  const user = userEvent.setup()
  const task = { __typename: 'AiTask' as const, id: 'old-queued', status: 'QUEUED' as const,
    result: null, pendingQuestions: [], errorMessage: null, input: {profile_version: 0} }
  renderPage({ path: '/jobs/find', url: '/jobs/find', element: <JobPreferenceConversation version={1} disabled={false} onBusyChange={() => {}} onAccepted={async () => {}} />, mocks: [
    {request: {query: JOB_PREFERENCE_CONVERSATION}, result: {data: {jobPreferenceConversation: {__typename: 'JobPreferenceConversation', aiTask: task, stale: true, turns: []}}}},
  ] })
  await screen.findByText('Your preferences changed after this conversation. Your next message starts from the current draft.')
  const message = screen.getByRole('textbox', {name: 'Tell me what you want next'})
  await user.type(message, 'Start fresh')
  expect(screen.getByRole('button', {name: 'Send preferences'})).toBeEnabled()
})
