/** Recover reopened queued preference turns through real GraphQL subscriptions. */
import { act, render, screen, waitFor } from '@testing-library/react'
import { ApolloClient, ApolloLink, InMemoryCache } from '@apollo/client'
import { ApolloProvider } from '@apollo/client/react'
import { MockLink } from '@apollo/client/testing'
import { Observable } from 'rxjs'
import { MemoryRouter } from 'react-router'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { setSectionOpen } from '@/lib/openSections'
import { renderPage } from '@/test/renderPage'
import { AI_TASK_UPDATED_SUBSCRIPTION } from '@/features/ai-tasks/aiTaskOperations'
import { JobPreferences } from './JobPreferences'
import { JobPreferenceConversation } from './JobPreferenceConversation'
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

it('waits for predecessor recovery before submitting and retaining a newer turn', async () => {
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
  expect(screen.getByRole('button', {name: 'Answer'})).toBeDisabled()
  await user.click(screen.getByRole('button', {name: 'Answer'}))
  expect(screen.queryByText('new:QUEUED')).not.toBeInTheDocument()
  await act(async () => finishRecovery())
  await waitFor(() => expect(screen.getByRole('button', {name: 'Answer'})).toBeEnabled())
  await user.click(screen.getByRole('button', {name: 'Answer'}))
  await screen.findByText('new:QUEUED')
  expect(screen.getByText('new:QUEUED')).toBeInTheDocument()
  expect(screen.getByRole('button', {name: 'Answer'})).toBeDisabled()
})

it('keeps a fresh current-revision turn busy despite the old query conversation being stale', async () => {
  const user = userEvent.setup()
  setSectionOpen('job-preferences', true)
  const old = task('old-stale', 'COMPLETED')
  const next = {...task('fresh', 'QUEUED'), input: {profile_version: 2, message: 'Remote is required'}}
  const completed = {...next, status: 'COMPLETED' as const, result: {reply: 'Review the updated remote draft', profile_version: 3, criteria: []}}
  const profile = {__typename: 'JobPreferenceProfile', version: 2, confirmedRevision: 0,
    draftCriteria: [{__typename: 'JobPreferenceCriterion', id: 'remote', text: 'Remote work', priority: 'must_have'}], confirmedCriteria: []}
  const updated = {...profile, version: 3, draftCriteria: [{...profile.draftCriteria[0], text: 'Fully remote work'}]}
  const queuedResult = vi.fn(() => ({data: {startJobPreferenceConversation: {__typename: 'StartConversationPayload', aiTask: next, errors: []}}}))
  renderPage({path: '/jobs/find', url: '/jobs/find', element: <JobPreferences />, mocks: [
    {request: {query: JOB_PREFERENCES_QUERY}, result: {data: {jobPreferences: profile}}},
    {request: {query: JOB_PREFERENCE_CONVERSATION}, result: {data: {jobPreferenceConversation: {__typename: 'JobPreferenceConversation', aiTask: old, turns: [], stale: true}}}},
    {request: {query: AI_TASK_UPDATED_SUBSCRIPTION, variables: {id: 'old-stale'}}, delay: Infinity, result: {data: {aiTaskUpdated: old}}},
    {request: {query: START_JOB_PREFERENCE_CONVERSATION, variables: {message: 'Remote is required', expectedVersion: 2, previousTaskId: null}}, result: queuedResult},
    {request: {query: AI_TASK_UPDATED_SUBSCRIPTION, variables: {id: 'fresh'}}, delay: 250, result: {data: {aiTaskUpdated: completed}}},
    {request: {query: JOB_PREFERENCES_QUERY}, result: {data: {jobPreferences: updated}}},
    {request: {query: JOB_PREFERENCE_CONVERSATION}, result: conversation(completed, 'Review the updated remote draft')},
  ]})
  await screen.findByText('Your preferences changed after this conversation. Your next message starts from the current draft.')
  await user.type(screen.getByRole('textbox', {name: 'Tell me what you want next'}), 'Remote is required')
  await user.click(screen.getByRole('button', {name: 'Send preferences'}))
  await waitFor(() => expect(queuedResult).toHaveBeenCalledOnce())
  expect(await screen.findByText('Working on your preferences…')).toBeInTheDocument()
  expect(screen.getByRole('textbox', {name: 'Preference 1'})).toBeDisabled()
  expect(screen.getByRole('button', {name: 'Send preferences'})).toBeDisabled()
  await waitFor(() => expect(screen.getByDisplayValue('Fully remote work')).toBeEnabled())
})


it.each(['queued', 'accepted'])('locks editing while a reopened %s turn refreshes its accepted profile', async (initial) => {
  const user = userEvent.setup()
  setSectionOpen('job-preferences', true)
  const accepted = task('slow-recovery', 'COMPLETED')
  const original = {__typename: 'JobPreferenceProfile' as const, version: 0, confirmedRevision: 0,
    draftCriteria: [{__typename: 'JobPreferenceCriterion' as const, id: 'remote', text: 'Remote draft', priority: 'must_have'}], confirmedCriteria: []}
  const updated = {...original, version: 1, draftCriteria: [{...original.draftCriteria[0], text: 'Fully remote work'}]}
  let finishProfile!: () => void
  const refreshStarted = vi.fn()
  let profileReads = 0
  const heldProfile = new ApolloLink((operation, forward) => {
    if (operation.operationName !== 'JobPreferences' || ++profileReads !== 2) return forward(operation)
    return new Observable((observer) => {
      refreshStarted()
      finishProfile = () => { observer.next({data: {jobPreferences: updated}}); observer.complete() }
    })
  })
  const client = new ApolloClient({cache: new InMemoryCache(), link: ApolloLink.from([heldProfile, new MockLink([
    {request: {query: JOB_PREFERENCES_QUERY}, result: {data: {jobPreferences: original}}},
    {request: {query: JOB_PREFERENCE_CONVERSATION}, result: conversation(initial === 'queued' ? task(accepted.id, 'QUEUED') : accepted)},
    {request: {query: AI_TASK_UPDATED_SUBSCRIPTION, variables: {id: accepted.id}}, ...(initial === 'accepted' ? {delay: Infinity} : {}), result: {data: {aiTaskUpdated: accepted}}},
    {request: {query: JOB_PREFERENCE_CONVERSATION}, result: conversation(accepted, 'Review your remote preference')},
  ])] )})
  render(<ApolloProvider client={client}><MemoryRouter><JobPreferences /></MemoryRouter></ApolloProvider>)
  await waitFor(() => expect(refreshStarted).toHaveBeenCalledOnce())
  const editor = screen.getByRole('textbox', {name: 'Preference 1'})
  expect(editor).toBeDisabled()
  expect(screen.getByRole('textbox', {name: 'Tell me what you want next'})).toBeDisabled()
  await user.type(editor, 'Please keep this edit')
  expect(editor).toHaveValue('Remote draft')
  await act(async () => finishProfile())
  await waitFor(() => expect(screen.getByDisplayValue('Fully remote work')).toBeEnabled())
  expect(screen.getByRole('textbox', {name: 'Tell me what you want next'})).toBeEnabled()
})


it('waits for the other recovery read after a rejection, then unlocks and offers a working reload', async () => {
  const user = userEvent.setup()
  const accepted = task('failed-recovery', 'NEEDS_USER_INPUT')
  const onAccepted = vi.fn<() => Promise<void>>().mockRejectedValueOnce(new Error('Profile read failed')).mockResolvedValue(undefined)
  let finishDialogue!: () => void
  const refreshStarted = vi.fn()
  let conversationReads = 0
  const heldDialogue = new ApolloLink((operation, forward) => {
    if (operation.operationName !== 'JobPreferenceConversation' || ++conversationReads !== 2) return forward(operation)
    return new Observable((observer) => {
      refreshStarted()
      finishDialogue = () => { observer.next(conversation(accepted, 'Which location?')); observer.complete() }
    })
  })
  const client = new ApolloClient({cache: new InMemoryCache(), link: ApolloLink.from([heldDialogue, new MockLink([
    {request: {query: JOB_PREFERENCE_CONVERSATION}, result: conversation(task(accepted.id, 'QUEUED'))},
    {request: {query: AI_TASK_UPDATED_SUBSCRIPTION, variables: {id: accepted.id}}, result: {data: {aiTaskUpdated: accepted}}},
    {request: {query: JOB_PREFERENCE_CONVERSATION}, result: conversation(accepted, 'Which location?')},
  ])])})
  render(<ApolloProvider client={client}><MemoryRouter><JobPreferenceConversation version={0} disabled={false} onBusyChange={() => {}} onAccepted={onAccepted} /></MemoryRouter></ApolloProvider>)
  await waitFor(() => expect(refreshStarted).toHaveBeenCalledOnce())
  expect(screen.getByRole('textbox', {name: 'Tell me what you want next'})).toBeDisabled()
  await act(async () => finishDialogue())
  await screen.findByText('Could not refresh the saved conversation. Reload to recover it.')
  expect(screen.getByRole('textbox', {name: 'Tell me what you want next'})).toBeEnabled()
  await user.click(screen.getByRole('button', {name: 'Reload conversation'}))
  await waitFor(() => expect(onAccepted).toHaveBeenCalledTimes(2))
  await waitFor(() => expect(screen.getByRole('textbox', {name: 'Tell me what you want next'})).toBeEnabled())
  expect(screen.queryByRole('button', {name: 'Reload conversation'})).not.toBeInTheDocument()
})
