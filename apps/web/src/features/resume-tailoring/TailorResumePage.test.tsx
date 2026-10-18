/**
 * The tailor page starts or restores whole-draft generation, follows completion and failure,
 * and preserves editing, exclusion, saving, and saved-resume editing.
 * The PDF preview is mocked.
 */
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { AI_TASK_UPDATED_SUBSCRIPTION } from '@/features/ai-tasks/aiTaskOperations'
import { renderPage } from '@/test/renderPage'
import { DELETE_RESUME_MUTATION } from '@/features/resumes/resumesOperations'
import { TailorResumePage } from './TailorResumePage'
import { SAVE_TAILORED_RESUME_MUTATION, START_RESUME_TAILORING_MUTATION, TAILOR_JOB_QUERY, UPDATE_RESUME_MUTATION } from './tailorOperations'

vi.mock('./ResumePdfPreview', () => ({
  ResumePdfPreview: () => <iframe title="Resume preview" />,
}))

const CREATED_AT = '2026-10-05T00:00:00Z'

function jobMock(latestTailoring: Record<string, unknown> | null, resume: Record<string, unknown> | null = null) {
  return {
    request: { query: TAILOR_JOB_QUERY, variables: { id: 'job-1' } },
    result: {
      data: {
        job: {
          __typename: 'Job',
          id: 'job-1',
          title: 'Engineer',
          company: 'Acme',
          resume,
          latestTailoring,
        },
      },
    },
  }
}

function task(fields: Record<string, unknown>) {
  return {
    __typename: 'AiTask',
    id: 'task-1',
    status: 'QUEUED',
    acceptedAt: null,
    input: {},
    pendingQuestions: [],
    result: null,
    errorMessage: null,
    ...fields,
  }
}

function subscription(fields: Record<string, unknown>) {
  return {
    request: { query: AI_TASK_UPDATED_SUBSCRIPTION, variables: { id: 'task-1' } },
    result: {
      data: {
        aiTaskUpdated: {
          __typename: 'AiTask',
          id: 'task-1',
          taskType: 'TAILOR_RESUME',
          status: 'QUEUED',
          result: null,
          input: {},
          pendingQuestions: [],
          errorMessage: null,
          acceptedAt: null,
          createdAt: CREATED_AT,
          job: { __typename: 'Job', id: 'job-1' },
          ...fields,
        },
      },
    },
  }
}

function renderTailor(mocks: Parameters<typeof renderPage>[0]['mocks']) {
  return renderPage({ path: '/jobs/:id/tailor', url: '/jobs/job-1/tailor', element: <TailorResumePage />, mocks })
}

it('restores whole-draft loading after reloading a queued task', async () => {
  renderTailor([jobMock(task({})), subscription({})])

  expect(await screen.findByText('Writing your complete draft…')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Edit again' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Use this and continue' })).not.toBeInTheDocument()
})

it('opens the complete editable draft when its subscription finishes', async () => {
  const user = userEvent.setup()
  const result = { sections: [{ section_type: 'summary', title: 'Summary', content: { text: 'Backend engineer.' } }], warnings: [] }
  const completed = { ...subscription({ status: 'COMPLETED', result }), delay: 100 }
  renderTailor([jobMock(task({})), completed])

  expect(await screen.findByText('Writing your complete draft…')).toBeInTheDocument()
  await user.click(await screen.findByRole('button', { name: 'Summary' }))
  expect(screen.getByRole('textbox', { name: 'Summary' })).toHaveValue('Backend engineer.')
  expect(screen.queryByText('Writing your complete draft…')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Use this and continue' })).not.toBeInTheDocument()
})

it('retries a failed task and follows the new task through completion', async () => {
  const user = userEvent.setup()
  const result = { sections: [{ section_type: 'summary', title: 'Summary', content: { text: 'Retried draft.' } }], warnings: [] }
  const retriedSubscription = { ...subscription({ id: 'task-2', status: 'COMPLETED', result }), delay: 500 }
  retriedSubscription.request.variables.id = 'task-2'
  renderTailor([
    jobMock(task({ status: 'FAILED', errorMessage: 'Provider unavailable.' })),
    {
      request: { query: START_RESUME_TAILORING_MUTATION, variables: { jobId: 'job-1' } },
      result: { data: { startResumeTailoring: { __typename: 'StartResumeTailoringPayload', aiTask: { __typename: 'AiTask', id: 'task-2', status: 'QUEUED' }, errors: [] } } },
    },
    retriedSubscription,
  ])

  expect(await screen.findByText('Provider unavailable.')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Try again' }))
  expect(await screen.findByText('Writing your complete draft…')).toBeInTheDocument()
  await user.click(await screen.findByRole('button', { name: 'Summary' }))
  expect(screen.getByRole('textbox', { name: 'Summary' })).toHaveValue('Retried draft.')
  expect(screen.queryByText('Provider unavailable.')).not.toBeInTheDocument()
})

it('lets the user retry after starting the draft fails', async () => {
  const user = userEvent.setup()
  renderTailor([
    jobMock(null),
    {
      request: { query: START_RESUME_TAILORING_MUTATION, variables: { jobId: 'job-1' } },
      result: { data: { startResumeTailoring: { __typename: 'StartResumeTailoringPayload', aiTask: null, errors: ['Queue unavailable.'] } } },
    },
    {
      request: { query: START_RESUME_TAILORING_MUTATION, variables: { jobId: 'job-1' } },
      result: { data: { startResumeTailoring: { __typename: 'StartResumeTailoringPayload', aiTask: { __typename: 'AiTask', id: 'task-1', status: 'QUEUED' }, errors: [] } } },
    },
    subscription({}),
  ])

  expect(await screen.findByText('Queue unavailable.')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Try again' }))
  expect(await screen.findByText('Writing your complete draft…')).toBeInTheDocument()
  expect(screen.queryByText('Queue unavailable.')).not.toBeInTheDocument()
})

it('shows omitted-section explanations alongside the completed draft', async () => {
  const result = {
    sections: [{ section_type: 'summary', title: 'Summary', content: { text: 'Backend engineer.' } }],
    warnings: ['Projects omitted: no relevant evidence.'],
  }
  renderTailor([jobMock(task({ status: 'COMPLETED', result })), subscription({ status: 'COMPLETED', result })])

  expect(await screen.findByText('Projects omitted: no relevant evidence.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Save resume' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Write it from my library anyway' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Edit again' })).not.toBeInTheDocument()
})

it('saves the finished draft', async () => {
  const user = userEvent.setup()
  const result = { sections: [{ section_type: 'summary', title: 'Summary', content: { text: 'Backend engineer.' }, omitted: false }], warnings: [] }
  renderTailor([
    jobMock(task({ status: 'COMPLETED', result })),
    subscription({ status: 'COMPLETED', result }),
    {
      request: {
        query: SAVE_TAILORED_RESUME_MUTATION,
        variables: { aiTaskId: 'task-1', sections: [{ section_type: 'summary', title: 'Summary', content: { text: 'Backend engineer.' } }] },
      },
      result: { data: { saveTailoredResume: { __typename: 'SaveTailoredResumePayload', resume: { __typename: 'Resume', id: 'resume-1', title: 'Engineer at Acme' }, errors: [] } } },
    },
    jobMock(null, { __typename: 'Resume', id: 'resume-1', title: 'Engineer at Acme', sections: [] }),
  ])

  await user.click(await screen.findByRole('button', { name: 'Save resume' }))
  expect(await screen.findByRole('heading', { name: 'Engineer at Acme' })).toBeInTheDocument()
})

it('edits a resume that was already saved and shows the preview', async () => {
  const user = userEvent.setup()
  renderTailor([
    jobMock(task({ status: 'COMPLETED', acceptedAt: CREATED_AT }), {
      __typename: 'Resume',
      id: 'resume-1',
      title: 'Engineer at Acme',
      sections: [
        { __typename: 'ResumeSection', id: 'section-1', sectionType: 'SUMMARY', title: 'Summary', position: 0, content: { text: 'Backend engineer.' } },
      ],
    }),
    {
      request: {
        query: UPDATE_RESUME_MUTATION,
        variables: { id: 'resume-1', sections: [{ id: 'section-1', content: { text: 'Backend engineer and writer.' } }] },
      },
      result: {
        data: {
          updateResume: {
            __typename: 'UpdateResumePayload',
            resume: {
              __typename: 'Resume',
              id: 'resume-1',
              title: 'Engineer at Acme',
              sections: [
                {
                  __typename: 'ResumeSection',
                  id: 'section-1',
                  sectionType: 'SUMMARY',
                  title: 'Summary',
                  position: 0,
                  content: { text: 'Backend engineer and writer.' },
                },
              ],
            },
            errors: [],
          },
        },
      },
    },
  ])

  await user.click(await screen.findByRole('button', { name: 'Summary' }))
  const summary = screen.getByRole('textbox', { name: 'Summary' })
  expect(summary).toHaveValue('Backend engineer.')
  expect(screen.queryByTitle('Resume preview')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Preview' }))
  expect(await screen.findByTitle('Resume preview')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Close' }))
  expect(screen.queryByRole('button', { name: 'Edit again' })).not.toBeInTheDocument()
  await user.clear(summary)
  await user.type(summary, 'Backend engineer and writer.')
  await user.click(screen.getByRole('button', { name: 'Save resume' }))
  expect(summary).toHaveValue('Backend engineer and writer.')
})

it('sends only edited included sections and keeps the draft when saving fails', async () => {
  const user = userEvent.setup()
  const result = {
    sections: [
      { section_type: 'summary', title: 'Summary', content: { text: 'Backend engineer.' }, omitted: false },
      { section_type: 'skills', title: 'Skills', content: { items: [{ name: 'Ruby', category: null }] }, omitted: false },
    ],
    warnings: ['Projects omitted: no relevant evidence.'],
  }
  const saveResult = vi.fn(() => ({ data: { saveTailoredResume: { __typename: 'SaveTailoredResumePayload', resume: null, errors: ['Save unavailable.'] } } }))
  renderTailor([
    jobMock(task({ status: 'COMPLETED', result })),
    subscription({ status: 'COMPLETED', result }),
    {
      request: {
        query: SAVE_TAILORED_RESUME_MUTATION,
        variables: { aiTaskId: 'task-1', sections: [{ section_type: 'summary', title: 'Summary', content: { text: 'Edited summary.' } }] },
      },
      result: saveResult,
    },
  ])

  await user.click(await screen.findByRole('button', { name: 'Summary' }))
  await user.clear(screen.getByRole('textbox', { name: 'Summary' }))
  await user.type(screen.getByRole('textbox', { name: 'Summary' }), 'Edited summary.')
  await user.click(screen.getByRole('button', { name: 'Exclude Skills' }))
  await user.click(screen.getByRole('button', { name: 'Save resume' }))
  expect(await screen.findByText('Save unavailable.')).toBeInTheDocument()
  expect(saveResult).toHaveBeenCalledOnce()
  expect(screen.getByRole('textbox', { name: 'Summary' })).toHaveValue('Edited summary.')
  expect(screen.getByRole('button', { name: 'Include Skills' })).toBeInTheDocument()
  expect(screen.getByText('Projects omitted: no relevant evidence.')).toBeInTheDocument()
})

it('shows a live generation failure without exposing partial sections for saving', async () => {
  renderTailor([
    jobMock(task({})),
    subscription({ status: 'FAILED', errorMessage: 'Draft generation failed. Please retry.', result: { sections: [{ section_type: 'summary', content: { text: 'Partial draft.' } }] } }),
  ])

  expect(await screen.findByText('Draft generation failed. Please retry.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Save resume' })).not.toBeInTheDocument()
  expect(screen.queryByRole('textbox', { name: 'Summary' })).not.toBeInTheDocument()
})

it('starts fresh from accepted history without exposing the old editable draft', async () => {
  const oldResult = { sections: [{ section_type: 'summary', title: 'Summary', content: { text: 'Old accepted draft.' } }] }
  const start = vi.fn(() => ({ data: { startResumeTailoring: { __typename: 'StartResumeTailoringPayload', aiTask: { __typename: 'AiTask', id: 'task-2', status: 'QUEUED' }, errors: [] } } }))
  const oldSubscription = subscription({ status: 'COMPLETED', acceptedAt: CREATED_AT, result: oldResult })
  const oldResultReceived = vi.fn(() => oldSubscription.result)
  const nextSubscription = subscription({ id: 'task-2' })
  nextSubscription.request.variables.id = 'task-2'
  renderTailor([jobMock(task({ status: 'COMPLETED', acceptedAt: CREATED_AT, result: oldResult })),
    { request: { query: START_RESUME_TAILORING_MUTATION, variables: { jobId: 'job-1' } }, result: start, delay: 200 }, nextSubscription,
    { ...oldSubscription, result: oldResultReceived }])
  await screen.findByRole('heading', { name: 'Write resume' })
  expect(screen.queryByRole('button', { name: 'Save resume' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Summary' })).not.toBeInTheDocument()
  expect(await screen.findByText('Writing your complete draft…')).toBeInTheDocument()
  expect(start).toHaveBeenCalledOnce()
  expect(oldResultReceived).not.toHaveBeenCalled()
})

it('allows retry when starting after accepted history fails', async () => {
  const user = userEvent.setup()
  renderTailor([jobMock(task({ status: 'COMPLETED', acceptedAt: CREATED_AT })),
    { request: { query: START_RESUME_TAILORING_MUTATION, variables: { jobId: 'job-1' } }, result: { data: { startResumeTailoring: { __typename: 'StartResumeTailoringPayload', aiTask: null, errors: ['Queue unavailable.'] } } } },
    { request: { query: START_RESUME_TAILORING_MUTATION, variables: { jobId: 'job-1' } }, result: { data: { startResumeTailoring: { __typename: 'StartResumeTailoringPayload', aiTask: { __typename: 'AiTask', id: 'task-1', status: 'QUEUED' }, errors: [] } } } },
    subscription({}),
  ])
  expect(await screen.findByText('Queue unavailable.')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Try again' }))
  expect(await screen.findByText('Writing your complete draft…')).toBeInTheDocument()
})

it('deletes from tailoring and returns to the job without starting another task', async () => {
  const user = userEvent.setup()
  const start = vi.fn(() => ({ data: { startResumeTailoring: { __typename: 'StartResumeTailoringPayload', aiTask: null, errors: ['Unexpected generation'] } } }))
  const { router } = renderPage({ path: '/jobs/:id/tailor', url: '/jobs/job-1/tailor', element: <TailorResumePage />,
    extraRoutes: [{ path: '/jobs/:id', element: <p>Saved job</p> }],
    mocks: [jobMock(task({ status: 'COMPLETED', acceptedAt: CREATED_AT }), { __typename: 'Resume', id: 'resume-1', title: 'Saved resume', sections: [] }),
      { request: { query: DELETE_RESUME_MUTATION, variables: { id: 'resume-1' } }, result: { data: { deleteResume: { __typename: 'DeleteResumePayload', resume: { __typename: 'Resume', id: 'resume-1' }, errors: [] } } } },
      { request: { query: START_RESUME_TAILORING_MUTATION, variables: { jobId: 'job-1' } }, result: start }],
  })
  await user.click(await screen.findByRole('button', { name: 'Delete resume' }))
  await user.click(screen.getByRole('button', { name: 'Delete' }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/jobs/job-1'))
  expect(start).not.toHaveBeenCalled()
})
