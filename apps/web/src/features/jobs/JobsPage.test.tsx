/**
 * Description: The jobs page lists saved jobs, shows an empty state, and adds one by hand.
 */
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'
import { renderPage } from '@/test/renderPage'
import { CREATE_JOB_MUTATION, JOBS_QUERY } from './jobsOperations'
import { JobsPage } from './JobsPage'

function jobsMock(jobs: Record<string, unknown>[]) {
  return { request: { query: JOBS_QUERY }, result: { data: { jobs } } }
}

it.each(['Acme', null])('lists saved jobs with their stage and company %s', async (company) => {
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
          company,
          location: 'Remote',
          stage: 'UNAPPLIED',
          url: 'https://acme.example/apply',
          createdAt: '2026-10-01T00:00:00Z',
        },
      ]),
    ],
  })

  expect(await screen.findByText('AI Engineer')).toBeInTheDocument()
  expect(screen.getByText(`${company ?? 'Unknown company'} · Remote`)).toBeInTheDocument()
  expect(screen.getByText('Not applied')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: `Open AI Engineer at ${company ?? 'Unknown company'}` })).toHaveAttribute('href', '/jobs/job-1')
  expect(screen.getByRole('link', { name: 'Open AI Engineer application page' })).toHaveAttribute('href', 'https://acme.example/apply')
})

it('invites the user to add a job when there are none', async () => {
  renderPage({ path: '/jobs', url: '/jobs', element: <JobsPage />, mocks: [jobsMock([])] })

  expect(await screen.findByText(/No jobs yet/)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Add job from link' })).toHaveAttribute('href', '/jobs/new')
  expect(screen.getByRole('link', { name: 'Paste a job ad' })).toHaveAttribute('href', '/jobs/paste')
})

it.each(['Acme', null])('adds a job manually with company %s and opens it', async (company) => {
  const user = userEvent.setup()
  const { router } = renderPage({
    path: '/jobs',
    url: '/jobs',
    element: <JobsPage />,
    extraRoutes: [{ path: '/jobs/:id', element: <p>Job page</p> }],
    mocks: [
      jobsMock([]),
      {
        request: {
          query: CREATE_JOB_MUTATION,
          variables: {
            attributes: {
              title: 'Engineer',
              company,
              location: null,
              url: null,
              notes: null,
              description: null,
              requirements: [],
              responsibilities: [],
              niceToHaves: [],
            },
          },
        },
        result: {
          data: {
            createJob: {
              __typename: 'CreateJobPayload',
              errors: [],
              job: { __typename: 'Job', id: 'job-9' },
            },
          },
        },
      },
      jobsMock([]),
    ],
  })

  await user.click(await screen.findByRole('button', { name: 'Add manually' }))
  await user.type(screen.getByLabelText('Title'), 'Engineer')
  if (company) await user.type(screen.getByLabelText('Company'), company)
  await user.click(screen.getByRole('button', { name: 'Save' }))

  await waitFor(() => expect(router.state.location.pathname).toBe('/jobs/job-9'))
})

it('orders jobs by pipeline stage with rejected last, newest first within a stage', async () => {
  const row = (id: string, stage: string, createdAt: string) => ({ __typename: 'Job', id, title: id, company: 'Acme', location: null, stage, url: null, createdAt })
  renderPage({
    path: '/jobs',
    url: '/jobs',
    element: <JobsPage />,
    mocks: [jobsMock([
      row('rejected', 'REJECTED', '2026-10-05T00:00:00Z'),
      row('applied', 'APPLIED', '2026-10-01T00:00:00Z'),
      row('new-unapplied', 'UNAPPLIED', '2026-10-04T00:00:00Z'),
      row('old-unapplied', 'UNAPPLIED', '2026-10-02T00:00:00Z'),
      row('interviewing', 'INTERVIEWING', '2026-10-03T00:00:00Z'),
    ])],
  })

  await screen.findByText('rejected')
  const order = screen.getAllByRole('link', { name: /^Open / }).map((link) => link.getAttribute('aria-label')?.replace(/^Open | at Acme$/g, ''))
  expect(order).toEqual(['new-unapplied', 'old-unapplied', 'applied', 'interviewing', 'rejected'])
})
