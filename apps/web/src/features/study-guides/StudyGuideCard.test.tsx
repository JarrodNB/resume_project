/** Exercises persisted guide reading and generation states without a browser. */
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, beforeEach } from 'vitest'

beforeEach(() => localStorage.clear())
import { renderPage } from '@/test/renderPage'
import { StudyGuideCard } from './StudyGuideCard'
import { AI_TASK_UPDATED_SUBSCRIPTION } from '@/features/ai-tasks/aiTaskOperations'
import { GENERATE_STUDY_GUIDE_MUTATION, STUDY_GUIDE_QUERY } from './studyGuideOperations'

const result = { study_guide: { title: 'Inventory study guide', topics: [{ title: 'Stock reconciliation', why_it_matters: 'The role reconciles stock.', explanation: 'Compare physical counts with the ledger.', exercises: ['Reconcile a sample ledger.'], self_check_questions: ['What causes discrepancies?'] }] } }
const task = { __typename: 'AiTask' as const, id: 'guide-1', status: 'COMPLETED', result, errorMessage: null, createdAt: '2026-10-25T12:00:00Z' }

it('starts collapsed and restores a saved guide when opened', async () => {
  renderPage({ path: '/', url: '/', element: <StudyGuideCard jobId="job-1" hasDescription />, mocks: [{
    request: { query: STUDY_GUIDE_QUERY, variables: { jobId: 'job-1' } },
    result: { data: { job: { __typename: 'Job', id: 'job-1', latestStudyGuide: task, latestStudyGuideTask: task } } },
  }] })
  expect(screen.queryByText('Stock reconciliation')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: /Study guides/ }))
  expect(await screen.findByRole('heading', { name: /Stock reconciliation/ })).toBeInTheDocument()
  expect(screen.getByText('Reconcile a sample ledger.')).toBeInTheDocument()
  expect(screen.getByText('What causes discrepancies?')).toBeInTheDocument()
})

it('keeps a saved guide readable after a later generation fails', async () => {
  renderPage({ path: '/', url: '/', element: <StudyGuideCard jobId="job-1" hasDescription />, mocks: [{
    request: { query: STUDY_GUIDE_QUERY, variables: { jobId: 'job-1' } },
    result: { data: { job: { __typename: 'Job', id: 'job-1', latestStudyGuide: task, latestStudyGuideTask: { ...task, id: 'failed-1', status: 'FAILED', result: null, errorMessage: 'Provider unavailable.' } } } },
  }] })
  await userEvent.click(screen.getByRole('button', { name: /Study guides/ }))
  expect(await screen.findByText('Provider unavailable.')).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: /Stock reconciliation/ })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Generate another guide' })).toBeEnabled()
})

it('explains a missing description without offering an enabled generation action', async () => {
  renderPage({ path: '/', url: '/', element: <StudyGuideCard jobId="job-1" hasDescription={false} />, mocks: [{
    request: { query: STUDY_GUIDE_QUERY, variables: { jobId: 'job-1' } },
    result: { data: { job: { __typename: 'Job', id: 'job-1', latestStudyGuide: null, latestStudyGuideTask: null } } },
  }] })
  await userEvent.click(screen.getByRole('button', { name: /Study guides/ }))
  expect(await screen.findByText('Add a job description to generate a study guide.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Generate study guide' })).toBeDisabled()
})

it('starts generation, follows live completion, and fetches the saved guide', async () => {
  renderPage({ path: '/', url: '/', element: <StudyGuideCard jobId="job-1" hasDescription />, mocks: [
    { request: { query: STUDY_GUIDE_QUERY, variables: { jobId: 'job-1' } }, result: { data: { job: { __typename: 'Job', id: 'job-1', latestStudyGuide: null, latestStudyGuideTask: null } } } },
    { request: { query: GENERATE_STUDY_GUIDE_MUTATION, variables: { jobId: 'job-1' } }, result: { data: { generateStudyGuide: { __typename: 'GenerateStudyGuidePayload', aiTask: { ...task, status: 'QUEUED', result: null }, errors: [] } } } },
    { request: { query: AI_TASK_UPDATED_SUBSCRIPTION, variables: { id: 'guide-1' } }, result: { data: { aiTaskUpdated: { ...task, taskType: 'GENERATE_STUDY_GUIDE', input: {}, pendingQuestions: [], acceptedAt: null, job: { __typename: 'Job', id: 'job-1' } } } } },
    { request: { query: STUDY_GUIDE_QUERY, variables: { jobId: 'job-1' } }, result: { data: { job: { __typename: 'Job', id: 'job-1', latestStudyGuide: task, latestStudyGuideTask: task } } } },
  ] })
  await userEvent.click(screen.getByRole('button', { name: /Study guides/ }))
  const generate = await screen.findByRole('button', { name: 'Generate study guide' })
  await waitFor(() => expect(generate).toBeEnabled())
  await userEvent.click(generate)
  expect(await screen.findByRole('heading', { name: /Stock reconciliation/ })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Generate another guide' })).toBeEnabled()
})
