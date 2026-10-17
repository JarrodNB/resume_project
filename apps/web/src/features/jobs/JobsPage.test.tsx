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
          createdAt: '2026-10-01T00:00:00Z',
        },
      ]),
    ],
  })

  expect(await screen.findByText('AI Engineer')).toBeInTheDocument()
  expect(screen.getByText(`${company ?? 'Unknown company'} · Remote`)).toBeInTheDocument()
  expect(screen.getByText('Not applied')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /AI Engineer/ })).toHaveAttribute('href', '/jobs/job-1')
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
