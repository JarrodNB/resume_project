/** Exercises owned history selection, live generation, and durable learning material without a browser. */
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, beforeEach, vi } from 'vitest'
import { useState } from 'react'
import { useParams } from 'react-router'
import { renderPage } from '@/test/renderPage'
import { StudyGuideCard } from './StudyGuideCard'
import { AI_TASK_UPDATED_SUBSCRIPTION } from '@/features/ai-tasks/aiTaskOperations'
import { GENERATE_STUDY_GUIDE_MUTATION, STUDY_GUIDE_QUERY, STUDY_GUIDE_CONTENT_QUERY } from './studyGuideOperations'

beforeEach(() => localStorage.clear())
const result = (title = 'Inventory study guide') => ({ study_guide: { title, topics: [{ title: 'Stock reconciliation', why_it_matters: 'The role reconciles stock.', explanation: 'Compare physical counts with the ledger.', exercises: ['Reconcile a sample ledger.'], self_check_questions: ['What causes discrepancies?'] }] } })
const saved = { __typename: 'AiTask' as const, id: 'guide-1', status: 'COMPLETED', errorMessage: null as string | null, createdAt: '2026-10-25T12:00:00Z', studyGuideRetryAfterSeconds: null as number | null }
const summary = (id = saved.id, createdAt = saved.createdAt, sourceDescriptionFingerprint = 'original') => ({ __typename: 'StudyGuideSummary' as const, id, createdAt, sourceDescriptionFingerprint, outOfDate: sourceDescriptionFingerprint !== 'original' })
function historyMock({ guides = [summary()], nextCursor = null as string | null, cursor = null as string | null, task = saved as typeof saved | null, jobId = 'job-1', errors = [] as string[], fingerprint = 'original' } = {}) {
  return { request: { query: STUDY_GUIDE_QUERY, variables: { jobId, cursor } }, result: { data: { job: { __typename: 'Job', id: jobId, studyGuideDescriptionFingerprint: fingerprint, studyGuides: { __typename: 'StudyGuideHistoryPage', guides, nextCursor, errors }, latestStudyGuideTask: task } } } }
}
function contentMock(id = saved.id, title = 'Inventory study guide', jobId = 'job-1') {
  return { request: { query: STUDY_GUIDE_CONTENT_QUERY, variables: { jobId, guideId: id } }, result: { data: { job: { __typename: 'Job', id: jobId, studyGuide: { __typename: 'AiTask', id, result: result(title), createdAt: saved.createdAt, studyGuideOutOfDate: false } } } } }
}
async function open() { await userEvent.click(screen.getByRole('button', { name: /Study guides/ })) }

function queuedSubscription(task: typeof saved) {
  return { request: { query: AI_TASK_UPDATED_SUBSCRIPTION, variables: { id: task.id } }, result: { data: { aiTaskUpdated: {
    ...task, result: null, taskType: 'GENERATE_STUDY_GUIDE', input: {}, pendingQuestions: [], acceptedAt: null,
    job: { __typename: 'Job', id: 'job-1' },
  } } } }
}

it('lets a reloaded expired generation retry manually without losing saved guides', async () => {
  const expired = { ...saved, id: 'expired', status: 'QUEUED', studyGuideRetryAfterSeconds: 0 }
  const retry = { ...saved, id: 'retry', status: 'QUEUED', studyGuideRetryAfterSeconds: 900 }
  const generated = vi.fn(() => ({ data: { generateStudyGuide: { __typename: 'GenerateStudyGuidePayload', aiTask: retry, errors: [] } } }))
  renderPage({ path: '/', url: '/', element: <StudyGuideCard jobId="job-1" description="Original description" />, mocks: [
    historyMock({ task: expired }), contentMock(), queuedSubscription(expired),
    { request: { query: GENERATE_STUDY_GUIDE_MUTATION, variables: { jobId: 'job-1' } }, result: generated }, queuedSubscription(retry),
  ] })
  await open()
  expect(await screen.findByRole('heading', { name: 'Inventory study guide' })).toBeInTheDocument()
  const recover = await screen.findByRole('button', { name: 'Retry study guide' })
  expect(recover).toBeEnabled()
  expect(generated).not.toHaveBeenCalled()
  await userEvent.click(recover)
  await waitFor(() => expect(generated).toHaveBeenCalledTimes(1))
  expect(screen.getByRole('heading', { name: 'Inventory study guide' })).toBeInTheDocument()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Generate another guide' })).toBeDisabled())
})

it('offers manual recovery when the server wait expires while the reader stays open', async () => {
  const pending = { ...saved, id: 'pending', status: 'QUEUED', studyGuideRetryAfterSeconds: 0.2 }
  const generated = vi.fn(() => ({ data: { generateStudyGuide: { __typename: 'GenerateStudyGuidePayload', aiTask: saved, errors: [] } } }))
  renderPage({ path: '/', url: '/', element: <StudyGuideCard jobId="job-1" description="Original description" />, mocks: [
    historyMock({ task: pending }), contentMock(), queuedSubscription(pending),
    { request: { query: GENERATE_STUDY_GUIDE_MUTATION, variables: { jobId: 'job-1' } }, result: generated },
  ] })
  await open()
  expect(await screen.findByRole('heading', { name: 'Inventory study guide' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Generate another guide' })).toBeDisabled()
  expect(await screen.findByRole('button', { name: 'Retry study guide' })).toBeEnabled()
  expect(screen.getByRole('heading', { name: 'Inventory study guide' })).toBeInTheDocument()
  expect(generated).not.toHaveBeenCalled()
})

it('updates every loaded guide after a description edit and restoration without automatically generating', async () => {
  const generated = vi.fn(() => ({ data: { generateStudyGuide: { __typename: 'GenerateStudyGuidePayload', aiTask: saved, errors: [] } } }))
  function EditableDescription() {
    const [description, setDescription] = useState('Original description')
    return <><button onClick={() => setDescription('Edited description')}>Edit description</button>
      <button onClick={() => setDescription('Original description')}>Restore description</button>
      <StudyGuideCard jobId="job-1" description={description} /></>
  }
  renderPage({ path: '/', url: '/', element: <EditableDescription />, mocks: [
    historyMock({ nextCursor: 'page-2' }), contentMock(),
    historyMock({ cursor: 'page-2', guides: [summary('older')] }), contentMock('older', 'Older guide'),
    historyMock({ fingerprint: 'edited', nextCursor: 'page-2' }),
    historyMock({ fingerprint: 'original', nextCursor: 'page-2' }),
    { request: { query: GENERATE_STUDY_GUIDE_MUTATION, variables: { jobId: 'job-1' } }, result: generated },
  ] })
  await open()
  expect(await screen.findByRole('heading', { name: 'Inventory study guide' })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Load older guides' }))
  await waitFor(() => expect(screen.getAllByRole('button', { name: /Read guide from/ })).toHaveLength(2))
  await userEvent.click(screen.getAllByRole('button', { name: /Read guide from/ })[1])
  expect(await screen.findByRole('heading', { name: 'Older guide' })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Edit description' }))
  expect(await screen.findByText('This guide is out of date because the job description changed. Generate another guide when you’re ready.')).toBeInTheDocument()
  expect(screen.getAllByRole('button', { name: /Read guide from.*Out of date/ })).toHaveLength(2)
  expect(screen.getByRole('heading', { name: 'Older guide' })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Restore description' }))
  await waitFor(() => expect(screen.queryByText('This guide is out of date because the job description changed. Generate another guide when you’re ready.')).not.toBeInTheDocument())
  expect(screen.queryAllByRole('button', { name: /Read guide from.*Out of date/ })).toHaveLength(0)
  expect(screen.getByRole('heading', { name: 'Older guide' })).toBeInTheDocument()
  expect(generated).not.toHaveBeenCalled()
})

it('restores per-guide freshness on load and keeps a stale guide readable when selected', async () => {
  renderPage({ path: '/', url: '/', element: <StudyGuideCard jobId="job-1" description="Edited description" />, mocks: [
    historyMock({ fingerprint: 'edited', guides: [summary('current', saved.createdAt, 'edited'), summary('previous', '2026-10-24T11:00:00Z')], task: { ...saved, id: 'current' } }),
    contentMock('current', 'Current guide'), contentMock('previous', 'Previous guide'),
  ] })
  await open()
  expect(await screen.findByRole('heading', { name: 'Current guide' })).toBeInTheDocument()
  expect(screen.queryByText(/This guide is out of date/)).not.toBeInTheDocument()
  const previous = screen.getByRole('button', { name: /Read guide from.*Out of date/ })
  await userEvent.click(previous)
  expect(await screen.findByRole('heading', { name: 'Previous guide' })).toBeInTheDocument()
  expect(screen.getByText(/This guide is out of date/)).toBeInTheDocument()
})

it('refreshes again when a newer saved edit arrives while the previous freshness read is pending', async () => {
  const edited = historyMock({ fingerprint: 'edited' })
  const restored = historyMock({ fingerprint: 'original' })
  const readEdited = vi.fn(() => edited.result)
  const readRestored = vi.fn(() => restored.result)
  function EditableDescription() {
    const [description, setDescription] = useState('Original description')
    return <><button onClick={() => setDescription('Edited description')}>Edit description</button>
      <button onClick={() => setDescription('Original description')}>Restore description</button>
      <StudyGuideCard jobId="job-1" description={description} /></>
  }
  renderPage({ path: '/', url: '/', element: <EditableDescription />, mocks: [
    historyMock(), contentMock(), { ...edited, delay: 200, result: readEdited }, { ...restored, result: readRestored },
  ] })
  await open()
  expect(await screen.findByRole('heading', { name: 'Inventory study guide' })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Edit description' }))
  await userEvent.click(screen.getByRole('button', { name: 'Restore description' }))
  await waitFor(() => expect(readRestored).toHaveBeenCalledTimes(1))
  expect(readEdited).toHaveBeenCalledTimes(1)
  await waitFor(() => expect(screen.queryByText(/This guide is out of date/)).not.toBeInTheDocument())
  expect(screen.getByRole('heading', { name: 'Inventory study guide' })).toBeInTheDocument()
})

it('keeps old material readable but stale and disables generation when the description is blank', async () => {
  renderPage({ path: '/', url: '/', element: <StudyGuideCard jobId="job-1" description={null} />, mocks: [historyMock({ fingerprint: 'empty' }), contentMock()] })
  await open()
  expect(await screen.findByRole('heading', { name: 'Inventory study guide' })).toBeInTheDocument()
  expect(screen.getByText(/This guide is out of date/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Generate another guide' })).toBeDisabled()
})

it('shows a completed guide as stale when the description changed during its generation', async () => {
  const queued = { ...saved, status: 'QUEUED' }
  const generated = vi.fn(() => ({ data: { generateStudyGuide: { __typename: 'GenerateStudyGuidePayload', aiTask: queued, errors: [] } } }))
  function EditableDescription() {
    const [description, setDescription] = useState('Original description')
    return <><button onClick={() => setDescription('Edited description')}>Edit description</button>
      <StudyGuideCard jobId="job-1" description={description} /></>
  }
  renderPage({ path: '/', url: '/', element: <EditableDescription />, mocks: [
    historyMock({ guides: [], task: null }),
    { request: { query: GENERATE_STUDY_GUIDE_MUTATION, variables: { jobId: 'job-1' } }, result: generated },
    { request: { query: AI_TASK_UPDATED_SUBSCRIPTION, variables: { id: saved.id } }, delay: 300, result: { data: { aiTaskUpdated: { ...saved, result: result(), taskType: 'GENERATE_STUDY_GUIDE', input: {}, pendingQuestions: [], acceptedAt: null, job: { __typename: 'Job', id: 'job-1' } } } } },
    { ...historyMock({ guides: [], task: queued, fingerprint: 'edited' }), delay: 500 },
    historyMock({ fingerprint: 'edited' }), contentMock(),
  ] })
  await open()
  const generate = await screen.findByRole('button', { name: 'Generate study guide' })
  await waitFor(() => expect(generate).toBeEnabled())
  await userEvent.click(generate)
  expect(await screen.findByText(/Generating your study guide/)).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Edit description' }))
  expect(await screen.findByRole('heading', { name: 'Inventory study guide' })).toBeInTheDocument()
  expect(screen.getByText(/This guide is out of date/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Read guide from.*Out of date/ })).toBeInTheDocument()
  expect(generated).toHaveBeenCalledTimes(1)
})

it('starts collapsed, loads only selected content, and reads older guides from history', async () => {
  renderPage({ path: '/', url: '/', element: <StudyGuideCard jobId="job-1" description="Original description" />, mocks: [historyMock({ guides: [summary(), summary('older', '2026-10-24T11:00:00Z')] }), contentMock(), contentMock('older', 'Earlier inventory guide')] })
  expect(screen.queryByText('Inventory study guide')).not.toBeInTheDocument()
  await open()
  expect(await screen.findByRole('heading', { name: 'Inventory study guide' })).toBeInTheDocument()
  const choices = screen.getAllByRole('button', { name: /Read guide from/ })
  expect(choices).toHaveLength(2)
  expect(choices[0]).toHaveAttribute('aria-pressed', 'true')
  await userEvent.click(choices[1])
  expect(await screen.findByRole('heading', { name: 'Earlier inventory guide' })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Inventory study guide' })).not.toBeInTheDocument()
  expect(choices[1]).toHaveAttribute('aria-pressed', 'true')
})

it('keeps saved guides readable after a later generation fails', async () => {
  renderPage({ path: '/', url: '/', element: <StudyGuideCard jobId="job-1" description="Original description" />, mocks: [historyMock({ task: { ...saved, id: 'failed-1', status: 'FAILED', errorMessage: 'Provider unavailable.' } as typeof saved }), contentMock()] })
  await open()
  expect(await screen.findByText('Provider unavailable.')).toBeInTheDocument()
  expect(await screen.findByRole('heading', { name: 'Inventory study guide' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Generate another guide' })).toBeEnabled()
})

it('explains a missing description and disables generation', async () => {
  renderPage({ path: '/', url: '/', element: <StudyGuideCard jobId="job-1" description={null} />, mocks: [historyMock({ guides: [], task: null })] })
  await open()
  expect(await screen.findByText('Add a job description to generate a study guide.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Generate study guide' })).toBeDisabled()
})

it('starts generation, follows completion, and adds its history entry once', async () => {
  renderPage({ path: '/', url: '/', element: <StudyGuideCard jobId="job-1" description="Original description" />, mocks: [
    historyMock({ guides: [], task: null }),
    { request: { query: GENERATE_STUDY_GUIDE_MUTATION, variables: { jobId: 'job-1' } }, result: { data: { generateStudyGuide: { __typename: 'GenerateStudyGuidePayload', aiTask: { ...saved, status: 'QUEUED' }, errors: [] } } } },
    { request: { query: AI_TASK_UPDATED_SUBSCRIPTION, variables: { id: saved.id } }, result: { data: { aiTaskUpdated: { ...saved, result: result(), taskType: 'GENERATE_STUDY_GUIDE', input: {}, pendingQuestions: [], acceptedAt: null, job: { __typename: 'Job', id: 'job-1' } } } } },
    historyMock(), contentMock(),
  ] })
  await open()
  const generate = await screen.findByRole('button', { name: 'Generate study guide' })
  await waitFor(() => expect(generate).toBeEnabled())
  await userEvent.click(generate)
  expect(await screen.findByRole('heading', { name: 'Inventory study guide' })).toBeInTheDocument()
  expect(screen.getAllByRole('button', { name: /Read guide from/ })).toHaveLength(1)
})

it('loads older pages, retains entries, and deduplicates page overlap', async () => {
  renderPage({ path: '/', url: '/', element: <StudyGuideCard jobId="job-1" description="Original description" />, mocks: [historyMock({ nextCursor: 'page-2' }), contentMock(), historyMock({ cursor: 'page-2', guides: [summary(), summary('older')], task: saved }), contentMock('older', 'Older guide')] })
  await open()
  expect(await screen.findByRole('heading', { name: 'Inventory study guide' })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Load older guides' }))
  await waitFor(() => expect(screen.getAllByRole('button', { name: /Read guide from/ })).toHaveLength(2))
  expect(screen.queryByRole('button', { name: 'Load older guides' })).not.toBeInTheDocument()
  await userEvent.click(screen.getAllByRole('button', { name: /Read guide from/ })[1])
  expect(await screen.findByRole('heading', { name: 'Older guide' })).toBeInTheDocument()
})

it('keeps a selected older guide while a new successful guide appears once in history', async () => {
  const newer = { ...saved, id: 'newer', createdAt: '2026-10-25T12:01:01Z' }
  renderPage({ path: '/', url: '/', element: <StudyGuideCard jobId="job-1" description="Original description" />, mocks: [
    historyMock({ guides: [summary(), summary('older', '2026-10-24T11:00:00Z')] }), contentMock(), contentMock('older', 'Earlier inventory guide'),
    { request: { query: GENERATE_STUDY_GUIDE_MUTATION, variables: { jobId: 'job-1' } }, result: { data: { generateStudyGuide: { __typename: 'GenerateStudyGuidePayload', aiTask: { ...newer, status: 'QUEUED' }, errors: [] } } } },
    { request: { query: AI_TASK_UPDATED_SUBSCRIPTION, variables: { id: newer.id } }, result: { data: { aiTaskUpdated: { ...newer, result: result('New guide'), taskType: 'GENERATE_STUDY_GUIDE', input: {}, pendingQuestions: [], acceptedAt: null, job: { __typename: 'Job', id: 'job-1' } } } } },
    historyMock({ guides: [summary(newer.id, newer.createdAt), summary(), summary('older', '2026-10-24T11:00:00Z')], task: newer }),
    contentMock(newer.id, 'New guide'),
  ] })
  await open()
  expect(await screen.findByRole('heading', { name: 'Inventory study guide' })).toBeInTheDocument()
  await userEvent.click(screen.getAllByRole('button', { name: /Read guide from/ })[1])
  expect(await screen.findByRole('heading', { name: 'Earlier inventory guide' })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Generate another guide' }))
  await waitFor(() => expect(screen.getAllByRole('button', { name: /Read guide from/ })).toHaveLength(3))
  expect(screen.getByRole('heading', { name: 'Earlier inventory guide' })).toBeInTheDocument()
  await userEvent.click(screen.getAllByRole('button', { name: /Read guide from/ })[0])
  expect(await screen.findByRole('heading', { name: 'New guide' })).toBeInTheDocument()
})

it('preserves history when an older page fails and retries the same continuation', async () => {
  renderPage({ path: '/', url: '/', element: <StudyGuideCard jobId="job-1" description="Original description" />, mocks: [
    historyMock({ nextCursor: 'page-2' }), contentMock(),
    { request: { query: STUDY_GUIDE_QUERY, variables: { jobId: 'job-1', cursor: 'page-2' } }, error: new Error('Temporary history outage') },
    historyMock({ cursor: 'page-2', guides: [summary('older')] }),
  ] })
  await open()
  expect(await screen.findByRole('heading', { name: 'Inventory study guide' })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Load older guides' }))
  expect(await screen.findByText("Couldn't load older guides. Try again.")).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Inventory study guide' })).toBeInTheDocument()
  expect(screen.getAllByRole('button', { name: /Read guide from/ })).toHaveLength(1)
  await userEvent.click(screen.getByRole('button', { name: 'Load older guides' }))
  await waitFor(() => expect(screen.getAllByRole('button', { name: /Read guide from/ })).toHaveLength(2))
})

it('resets history and selection when the route switches jobs', async () => {
  function JobGuides() { return <StudyGuideCard jobId={useParams().id!} description="Original description" /> }
  const view = renderPage({ path: '/jobs/:id', url: '/jobs/job-1', element: <JobGuides />, mocks: [historyMock(), contentMock(), historyMock({ jobId: 'job-2', guides: [summary('second')], task: null }), contentMock('second', 'Second job guide', 'job-2')] })
  await open()
  expect(await screen.findByRole('heading', { name: 'Inventory study guide' })).toBeInTheDocument()
  await view.router.navigate('/jobs/job-2')
  await waitFor(() => expect(screen.getByRole('button', { name: /Study guides/ })).toHaveAttribute('aria-expanded', 'false'))
  await open()
  expect(await screen.findByRole('heading', { name: 'Second job guide' })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Inventory study guide' })).not.toBeInTheDocument()
  expect(screen.getAllByRole('button', { name: /Read guide from/ })).toHaveLength(1)
})
