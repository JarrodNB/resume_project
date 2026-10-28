/** Checks explicit generation and review actions without browser automation. */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MockedProvider } from '@apollo/client/testing/react'
import { vi, expect, it, beforeEach } from 'vitest'
import { SummaryGenerationPanel } from './SummaryGenerationPanel'
import { SUMMARY_GENERATION_QUERY, ACCEPT_SUMMARY_GENERATION_MUTATION, START_SUMMARY_GENERATION_MUTATION, DISCARD_SUMMARY_GENERATION_MUTATION } from './summaryGenerationOperations'

const live = vi.hoisted(() => ({ aiTask: null as null | { id: string; status: string }, error: null as null | Error }))
vi.mock('@/features/ai-tasks/useAiTaskUpdates', () => ({ useAiTaskUpdates: () => live }))
beforeEach(() => { live.aiTask = null; live.error = null })
const proposal = { __typename: 'AiTask', id: 'task-1', status: 'COMPLETED', result: { text: 'Engineer who builds billing APIs.' }, acceptedAt: null, errorMessage: null }

it('restores an editable proposal and saves only when the owner accepts', async () => {
  const accepted = vi.fn()
  const mocks = [
    { request: { query: SUMMARY_GENERATION_QUERY, variables: { targetKind: 'profile', targetId: 'user-1' } }, result: { data: { summaryGeneration: { __typename: 'SummaryGeneration', stale: false, aiTask: proposal } } } },
    { request: { query: ACCEPT_SUMMARY_GENERATION_MUTATION, variables: { aiTaskId: 'task-1', text: 'My reviewed version.' } }, result: { data: { acceptSummaryGeneration: { __typename: 'AcceptSummaryGenerationPayload', errors: [], aiTask: { ...proposal, acceptedAt: '2026-10-28T00:00:00Z' } } } } },
  ]
  render(<MockedProvider mocks={mocks}><SummaryGenerationPanel targetKind="profile" targetId="user-1" onAccepted={accepted} /></MockedProvider>)
  const text = await screen.findByRole('textbox', { name: 'Proposed summary' })
  expect(accepted).not.toHaveBeenCalled()
  await userEvent.clear(text)
  await userEvent.type(text, 'My reviewed version.')
  await userEvent.click(screen.getByRole('button', { name: 'Accept summary' }))
  expect(await screen.findByText('Summary saved.')).toBeInTheDocument()
  expect(accepted).toHaveBeenCalledOnce()
})


it('starts only on request and recovers a missed completion when status is refreshed', async () => {
  live.error = new Error('connection dropped')
  live.aiTask = { id: 'task-1', status: 'QUEUED' }
  const started = vi.fn(() => ({ data: { startSummaryGeneration: { __typename: 'StartSummaryGenerationPayload', errors: [], aiTask: { ...proposal, status: 'QUEUED', result: null } } } }))
  const mocks = [
    { request: { query: SUMMARY_GENERATION_QUERY, variables: { targetKind: 'profile', targetId: 'user-1' } }, result: { data: { summaryGeneration: { __typename: 'SummaryGeneration', stale: false, aiTask: null } } } },
    { request: { query: START_SUMMARY_GENERATION_MUTATION, variables: { targetKind: 'profile', targetId: 'user-1' } }, result: started },
    { request: { query: SUMMARY_GENERATION_QUERY, variables: { targetKind: 'profile', targetId: 'user-1' } }, result: { data: { summaryGeneration: { __typename: 'SummaryGeneration', stale: false, aiTask: proposal } } } },
  ]
  render(<MockedProvider mocks={mocks}><SummaryGenerationPanel targetKind="profile" targetId="user-1" /></MockedProvider>)
  const generate = await screen.findByRole('button', { name: 'Generate summary' })
  expect(started).not.toHaveBeenCalled()
  await userEvent.click(generate)
  expect(await screen.findByText('Generating your summary…')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Refresh status' }))
  expect(await screen.findByRole('textbox', { name: 'Proposed summary' })).toHaveValue('Engineer who builds billing APIs.')
})

it('discards restored proposals without accepting and offers generation again', async () => {
  const accepted = vi.fn()
  const mocks = [
    { request: { query: SUMMARY_GENERATION_QUERY, variables: { targetKind: 'profile', targetId: 'user-1' } }, result: { data: { summaryGeneration: { __typename: 'SummaryGeneration', stale: false, aiTask: proposal } } } },
    { request: { query: DISCARD_SUMMARY_GENERATION_MUTATION, variables: { aiTaskId: 'task-1' } }, result: { data: { discardSummaryGeneration: { __typename: 'DiscardSummaryGenerationPayload', errors: [], aiTask: { ...proposal, status: 'FAILED', errorMessage: 'Summary draft discarded.' } } } } },
  ]
  render(<MockedProvider mocks={mocks}><SummaryGenerationPanel targetKind="profile" targetId="user-1" onAccepted={accepted} /></MockedProvider>)
  await userEvent.click(await screen.findByRole('button', { name: 'Discard draft' }))
  expect(await screen.findByRole('button', { name: 'Generate summary' })).toBeEnabled()
  expect(accepted).not.toHaveBeenCalled()
})

it('prevents accepting stale proposals and shows retryable generation failure', async () => {
  const mocks = [{ request: { query: SUMMARY_GENERATION_QUERY, variables: { targetKind: 'profile', targetId: 'user-1' } }, result: { data: { summaryGeneration: { __typename: 'SummaryGeneration', stale: true, aiTask: proposal } } } }]
  render(<MockedProvider mocks={mocks}><SummaryGenerationPanel targetKind="profile" targetId="user-1" /></MockedProvider>)
  expect(await screen.findByRole('button', { name: 'Accept summary' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Generate new summary' })).toBeEnabled()
})

it('restores failure details with an explicit retry action', async () => {
  const mocks = [{ request: { query: SUMMARY_GENERATION_QUERY, variables: { targetKind: 'profile', targetId: 'user-1' } }, result: { data: { summaryGeneration: { __typename: 'SummaryGeneration', stale: false, aiTask: { ...proposal, status: 'FAILED', result: null, errorMessage: 'Screening is unavailable. Try again later.' } } } } }]
  render(<MockedProvider mocks={mocks}><SummaryGenerationPanel targetKind="profile" targetId="user-1" /></MockedProvider>)
  expect(await screen.findByRole('alert')).toHaveTextContent('Screening is unavailable.')
  expect(screen.getByRole('button', { name: 'Generate summary' })).toBeEnabled()
})
