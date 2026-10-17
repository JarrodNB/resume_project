/**
 * Description: One saved resume opens for editing and links back to its job.
 * The PDF preview is mocked.
 */
import { screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { renderPage } from '@/test/renderPage'
import { emptyAtsReportMocks } from '@/test/atsReportMocks'
import { ResumePage } from './ResumePage'
import { RESUME_QUERY } from './resumesOperations'

vi.mock('@/features/resume-tailoring/ResumePdfPreview', () => ({
  ResumePdfPreview: () => <iframe title="Resume preview" />,
}))

function resumeQuery(job: Record<string, unknown> | null) {
  return {
    request: { query: RESUME_QUERY, variables: { id: 'resume-1' } },
    result: {
      data: {
        resume: {
          __typename: 'Resume',
          id: 'resume-1',
          title: 'Engineer at Acme',
          job,
          sections: [
            {
              __typename: 'ResumeSection',
              id: 'section-1',
              sectionType: 'SUMMARY',
              title: 'Summary',
              position: 0,
              content: { text: 'Backend engineer.' },
            },
          ],
        },
      },
    },
  }
}

it('opens the resume and links to its job', async () => {
  renderPage({
    path: '/resumes/:id',
    url: '/resumes/resume-1',
    element: <ResumePage />,
    mocks: [resumeQuery({ __typename: 'Job', id: 'job-1', title: 'Engineer', company: 'Acme' }), ...emptyAtsReportMocks('resume-1')],
  })

  expect(await screen.findByRole('heading', { name: 'Engineer at Acme' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Back to resumes' })).toHaveAttribute('href', '/resumes')
  expect(screen.getByRole('link', { name: 'Engineer at Acme' })).toHaveAttribute('href', '/jobs/job-1')
  expect(screen.getByRole('textbox', { name: 'Summary' })).toHaveValue('Backend engineer.')
})

it('points the breadcrumb at the job when opened from that job', async () => {
  renderPage({
    path: '/resumes/:id',
    url: '/resumes/resume-1',
    element: <ResumePage />,
    historyState: { fromJobId: 'job-1' },
    mocks: [resumeQuery({ __typename: 'Job', id: 'job-1', title: 'Engineer', company: 'Acme' }), ...emptyAtsReportMocks('resume-1')],
  })

  expect(await screen.findByRole('link', { name: 'Back to job' })).toHaveAttribute('href', '/jobs/job-1')
  expect(screen.getByRole('link', { name: 'Engineer at Acme' })).toHaveAttribute('href', '/jobs/job-1')
  expect(screen.queryByRole('link', { name: 'Back to resumes' })).not.toBeInTheDocument()
})

it('still opens a resume whose job was removed', async () => {
  renderPage({
    path: '/resumes/:id',
    url: '/resumes/resume-1',
    element: <ResumePage />,
    mocks: [resumeQuery(null), ...emptyAtsReportMocks('resume-1')],
  })

  expect(await screen.findByText('The job for this resume was removed.')).toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: 'Summary' })).toHaveValue('Backend engineer.')
})
