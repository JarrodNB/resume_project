/**
 * Checks the job workspace's resume pages. The Resume tab only shows what exists and never starts
 * generation; the write route starts or restores whole-draft generation, follows completion and
 * failure, and returns to the tab after saving. Editing, exclusion, saving, saved-resume editing
 * and deletion are covered too. Both render inside the real workspace layout; the PDF preview is mocked.
 */
import { downloadResumePdf, downloadResumeDocx } from './resumeDownload'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { AI_TASK_UPDATED_SUBSCRIPTION } from '@/features/ai-tasks/aiTaskOperations'
import { renderPage } from '@/test/renderPage'
import { DELETE_RESUME_MUTATION } from '@/features/resumes/resumesOperations'
import { JOB_QUERY } from '@/features/jobs/jobsOperations'
import { JobWorkspaceLayout } from '@/features/jobs/JobWorkspaceLayout'
import { JobResumeTab, WriteJobResumePage } from './JobResumeTab'
import { SAVE_TAILORED_RESUME_MUTATION, START_RESUME_TAILORING_MUTATION, TAILOR_JOB_QUERY, UPDATE_RESUME_MUTATION } from './tailorOperations'

vi.mock('./resumeDownload', () => ({ downloadResumePdf: vi.fn().mockResolvedValue(undefined), downloadResumeDocx: vi.fn().mockResolvedValue(undefined) }))

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

/** The workspace's own job load; its saved resume must agree with the tailor query's. */
function workspaceJobMock(resume: Record<string, unknown> | null = null) {
  return {
    request: { query: JOB_QUERY, variables: { id: 'job-1' } },
    result: { data: { job: {
      __typename: 'Job', id: 'job-1', title: 'Engineer', company: 'Acme', location: null, stage: 'UNAPPLIED', url: null,
      description: null, notes: null, appliedAt: null, requirements: [], responsibilities: [], niceToHaves: [],
      gapResponses: [], latestGapAnalysis: null, resume: resume && { __typename: 'Resume', includeSummary: true, id: resume.id },
    } } },
  }
}

type Mocks = NonNullable<Parameters<typeof renderPage>[0]['mocks']>

/** Renders the workspace with both resume routes; defaults to the write route, which may start a draft. */
function renderResume(mocks: Mocks, { url = '/jobs/job-1/resume/write', resume = null as Record<string, unknown> | null } = {}) {
  return renderPage({
    path: '/jobs/:id', url, element: <JobWorkspaceLayout />,
    children: [
      { path: 'resume', element: <JobResumeTab /> },
      { path: 'resume/write', element: <WriteJobResumePage /> },
    ],
    mocks: [workspaceJobMock(resume), ...mocks],
  })
}

function startMock(result: Mocks[number]['result']) {
  return { request: { query: START_RESUME_TAILORING_MUTATION, variables: { jobId: 'job-1' } }, result }
}

it('shows an empty Resume tab without starting generation', async () => {
  const start = vi.fn(() => ({ data: { startResumeTailoring: { __typename: 'StartResumeTailoringPayload', aiTask: null, errors: ['Unexpected generation'] } } }))
  const { router } = renderResume([jobMock(null), startMock(start)], { url: '/jobs/job-1/resume' })

  expect(await screen.findByRole('heading', { name: 'No resume for this job yet' })).toBeInTheDocument()
  // The header hides its own Write resume on this tab, so the empty state's button is the only one.
  expect(screen.getAllByRole('button', { name: 'Write resume' })).toHaveLength(1)
  expect(start).not.toHaveBeenCalled()
  await userEvent.setup().click(screen.getByRole('button', { name: 'Write resume' }))
  await userEvent.setup().click(screen.getByRole('button', { name: 'Write resume anyway' }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/jobs/job-1/resume/write'))
})

it('does not start a new draft from accepted history on the Resume tab', async () => {
  const start = vi.fn(() => ({ data: { startResumeTailoring: { __typename: 'StartResumeTailoringPayload', aiTask: null, errors: ['Unexpected generation'] } } }))
  renderResume([jobMock(task({ status: 'COMPLETED', acceptedAt: CREATED_AT })), startMock(start)], { url: '/jobs/job-1/resume' })

  expect(await screen.findByRole('heading', { name: 'No resume for this job yet' })).toBeInTheDocument()
  expect(start).not.toHaveBeenCalled()
})

it('follows a draft already being written when the Resume tab opens', async () => {
  renderResume([jobMock(task({})), subscription({})], { url: '/jobs/job-1/resume' })

  expect(await screen.findByText('Writing your complete draft…')).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'No resume for this job yet' })).not.toBeInTheDocument()
})

it('sends the write route to the Resume tab when a resume is already saved', async () => {
  const resume = { __typename: 'Resume', includeSummary: true, id: 'resume-1', title: 'Engineer at Acme', sections: [] }
  const { router } = renderResume([jobMock(null, resume)], { resume })

  await waitFor(() => expect(router.state.location.pathname).toBe('/jobs/job-1/resume'))
  expect(await screen.findByRole('button', { name: 'Download PDF' })).toBeInTheDocument()
})

it('restores whole-draft loading after reloading a queued task', async () => {
  renderResume([jobMock(task({})), subscription({})])

  expect(await screen.findByText('Writing your complete draft…')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Edit again' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Use this and continue' })).not.toBeInTheDocument()
})

it('opens the complete editable draft when its subscription finishes', async () => {
  const user = userEvent.setup()
  const result = { sections: [{ section_type: 'summary', title: 'Summary', content: { text: 'Backend engineer.' } }], warnings: [] }
  const completed = { ...subscription({ status: 'COMPLETED', result }), delay: 100 }
  renderResume([jobMock(task({})), completed])

  expect(await screen.findByText('Writing your complete draft…')).toBeInTheDocument()
  await user.click(await screen.findByRole('button', { name: 'Edit sections' }))
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
  renderResume([
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
  await user.click(await screen.findByRole('button', { name: 'Edit sections' }))
  await user.click(await screen.findByRole('button', { name: 'Summary' }))
  expect(screen.getByRole('textbox', { name: 'Summary' })).toHaveValue('Retried draft.')
  expect(screen.queryByText('Provider unavailable.')).not.toBeInTheDocument()
})

it('lets the user retry after starting the draft fails', async () => {
  const user = userEvent.setup()
  renderResume([
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
    sections: [
      { section_type: 'custom', title: 'Old custom section', content: {} },
      { section_type: 'summary', title: 'Summary', content: { text: 'Backend engineer.' } },
    ],
    warnings: ['Projects omitted: no relevant evidence.'],
  }
  renderResume([jobMock(task({ status: 'COMPLETED', result })), subscription({ status: 'COMPLETED', result })])

  expect(await screen.findByText('Projects omitted: no relevant evidence.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Edit sections' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Save resume' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Write it from my library anyway' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Edit again' })).not.toBeInTheDocument()
})

it('saves the finished draft and returns to the Resume tab', async () => {
  const user = userEvent.setup()
  const result = { sections: [{ section_type: 'summary', title: 'Summary', content: { text: 'Backend engineer.' }, omitted: false }], warnings: [] }
  const renderTailorSaved = renderResume([
    jobMock(task({ status: 'COMPLETED', result })),
    subscription({ status: 'COMPLETED', result }),
    {
      request: {
        query: SAVE_TAILORED_RESUME_MUTATION,
        variables: { aiTaskId: 'task-1', includeSummary: true, sections: [{ section_type: 'summary', title: 'Summary', content: { text: 'Backend engineer.' } }] },
      },
      result: { data: { saveTailoredResume: { __typename: 'SaveTailoredResumePayload', resume: { __typename: 'Resume', includeSummary: true, id: 'resume-1', title: 'Engineer at Acme' }, errors: [] } } },
    },
    jobMock(null, { __typename: 'Resume', includeSummary: true, id: 'resume-1', title: 'Engineer at Acme', sections: [] }),
  ])

  const { router } = renderTailorSaved
  await user.click(await screen.findByRole('button', { name: 'Save resume' }))
  expect(await screen.findByRole('button', { name: 'Download PDF' })).toBeInTheDocument()
  await waitFor(() => expect(router.state.location.pathname).toBe('/jobs/job-1/resume'))
})

it('edits a resume that was already saved and shows the preview', async () => {
  const user = userEvent.setup()
  renderResume([
    jobMock(task({ status: 'COMPLETED', acceptedAt: CREATED_AT }), {
      __typename: 'Resume', includeSummary: true,
      id: 'resume-1',
      title: 'Engineer at Acme',
      sections: [
        { __typename: 'ResumeSection', id: 'section-1', sectionType: 'SUMMARY', title: 'Summary', position: 0, content: { text: 'Backend engineer.' } },
      ],
    }),
    {
      request: {
        query: UPDATE_RESUME_MUTATION,
        variables: { id: 'resume-1', includeSummary: true, sections: [{ id: 'section-1', content: { text: 'Backend engineer and writer.' } }] },
      },
      result: {
        data: {
          updateResume: {
            __typename: 'UpdateResumePayload',
            resume: {
              __typename: 'Resume', includeSummary: true,
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
  ], { url: '/jobs/job-1/resume', resume: { id: 'resume-1' } })

  await user.click(await screen.findByRole('button', { name: 'Download PDF' }))
  expect(downloadResumePdf).toHaveBeenLastCalledWith(expect.any(Object), 'Engineer at Acme')
  await user.click(screen.getByRole('button', { name: 'Download DOCX' }))
  expect(downloadResumeDocx).toHaveBeenLastCalledWith(expect.any(Object), 'Engineer at Acme')
  await user.click(await screen.findByRole('button', { name: 'Edit sections' }))
  await user.click(await screen.findByRole('button', { name: 'Summary' }))
  let summary = screen.getByRole('textbox', { name: 'Summary' })
  expect(summary).toHaveValue('Backend engineer.')
  expect(screen.queryByTitle('Resume preview')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Preview' }))
  expect(await screen.findByTitle('Resume preview')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Edit sections' }))
  summary = screen.getByRole('textbox', { name: 'Summary' })
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
  renderResume([
    jobMock(task({ status: 'COMPLETED', result })),
    subscription({ status: 'COMPLETED', result }),
    {
      request: {
        query: SAVE_TAILORED_RESUME_MUTATION,
        variables: { aiTaskId: 'task-1', includeSummary: true, sections: [{ section_type: 'summary', title: 'Summary', content: { text: 'Edited summary.' } }] },
      },
      result: saveResult,
    },
  ])

  await user.click(await screen.findByRole('button', { name: 'Edit sections' }))
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
  renderResume([
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
  renderResume([jobMock(task({ status: 'COMPLETED', acceptedAt: CREATED_AT, result: oldResult })),
    { request: { query: START_RESUME_TAILORING_MUTATION, variables: { jobId: 'job-1' } }, result: start, delay: 200 }, nextSubscription,
    { ...oldSubscription, result: oldResultReceived }])
  await screen.findByRole('heading', { name: 'Engineer' })
  expect(screen.queryByRole('button', { name: 'Save resume' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Summary' })).not.toBeInTheDocument()
  expect(await screen.findByText('Writing your complete draft…')).toBeInTheDocument()
  expect(start).toHaveBeenCalledOnce()
  expect(oldResultReceived).not.toHaveBeenCalled()
})

it('regenerates an unsaved result in the retired draft format instead of showing an empty editor', async () => {
  const start = vi.fn(() => ({ data: { startResumeTailoring: { __typename: 'StartResumeTailoringPayload', aiTask: { __typename: 'AiTask', id: 'task-2', status: 'QUEUED' }, errors: [] } } }))
  const nextSubscription = subscription({ id: 'task-2' })
  nextSubscription.request.variables.id = 'task-2'
  renderResume([
    jobMock(task({ status: 'COMPLETED', result: { drafts: [], markdown: 'Old draft' } })),
    { request: { query: START_RESUME_TAILORING_MUTATION, variables: { jobId: 'job-1' } }, result: start },
    nextSubscription,
  ])

  expect(await screen.findByText('Writing your complete draft…')).toBeInTheDocument()
  expect(start).toHaveBeenCalledOnce()
  expect(screen.queryByText('Your draft is ready to review')).not.toBeInTheDocument()
  expect(screen.queryByText('Include at least one section to preview or save your resume.')).not.toBeInTheDocument()
})

it.each([
  ['unsupported', { section_type: 'custom', content: {} }],
  ['omitted', { section_type: 'summary', content: { text: 'Old draft' }, omitted: true }],
  ['malformed content', { section_type: 'summary', content: 'Malformed draft' }],
])('starts and follows a new task when the completed result has only %s sections', async (_shape, section) => {
  const start = vi.fn(() => ({ data: { startResumeTailoring: { __typename: 'StartResumeTailoringPayload', aiTask: { __typename: 'AiTask', id: 'task-2', status: 'QUEUED' }, errors: [] } } }))
  const nextResult = { sections: [{ section_type: 'summary', content: { text: 'New draft.' } }] }
  const nextSubscription = subscription({ id: 'task-2', status: 'COMPLETED', result: nextResult })
  nextSubscription.request.variables.id = 'task-2'
  renderResume([
    jobMock(task({ status: 'COMPLETED', result: { sections: [section] } })),
    { request: { query: START_RESUME_TAILORING_MUTATION, variables: { jobId: 'job-1' } }, result: start },
    nextSubscription,
  ])

  expect(await screen.findByRole('button', { name: 'Edit sections' })).toBeInTheDocument()
  await userEvent.setup().click(screen.getByRole('button', { name: 'Edit sections' }))
  expect(start).toHaveBeenCalledOnce()
  await userEvent.setup().click(screen.getByRole('button', { name: 'Summary' }))
  expect(screen.getByRole('textbox', { name: 'Summary' })).toHaveValue('New draft.')
})

it('allows retry when starting after accepted history fails', async () => {
  const user = userEvent.setup()
  renderResume([jobMock(task({ status: 'COMPLETED', acceptedAt: CREATED_AT })),
    { request: { query: START_RESUME_TAILORING_MUTATION, variables: { jobId: 'job-1' } }, result: { data: { startResumeTailoring: { __typename: 'StartResumeTailoringPayload', aiTask: null, errors: ['Queue unavailable.'] } } } },
    { request: { query: START_RESUME_TAILORING_MUTATION, variables: { jobId: 'job-1' } }, result: { data: { startResumeTailoring: { __typename: 'StartResumeTailoringPayload', aiTask: { __typename: 'AiTask', id: 'task-1', status: 'QUEUED' }, errors: [] } } } },
    subscription({}),
  ])
  expect(await screen.findByText('Queue unavailable.')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Try again' }))
  expect(await screen.findByText('Writing your complete draft…')).toBeInTheDocument()
})

it('deletes an edited resume and returns to the Resume tab without another discard warning or generation', async () => {
  const user = userEvent.setup()
  const start = vi.fn(() => ({ data: { startResumeTailoring: { __typename: 'StartResumeTailoringPayload', aiTask: null, errors: ['Unexpected generation'] } } }))
  const { router } = renderResume([jobMock(task({ status: 'COMPLETED', acceptedAt: null, result: { sections: [{ section_type: 'summary', title: 'Summary', content: { text: 'Old generated draft.' } }] } }), { __typename: 'Resume', includeSummary: true, id: 'resume-1', title: 'Saved resume', sections: [
      { __typename: 'ResumeSection', id: 'section-1', sectionType: 'SUMMARY', title: 'Summary', position: 0, content: { text: 'Original summary.' } },
    ] }),
      { request: { query: DELETE_RESUME_MUTATION, variables: { id: 'resume-1' } }, result: { data: { deleteResume: { __typename: 'DeleteResumePayload', resume: { __typename: 'Resume', includeSummary: true, id: 'resume-1' }, errors: [] } } } },
      startMock(start)], { url: '/jobs/job-1/resume', resume: { id: 'resume-1' } })
  await user.click(await screen.findByRole('button', { name: 'Edit sections' }))
  await user.click(await screen.findByRole('button', { name: 'Summary' }))
  await user.type(screen.getByRole('textbox', { name: 'Summary' }), ' Unsaved edit.')
  expect(screen.getByRole('status')).toHaveTextContent('Unsaved changes')
  await user.click(screen.getByRole('button', { name: 'Delete resume' }))
  await user.click(screen.getByRole('button', { name: 'Delete' }))
  expect(await screen.findByRole('heading', { name: 'No resume for this job yet' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Delete resume' })).not.toBeInTheDocument()
  expect(router.state.location.pathname).toBe('/jobs/job-1/resume')
  expect(start).not.toHaveBeenCalled()
})
