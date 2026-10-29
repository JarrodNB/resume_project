/** Recover reopened queued preference turns through real GraphQL subscriptions. */
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { setSectionOpen } from '@/lib/openSections'
import { renderPage } from '@/test/renderPage'
import { AI_TASK_UPDATED_SUBSCRIPTION } from '@/features/ai-tasks/aiTaskOperations'
import { JobPreferences } from './JobPreferences'
import { useJobPreferenceConversation } from './useJobPreferenceConversation'
import { JOB_PREFERENCE_CONVERSATION, JOB_PREFERENCES_QUERY, START_JOB_PREFERENCE_CONVERSATION } from './jobPreferenceOperations'

beforeEach(() => localStorage.clear())

function task(id: string, status: 'QUEUED' | 'COMPLETED' | 'NEEDS_USER_INPUT') {
  return { __typename: 'AiTask' as const, id, status, taskType: 'ELICIT_JOB_PREFERENCES',
    result: status === 'COMPLETED' ? {reply: 'Review your remote preference', profile_version: 1, criteria: []} : null,
    input: {profile_version: 0, message: 'Remote is required'},
    pendingQuestions: status === 'NEEDS_USER_INPUT' ? [{id: 'q1', question: 'Which location?'}] : [],
    errorMessage: null, acceptedAt: null, createdAt: '2026-10-29T00:00:00Z', job: null }
}

function conversation(aiTask: ReturnType<typeof task>, assistantMessage?: string) {
  return { data: {jobPreferenceConversation: {__typename: 'JobPreferenceConversation', aiTask, stale: false,
    turns: assistantMessage ? [{__typename: 'JobPreferenceConversationTurn', userMessage: 'Remote is required', assistantMessage}] : [] }} }
}

it.each(['COMPLETED', 'NEEDS_USER_INPUT'] as const)('refreshes accepted dialogue and preferences when a reopened queued task becomes %s', async (status) => {
  setSectionOpen('job-preferences', true)
  const queued = task('reopened', 'QUEUED')
  const accepted = task('reopened', status)
  const assistant = status === 'COMPLETED' ? 'Review your remote preference' : 'Which location?'
  const empty = {__typename: 'JobPreferenceProfile', version: 0, confirmedRevision: 0, draftCriteria: [], confirmedCriteria: []}
  const updated = status === 'COMPLETED' ? {...empty, version: 1,
    draftCriteria: [{__typename: 'JobPreferenceCriterion', id: 'criterion-1', text: 'Fully remote', priority: 'must_have'}]} : empty
  const profileRefresh = vi.fn(() => ({data: {jobPreferences: updated}}))
  renderPage({path: '/jobs/find', url: '/jobs/find', element: <JobPreferences />, mocks: [
    {request: {query: JOB_PREFERENCES_QUERY}, result: {data: {jobPreferences: empty}}},
    {request: {query: JOB_PREFERENCE_CONVERSATION}, result: conversation(queued)},
    {request: {query: AI_TASK_UPDATED_SUBSCRIPTION, variables: {id: 'reopened'}}, delay: 40, result: {data: {aiTaskUpdated: accepted}}},
    {request: {query: JOB_PREFERENCES_QUERY}, result: profileRefresh},
    {request: {query: JOB_PREFERENCE_CONVERSATION}, result: conversation(accepted, assistant)},
  ]})
  await screen.findByText('Working on your preferences…')
  expect(await screen.findByText(assistant, {exact: false})).toBeInTheDocument()
  await waitFor(() => expect(profileRefresh).toHaveBeenCalledOnce())
  if (status === 'COMPLETED') {
    expect(await screen.findByDisplayValue('Fully remote')).toBeInTheDocument()
    expect(screen.getByRole('button', {name: 'Confirm saved preferences'})).toBeEnabled()
  }
})

it('keeps a newer submitted turn when recovery of its predecessor finishes later', async () => {
  const user = userEvent.setup()
  let finishRecovery!: () => void
  const onAccepted = vi.fn(() => new Promise<void>((resolve) => { finishRecovery = resolve }))
  const queued = task('old', 'QUEUED')
  const accepted = task('old', 'NEEDS_USER_INPUT')
  const next = task('new', 'QUEUED')
  function Harness() {
    const state = useJobPreferenceConversation(0, onAccepted)
    return <div><p>{state.task?.id}:{state.task?.status}</p><button disabled={state.busy || state.loading} onClick={() => void state.send('United States')}>Answer</button></div>
  }
  renderPage({path: '/jobs/find', url: '/jobs/find', element: <Harness />, mocks: [
    {request: {query: JOB_PREFERENCE_CONVERSATION}, result: conversation(queued)},
    {request: {query: AI_TASK_UPDATED_SUBSCRIPTION, variables: {id: 'old'}}, delay: 40, result: {data: {aiTaskUpdated: accepted}}},
    {request: {query: JOB_PREFERENCE_CONVERSATION}, result: conversation(accepted, 'Which location?')},
    {request: {query: START_JOB_PREFERENCE_CONVERSATION, variables: {message: 'United States', expectedVersion: 0, previousTaskId: 'old'}}, result: {data: {startJobPreferenceConversation: {__typename: 'StartConversationPayload', aiTask: next, errors: []}}}},
    {request: {query: AI_TASK_UPDATED_SUBSCRIPTION, variables: {id: 'new'}}, delay: Infinity, result: {data: {aiTaskUpdated: next}}},
  ]})
  await screen.findByText('old:NEEDS_USER_INPUT')
  await waitFor(() => expect(onAccepted).toHaveBeenCalledOnce())
  await waitFor(() => expect(screen.getByRole('button', {name: 'Answer'})).toBeEnabled())
  await user.click(screen.getByRole('button', {name: 'Answer'}))
  await screen.findByText('new:QUEUED')
  await act(async () => finishRecovery())
  expect(screen.getByText('new:QUEUED')).toBeInTheDocument()
  expect(screen.getByRole('button', {name: 'Answer'})).toBeDisabled()
})
