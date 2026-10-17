/**
 * Description: Editing a job, moving its stage, deleting it, and starting a resume from the job page.
 */
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'
import { renderPage } from '@/test/renderPage'
import { JobDetailPage } from './JobDetailPage'
import { DELETE_JOB_MUTATION, JOB_QUERY, MOVE_JOB_TO_STAGE_MUTATION, UPDATE_JOB_MUTATION } from './jobsOperations'

function job(overrides: Record<string, unknown> = {}) {
  return {
    __typename: 'Job',
    id: 'job-1',
    title: 'Engineer',
    company: 'Acme',
    location: 'Remote',
    stage: 'UNAPPLIED',
    url: null,
    description: null,
    notes: null,
    appliedAt: null,
    requirements: ['Python'],
    responsibilities: [],
    niceToHaves: [],
    gapResponses: [],
    latestGapAnalysis: null,
    resume: null,
    ...overrides,
  }
}

function jobQuery(data: ReturnType<typeof job>) {
  return { request: { query: JOB_QUERY, variables: { id: 'job-1' } }, result: { data: { job: data } } }
}

const savedAttributes = {
  title: 'Senior Engineer',
  company: 'Acme',
  location: null,
  url: null,
  notes: null,
  description: null,
  requirements: ['Python'],
  responsibilities: [],
  niceToHaves: [],
}

it('saves an edit and clears an optional field', async () => {
  const user = userEvent.setup()
  renderPage({
    path: '/jobs/:id',
    url: '/jobs/job-1',
    element: <JobDetailPage />,
    mocks: [
      jobQuery(job()),
      {
        request: { query: UPDATE_JOB_MUTATION, variables: { id: 'job-1', attributes: savedAttributes } },
        result: { data: { updateJob: { __typename: 'UpdateJobPayload', errors: [] } } },
      },
      jobQuery(job({ title: 'Senior Engineer', location: null })),
    ],
  })

  await user.click(await screen.findByRole('button', { name: 'Edit' }))
  await user.clear(screen.getByLabelText('Title'))
  await user.type(screen.getByLabelText('Title'), 'Senior Engineer')
  await user.clear(screen.getByLabelText('Location'))
  await user.click(screen.getByRole('button', { name: 'Save' }))

  expect(await screen.findByRole('heading', { name: 'Senior Engineer' })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Edit job' })).not.toBeInTheDocument()
  expect(screen.queryByText('Remote')).not.toBeInTheDocument()
})

it('clears the company and displays Unknown company', async () => {
  const user = userEvent.setup()
  renderPage({
    path: '/jobs/:id',
    url: '/jobs/job-1',
    element: <JobDetailPage />,
    mocks: [
      jobQuery(job()),
      {
        request: { query: UPDATE_JOB_MUTATION, variables: { id: 'job-1', attributes: { ...savedAttributes, title: 'Engineer', company: null, location: 'Remote' } } },
        result: { data: { updateJob: { __typename: 'UpdateJobPayload', errors: [] } } },
      },
      jobQuery(job({ company: null })),
    ],
  })

  await user.click(await screen.findByRole('button', { name: 'Edit' }))
  await user.clear(screen.getByLabelText('Company'))
  await user.click(screen.getByRole('button', { name: 'Save' }))

  expect(await screen.findByText('Unknown company · Remote')).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Edit job' })).not.toBeInTheDocument()
})

it('opens an unknown company as an empty field and lets the user add it', async () => {
  const user = userEvent.setup()
  renderPage({
    path: '/jobs/:id', url: '/jobs/job-1', element: <JobDetailPage />,
    mocks: [
      jobQuery(job({ company: null })),
      {
        request: { query: UPDATE_JOB_MUTATION, variables: { id: 'job-1', attributes: { ...savedAttributes, title: 'Engineer', location: 'Remote' } } },
        result: { data: { updateJob: { __typename: 'UpdateJobPayload', errors: [] } } },
      },
      jobQuery(job()),
    ],
  })
  await user.click(await screen.findByRole('button', { name: 'Edit' }))
  expect(screen.getByLabelText('Company')).toHaveValue('')
  await user.type(screen.getByLabelText('Company'), 'Acme')
  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(await screen.findByText('Acme · Remote')).toBeInTheDocument()
})

it('moves the job to a new stage', async () => {
  const user = userEvent.setup()
  renderPage({
    path: '/jobs/:id',
    url: '/jobs/job-1',
    element: <JobDetailPage />,
    mocks: [
      jobQuery(job()),
      {
        request: { query: MOVE_JOB_TO_STAGE_MUTATION, variables: { id: 'job-1', stage: 'APPLIED' } },
        result: { data: { moveJobToStage: { __typename: 'MoveJobToStagePayload', errors: [] } } },
      },
      jobQuery(job({ stage: 'APPLIED', appliedAt: '2026-10-06T00:00:00Z' })),
    ],
  })

  await user.selectOptions(await screen.findByLabelText('Stage'), 'APPLIED')

  await waitFor(() => expect(screen.getByLabelText('Stage')).toHaveValue('APPLIED'))
  expect(screen.getByText(/Applied \d/)).toBeInTheDocument()
})

it('deletes the job after confirmation', async () => {
  const user = userEvent.setup()
  const { router } = renderPage({
    path: '/jobs/:id',
    url: '/jobs/job-1',
    element: <JobDetailPage />,
    extraRoutes: [{ path: '/jobs', element: <p>Jobs list</p> }],
    mocks: [
      jobQuery(job()),
      {
        request: { query: DELETE_JOB_MUTATION, variables: { id: 'job-1' } },
        result: { data: { deleteJob: { __typename: 'DeleteJobPayload', errors: [] } } },
      },
    ],
  })

  await user.click(await screen.findByRole('button', { name: 'Delete' }))
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))

  await waitFor(() => expect(router.state.location.pathname).toBe('/jobs'))
})

it('asks before writing a resume when no comparison has finished', async () => {
  const user = userEvent.setup()
  const { router } = renderPage({
    path: '/jobs/:id',
    url: '/jobs/job-1',
    element: <JobDetailPage />,
    extraRoutes: [{ path: '/jobs/:id/tailor', element: <p>Tailor</p> }],
    mocks: [jobQuery(job())],
  })

  expect(await screen.findByRole('button', { name: 'Write resume' })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Write resume' }))
  expect(screen.getByRole('heading', { name: 'Compare this job first?' })).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: 'Compare first' }))
  expect(screen.queryByRole('heading', { name: 'Compare this job first?' })).not.toBeInTheDocument()
  expect(router.state.location.pathname).toBe('/jobs/job-1')

  await user.click(screen.getByRole('button', { name: 'Write resume' }))
  await user.click(screen.getByRole('button', { name: 'Write resume anyway' }))

  await waitFor(() => expect(router.state.location.pathname).toBe('/jobs/job-1/tailor'))
})

it('writes a resume without asking after a comparison has finished', async () => {
  const user = userEvent.setup()
  const { router } = renderPage({
    path: '/jobs/:id',
    url: '/jobs/job-1',
    element: <JobDetailPage />,
    extraRoutes: [{ path: '/jobs/:id/tailor', element: <p>Tailor</p> }],
    mocks: [
      jobQuery(
        job({
          latestGapAnalysis: {
            __typename: 'AiTask',
            id: 'task-1',
            status: 'COMPLETED',
            result: null,
            errorMessage: null,
            createdAt: '2026-10-01T00:00:00Z',
          },
        }),
      ),
    ],
  })

  await user.click(await screen.findByRole('link', { name: 'Write resume' }))

  expect(screen.queryByRole('heading', { name: 'Compare this job first?' })).not.toBeInTheDocument()
  await waitFor(() => expect(router.state.location.pathname).toBe('/jobs/job-1/tailor'))
})

it('opens a resume that was already saved', async () => {
  const user = userEvent.setup()
  const { router } = renderPage({
    path: '/jobs/:id',
    url: '/jobs/job-1',
    element: <JobDetailPage />,
    extraRoutes: [{ path: '/resumes/:id', element: <p>Resume</p> }],
    mocks: [jobQuery(job({ resume: { __typename: 'Resume', id: 'resume-1' } }))],
  })

  await user.click(await screen.findByRole('link', { name: 'Open resume' }))

  await waitFor(() => expect(router.state.location.pathname).toBe('/resumes/resume-1'))
})
