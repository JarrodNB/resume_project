/** Exercises the durable job collection, navigation, live append, freshness and manual recovery. */
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, beforeEach, vi } from 'vitest'
import { useState } from 'react'
import { useParams } from 'react-router'
import { renderPage } from '@/test/renderPage'
import { StudyGuidePanel } from './StudyGuidePanel'
import { AI_TASK_UPDATED_SUBSCRIPTION } from '@/features/ai-tasks/aiTaskOperations'
import { GENERATE_STUDY_GUIDE_MUTATION, STUDY_QUESTION_COLLECTION_QUERY } from './studyGuideOperations'

beforeEach(() => localStorage.clear())
const result = (start = 1) => ({ study_guide: { version: 1, title: 'Inventory questions', questions: Array.from({ length: 5 }, (_, i) => ({ question: `How do you count stock ${start + i}?`, why_it_matters: 'Accurate stock counts.', answer: `Count carefully ${start + i}.`, example: 'Count 10 versus 12 recorded: investigate the missing 2.' })) } })
const saved = { __typename: 'AiTask' as const, id: 'task-1', status: 'COMPLETED', errorMessage: null as string | null, createdAt: '2026-10-25T12:00:00Z', studyGuideRetryAfterSeconds: null as number | null }
const batch = (id = 'batch-1', start = 1, fingerprint = 'original') => ({ __typename: 'StudyQuestionBatch', id, result: result(start), sourceDescriptionFingerprint: fingerprint, outOfDate: false })
function page({ batches = [batch()], total = 5, endCursor = 'after-1' as string | null, cursor = null as string | null, task = saved as typeof saved | null, jobId = 'job-1', fingerprint = 'original' } = {}) {
  return { request: { query: STUDY_QUESTION_COLLECTION_QUERY, variables: { jobId, cursor } }, result: { data: { job: { __typename: 'Job', id: jobId, studyGuideDescriptionFingerprint: fingerprint, studyQuestionBatches: { __typename: 'StudyQuestionBatchPage', batches, endCursor, totalQuestions: total, errors: [] }, latestStudyGuideTask: task } } } }
}
function subscription(task: typeof saved, delay = 0) {
  return { request: { query: AI_TASK_UPDATED_SUBSCRIPTION, variables: { id: task.id } }, delay, result: { data: { aiTaskUpdated: { ...task, taskType: 'GENERATE_STUDY_GUIDE', input: {}, result: null, pendingQuestions: [], acceptedAt: null, job: { __typename: 'Job', id: 'job-1' } } } } }
}
function generate(task = { ...saved, id: 'new', status: 'QUEUED' }) {
  return { request: { query: GENERATE_STUDY_GUIDE_MUTATION, variables: { jobId: 'job-1' } }, result: { data: { generateStudyGuide: { __typename: 'GenerateStudyGuidePayload', aiTask: task, errors: [] } } } }
}
function render(mocks: object[], description: string | null = 'Stock') { return renderPage({ path: '/', url: '/', element: <StudyGuidePanel jobId="job-1" description={description} />, mocks: mocks as Parameters<typeof renderPage>[0]['mocks'] }) }
async function ready() { await screen.findByRole('heading', { name: 'How do you count stock 1?' }) }
async function next(times = 1) { for (let i = 0; i < times; i++) await userEvent.click(screen.getByRole('button', { name: 'Next' })) }

it('reveals one explained answer and navigates with focus and the saved total', async () => {
  render([page()]); await ready()
  expect(screen.getByText('Question 1 of 5')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()
  expect(screen.queryByText('Count carefully 1.')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Show answer' }))
  expect(screen.getByText('Count carefully 1.')).toBeInTheDocument()
  await next()
  expect(screen.getByRole('heading', { name: 'How do you count stock 2?' })).toHaveFocus()
  expect(screen.getByRole('button', { name: 'Show answer' })).toHaveAttribute('aria-expanded', 'false')
  await next(3)
  expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Generate 5 more' })).toBeEnabled()
})

it('loads the next saved batch and goes back without refetching', async () => {
  render([page({ total: 10 }), page({ cursor: 'after-1', batches: [batch('batch-2', 6)], total: 10, endCursor: 'after-2' })]); await ready(); await next(5)
  expect(await screen.findByRole('heading', { name: 'How do you count stock 6?' })).toBeInTheDocument()
  expect(screen.getByText('Question 6 of 10')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Previous' }))
  expect(screen.getByRole('heading', { name: 'How do you count stock 5?' })).toBeInTheDocument()
})

it('keeps the current question and answer while five more finish, then reads the appended batch', async () => {
  const queued = { ...saved, id: 'new', status: 'QUEUED' }
  render([page(), generate(queued), subscription({ ...queued, status: 'COMPLETED' }, 50), page({ total: 10, task: { ...queued, status: 'COMPLETED' } }), page({ cursor: 'after-1', batches: [batch('batch-2', 6)], total: 10, endCursor: 'after-2' })]); await ready(); await next()
  await userEvent.click(screen.getByRole('button', { name: 'Show answer' }))
  await userEvent.click(screen.getByRole('button', { name: 'Generate 5 more' }))
  expect(await screen.findByText('Question 2 of 10')).toBeInTheDocument()
  expect(screen.getByText('Count carefully 2.')).toBeInTheDocument()
  await next(4)
  expect(await screen.findByRole('heading', { name: 'How do you count stock 6?' })).toBeInTheDocument()
})

it('retains the current question on page failure and retries the same cursor', async () => {
  render([page({ total: 10 }), { request: { query: STUDY_QUESTION_COLLECTION_QUERY, variables: { jobId: 'job-1', cursor: 'after-1' } }, error: new Error('page outage') }, page({ cursor: 'after-1', batches: [batch('batch-2', 6)], total: 10 })]); await ready(); await next(5)
  expect(await screen.findByText("Couldn't load more questions. Try Next again.")).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'How do you count stock 5?' })).toBeInTheDocument()
  await next()
  expect(await screen.findByRole('heading', { name: 'How do you count stock 6?' })).toBeInTheDocument()
})

it('keeps saved content beside later generation failure', async () => {
  render([page({ task: { ...saved, id: 'failed', status: 'FAILED', errorMessage: 'Provider unavailable.' } })]); await ready()
  expect(screen.getByText('Provider unavailable.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Generate 5 more' })).toBeEnabled()
})

it('starts the first batch explicitly and reads it on completion', async () => {
  const queued = { ...saved, id: 'new', status: 'QUEUED' }
  render([page({ batches: [], total: 0, endCursor: null, task: null }), generate(queued), subscription({ ...queued, status: 'COMPLETED' }), page({ task: { ...queued, status: 'COMPLETED' } })])
  const start = await screen.findByRole('button', { name: 'Generate 5 questions' })
  await waitFor(() => expect(start).toBeEnabled()); await userEvent.click(start); await ready()
})

it('offers manual retry for expired queued work without auto-generation', async () => {
  const queued = { ...saved, id: 'expired', status: 'QUEUED', studyGuideRetryAfterSeconds: 0 }
  const retry = { ...queued, id: 'retry', studyGuideRetryAfterSeconds: 900 }
  const requested = vi.fn(() => generate(retry).result)
  render([page({ task: queued }), subscription(queued), { ...generate(retry), result: requested }, subscription(retry)]); await ready()
  const button = await screen.findByRole('button', { name: 'Retry 5 questions' })
  expect(button).toBeEnabled(); expect(requested).not.toHaveBeenCalled(); await userEvent.click(button)
  await waitFor(() => expect(requested).toHaveBeenCalledTimes(1))
  expect(screen.getByRole('heading', { name: 'How do you count stock 1?' })).toBeInTheDocument()
})

it('offers manual retry when the server wait expires in the open reader', async () => {
  const queued = { ...saved, id: 'queued', status: 'QUEUED', studyGuideRetryAfterSeconds: 0.01 }
  render([page({ task: queued }), subscription(queued)])
  expect(await screen.findByRole('button', { name: 'Retry 5 questions' })).toBeEnabled()
})

function Editable() { const [description, setDescription] = useState('Original'); return <><button onClick={() => setDescription('Edited')}>Edit</button><button onClick={() => setDescription('Original')}>Restore</button><StudyGuidePanel jobId="job-1" description={description} /></> }
it('refreshes freshness for loaded later batches without moving the current question', async () => {
  renderPage({ path: '/', url: '/', element: <Editable />, mocks: [page({ total: 10 }), page({ cursor: 'after-1', batches: [batch('batch-2', 6)], total: 10 }), page({ total: 10, fingerprint: 'edited' }), page({ total: 10 })] }); await ready(); await next(5)
  await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
  expect(await screen.findByText(/This question is out of date/)).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'How do you count stock 6?' })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Restore' }))
  await waitFor(() => expect(screen.queryByText(/This question is out of date/)).not.toBeInTheDocument())
})

it('queues a final freshness read when description edits overlap', async () => {
  const restored = page(); const readRestored = vi.fn(() => restored.result)
  renderPage({ path: '/', url: '/', element: <Editable />, mocks: [page(), { ...page({ fingerprint: 'edited' }), delay: 100 }, { ...restored, result: readRestored }] }); await ready()
  await userEvent.click(screen.getByRole('button', { name: 'Edit' })); await userEvent.click(screen.getByRole('button', { name: 'Restore' }))
  await waitFor(() => expect(readRestored).toHaveBeenCalledTimes(1))
  expect(screen.queryByText(/This question is out of date/)).not.toBeInTheDocument()
})

it('keeps saved questions readable with a blank description and disables generation', async () => {
  render([page()], null); await ready()
  expect(screen.getByRole('button', { name: 'Generate 5 more' })).toBeDisabled()
  expect(screen.getByText('Add a job description to generate study questions.')).toBeInTheDocument()
})

it('resets reader state when switching jobs', async () => {
  function JobQuestions() { return <StudyGuidePanel jobId={useParams().id!} description="Stock" /> }
  const view = renderPage({ path: '/jobs/:id', url: '/jobs/job-1', element: <JobQuestions />, mocks: [page(), page({ jobId: 'job-2', batches: [batch('other', 11)] })] }); await ready(); await next()
  await userEvent.click(screen.getByRole('button', { name: 'Show answer' })); await view.router.navigate('/jobs/job-2')
  expect(await screen.findByRole('heading', { name: 'How do you count stock 11?' })).toBeInTheDocument()
  expect(screen.getByText('Question 1 of 5')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Show answer' })).toHaveAttribute('aria-expanded', 'false')
})


it('appends behind unloaded saved batches without skipping them', async () => {
  const queued = { ...saved, id: 'new', status: 'QUEUED' }
  render([page({ total: 10 }), generate(queued), subscription({ ...queued, status: 'COMPLETED' }, 20), page({ total: 15, task: { ...queued, status: 'COMPLETED' } }), page({ cursor: 'after-1', batches: [batch('batch-2', 6)], total: 15, endCursor: 'after-2' }), page({ cursor: 'after-2', batches: [batch('batch-3', 11)], total: 15, endCursor: 'after-3' })]); await ready()
  await userEvent.click(screen.getByRole('button', { name: 'Generate 5 more' }))
  expect(await screen.findByText('Question 1 of 15')).toBeInTheDocument()
  await next(5); expect(await screen.findByRole('heading', { name: 'How do you count stock 6?' })).toBeInTheDocument()
  await next(5); expect(await screen.findByRole('heading', { name: 'How do you count stock 11?' })).toBeInTheDocument()
})

it('ignores a delayed page from the previous job after navigation', async () => {
  function JobQuestions() { return <StudyGuidePanel jobId={useParams().id!} description="Stock" /> }
  const view = renderPage({ path: '/jobs/:id', url: '/jobs/job-1', element: <JobQuestions />, mocks: [page({ total: 10 }), { ...page({ cursor: 'after-1', batches: [batch('batch-2', 6)], total: 10 }), delay: 100 }, page({ jobId: 'job-2', batches: [batch('other', 11)] })] }); await ready(); await next(5)
  await view.router.navigate('/jobs/job-2')
  expect(await screen.findByRole('heading', { name: 'How do you count stock 11?' })).toBeInTheDocument()
  expect(screen.getByText('Question 1 of 5')).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'How do you count stock 6?' })).not.toBeInTheDocument()
})

it('shows a server generation-limit error without losing saved questions', async () => {
  render([page(), { ...generate(), result: { data: { generateStudyGuide: { __typename: 'GenerateStudyGuidePayload', aiTask: null, errors: ['This job has reached the study-question generation limit. Your saved questions remain available.'] } } } }]); await ready()
  await userEvent.click(screen.getByRole('button', { name: 'Generate 5 more' }))
  expect(await screen.findByText(/This job has reached the study-question generation limit/)).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'How do you count stock 1?' })).toBeInTheDocument()
})


it('reveals an optional relationship diagram and its text equivalent with the answer', async () => {
  const diagram = { caption: 'Stock reconciliation', explanation: 'Compare the physical count with recorded stock.',
    nodes: [{ id: 'count', label: 'Physical count' }, { id: 'record', label: 'Stock record' }],
    edges: [{ from_node: 'count', to_node: 'record', label: 'Compare with' }] }
  const savedBatch = batch()
  const withDiagram = { ...savedBatch, result: { study_guide: { ...savedBatch.result.study_guide,
    questions: savedBatch.result.study_guide.questions.map((question, i) => ({ ...question, diagram: i === 0 ? diagram : null })) } } }
  render([page({ batches: [withDiagram] })]); await ready()
  expect(screen.queryByRole('figure', { name: 'Stock reconciliation' })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Show answer' }))
  expect(screen.getByRole('figure', { name: 'Stock reconciliation' })).toBeInTheDocument()
  expect(screen.getByText('Compare the physical count with recorded stock.')).toBeInTheDocument()
  expect(screen.getByText('Physical count')).toBeInTheDocument()
  expect(screen.getByText('Stock record')).toBeInTheDocument()
  await next()
  await userEvent.click(screen.getByRole('button', { name: 'Show answer' }))
  expect(screen.queryByRole('figure')).not.toBeInTheDocument()
})


it.each([
  { caption: 'Broken', explanation: 'Unknown destination', nodes: [{ id: 'a', label: 'Count' }, { id: 'b', label: 'Record' }], edges: [{ from_node: 'a', to_node: 'missing', label: 'Compare' }] },
  { caption: 'Broken', explanation: 'Duplicate identifiers', nodes: [{ id: 'a', label: 'Count' }, { id: 'a', label: 'Record' }], edges: [{ from_node: 'a', to_node: 'a', label: 'Compare' }] },
  { caption: 'Broken', explanation: 'Oversized label', nodes: [{ id: 'a', label: 'x'.repeat(161) }, { id: 'b', label: 'Record' }], edges: [{ from_node: 'a', to_node: 'b', label: 'Compare' }] },
  { caption: 'Broken', explanation: 'Executable field', html: '<script>alert(1)</script>', nodes: [], edges: [] },
  'not a diagram',
])('keeps the answer readable when an optional saved diagram is malformed', async (diagram) => {
  const savedBatch = batch()
  const malformed = { ...savedBatch, result: { study_guide: { ...savedBatch.result.study_guide,
    questions: savedBatch.result.study_guide.questions.map((question) => ({ ...question, diagram })) } } }
  render([page({ batches: [malformed] })]); await ready()
  await userEvent.click(screen.getByRole('button', { name: 'Show answer' }))
  expect(screen.getByText('Count carefully 1.')).toBeInTheDocument()
  expect(screen.queryByRole('figure')).not.toBeInTheDocument()
})

it('renders long diagram labels as escaped text in both theme contexts', async () => {
  const literalLabel = ('<img src=x onerror=alert(1)> ' + 'long unbroken label '.repeat(5)).trim()
  const diagram = { caption: 'Compare stock', explanation: 'Compare the physical count with the record before investigating.',
    nodes: [{ id: 'count', label: literalLabel }, { id: 'record', label: 'Stock record' }],
    edges: [{ from_node: 'count', to_node: 'record', label: 'Compare with' }] }
  const savedBatch = batch()
  const withDiagram = { ...savedBatch, result: { study_guide: { ...savedBatch.result.study_guide,
    questions: savedBatch.result.study_guide.questions.map((question) => ({ ...question, diagram })) } } }
  const view = render([page({ batches: [withDiagram] })]); await ready()
  await userEvent.click(screen.getByRole('button', { name: 'Show answer' }))
  expect(screen.getByText(literalLabel)).toBeInTheDocument()
  expect(view.container.querySelector('img, script, iframe')).toBeNull()
  view.container.classList.add('dark')
  expect(screen.getByRole('figure', { name: 'Compare stock' })).toBeInTheDocument()
  expect(screen.getByText(literalLabel)).toBeInTheDocument()
})
