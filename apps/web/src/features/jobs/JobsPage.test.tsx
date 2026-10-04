/**
 * Description: The jobs page lists saved jobs and shows an empty state.
 */
import { screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { renderPage } from '@/test/renderPage'
import { JOBS_QUERY } from './jobsOperations'
import { JobsPage } from './JobsPage'

function jobsMock(jobs: Record<string, unknown>[]) {
  return { request: { query: JOBS_QUERY }, result: { data: { jobs } } }
}

it('lists saved jobs with their stage', async () => {
  renderPage({
    path: '/jobs',
    url: '/jobs',
    element: <JobsPage />,
    mocks: [
      jobsMock([
        {
          __typename: 'Job',
          id: 'job-1',
          title: 'AI Engineer',
          company: 'Acme',
          location: 'Remote',
          stage: 'UNAPPLIED',
          createdAt: '2026-10-01T00:00:00Z',
        },
      ]),
    ],
  })

  expect(await screen.findByText('AI Engineer')).toBeInTheDocument()
  expect(screen.getByText('Acme · Remote')).toBeInTheDocument()
  expect(screen.getByText('Not applied')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /AI Engineer/ })).toHaveAttribute('href', '/jobs/job-1')
})

it('invites the user to add a job when there are none', async () => {
  renderPage({ path: '/jobs', url: '/jobs', element: <JobsPage />, mocks: [jobsMock([])] })

  expect(await screen.findByText(/No jobs yet/)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Add job from link' })).toHaveAttribute('href', '/jobs/new')
})
