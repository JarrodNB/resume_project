/**
 * Description: The import notice says what was added in plain words, can be dismissed, hides on its
 * own, points a user with no saved jobs at saving one (and then stays), and is not restored from
 * navigation state after that state is cleared (what a refresh would load).
 */
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { renderPage } from '@/test/renderPage'
import { IMPORT_SUMMARY_NOTICE_MS, ImportSummaryNotice } from './ImportSummaryNotice'
import { TRANSIENT_ALERT_EXIT_MS } from '@/components/TransientAlert'
import { JOB_PIPELINE_QUERY } from '@/features/home/homeOperations'

const summaryState = { importSummary: { added: 3, merged: 1, added_by_section: { experiences: 2, projects: 0, educations: 1, certifications: 0, skills: 5 } } }

const savedJob = { __typename: 'JobPipelineEntry' as const, nextStep: 'COMPARE', job: { __typename: 'Job' as const, id: 'job-1', title: 'Analyst', company: null, location: null, stage: 'UNAPPLIED', createdAt: '2026-10-01T00:00:00Z', appliedAt: null } }

/** Renders the notice as if the library was just opened with this navigation state. */
function renderNotice(historyState: unknown = summaryState, jobPipeline: unknown[] = [savedJob]) {
  return renderPage({
    path: '/library',
    url: '/library',
    historyState,
    element: <ImportSummaryNotice />,
    mocks: [{ request: { query: JOB_PIPELINE_QUERY }, result: { data: { jobPipeline } } }],
  })
}

afterEach(() => {
  vi.useRealTimers()
})

it('shows the import counts and drops them from the history entry', async () => {
  window.history.replaceState({ usr: summaryState, key: 'test', idx: 0 }, '', '/library')
  renderNotice()

  expect(screen.getByText('Added 2 roles, 1 education entry and 5 skills. 1 entry matched one you already had, so it was merged into it.')).toBeInTheDocument()
  await waitFor(() => expect(window.history.state.usr).toBeNull())
  expect(screen.getByText('Resume imported')).toBeInTheDocument()
})

it('hides when dismissed', async () => {
  renderNotice()

  await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))

  await waitFor(() => expect(screen.queryByText('Resume imported')).not.toBeInTheDocument())
})

it('hides on its own after a few seconds', async () => {
  vi.useFakeTimers()
  renderNotice()

  expect(screen.getByText('Resume imported')).toBeInTheDocument()
  await act(async () => {
    await vi.advanceTimersByTimeAsync(IMPORT_SUMMARY_NOTICE_MS)
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(TRANSIENT_ALERT_EXIT_MS)
  })

  expect(screen.queryByText('Resume imported')).not.toBeInTheDocument()
})

it('shows nothing when opened without an import summary, as a refresh would', () => {
  renderNotice(null)

  expect(screen.queryByText('Resume imported')).not.toBeInTheDocument()
})

it('points a user with no saved jobs at saving one, and stays until dismissed', async () => {
  renderNotice(summaryState, [])

  expect(await screen.findByText('Next: save a job you want.')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Find jobs' })).toHaveAttribute('href', '/jobs/find')
  expect(screen.getByRole('link', { name: 'paste a job ad' })).toHaveAttribute('href', '/jobs/paste')
  expect(screen.getByRole('link', { name: 'add a posting link' })).toHaveAttribute('href', '/jobs/new')
  vi.useFakeTimers()
  await act(async () => {
    await vi.advanceTimersByTimeAsync(IMPORT_SUMMARY_NOTICE_MS + TRANSIENT_ALERT_EXIT_MS)
  })
  expect(screen.getByText('Resume imported')).toBeInTheDocument()
})

it('leaves out the next step once a job is saved', async () => {
  renderNotice()

  expect(screen.getByText('Resume imported')).toBeInTheDocument()
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  expect(screen.queryByText('Next: save a job you want.')).not.toBeInTheDocument()
})
