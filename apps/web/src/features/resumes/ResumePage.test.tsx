/**
 * Description: A resume linked to a job opens in that job's Resume tab; a resume whose job was
 * removed is edited, downloaded, and deleted on its own page. The PDF preview is mocked.
 */
import { downloadResumePdf, downloadResumeDocx } from '@/features/resume-tailoring/resumeDownload'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { InMemoryCache } from '@apollo/client'
import { MockedProvider } from '@apollo/client/testing/react'
import { expect, it, vi } from 'vitest'
import { renderPage } from '@/test/renderPage'
import { ResumePage } from './ResumePage'
import { DELETE_RESUME_MUTATION, RESUME_QUERY, RESUMES_QUERY } from './resumesOperations'

vi.mock('@/features/resume-tailoring/resumeDownload', () => ({ downloadResumePdf: vi.fn().mockResolvedValue(undefined), downloadResumeDocx: vi.fn().mockResolvedValue(undefined) }))

vi.mock('@/features/resume-tailoring/ResumePdfPreview', () => ({
  ResumePdfPreview: () => <iframe title="Resume preview" />,
}))

function resumeQuery(job: Record<string, unknown> | null) {
  return {
    request: { query: RESUME_QUERY, variables: { id: 'resume-1' } },
    result: {
      data: {
        resume: {
          __typename: 'Resume', includeSummary: true,
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

it("sends a resume that belongs to a job to that job's Resume tab", async () => {
  const { router } = renderPage({
    path: '/resumes/:id',
    url: '/resumes/resume-1',
    element: <ResumePage />,
    extraRoutes: [{ path: '/jobs/:id/resume', element: <p>Job resume tab</p> }],
    mocks: [resumeQuery({ __typename: 'Job', id: 'job-1', title: 'Engineer', company: 'Acme' })],
  })

  expect(await screen.findByText('Job resume tab')).toBeInTheDocument()
  expect(router.state.location.pathname).toBe('/jobs/job-1/resume')
})

it('links an orphaned resume back to the resume list', async () => {
  renderPage({ path: '/resumes/:id', url: '/resumes/resume-1', element: <ResumePage />, mocks: [resumeQuery(null)] })

  expect(await screen.findByRole('heading', { name: 'Engineer at Acme' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Back to resumes' })).toHaveAttribute('href', '/resumes')
})

it('still opens a resume whose job was removed', async () => {
  renderPage({
    path: '/resumes/:id',
    url: '/resumes/resume-1',
    element: <ResumePage />,
    mocks: [resumeQuery(null)],
  })

  expect(await screen.findByText('The job for this resume was removed.')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Download PDF' }))
  expect(downloadResumePdf).toHaveBeenLastCalledWith(expect.objectContaining({ blocks: [expect.objectContaining({ text: 'Backend engineer.' })] }), 'Engineer at Acme')
  await userEvent.click(screen.getByRole('button', { name: 'Download DOCX' }))
  expect(downloadResumeDocx).toHaveBeenLastCalledWith(expect.objectContaining({ blocks: [expect.objectContaining({ text: 'Backend engineer.' })] }), 'Engineer at Acme')
  await userEvent.click(screen.getByRole('button', { name: 'Edit sections' }))
  await userEvent.click(screen.getByRole('button', { name: 'Summary' }))
  expect(screen.getByRole('textbox', { name: 'Summary' })).toHaveValue('Backend engineer.')
})

it('starts saved sections collapsed, retains unsaved edits, and remembers open sections', async () => {
  const user = userEvent.setup()
  function openResume() {
    return renderPage({ path: '/resumes/:id', url: '/resumes/resume-1', element: <ResumePage />, mocks: [resumeQuery(null)] })
  }
  const view = openResume()
  await user.click(await screen.findByRole('button', { name: 'Edit sections' }))
  const toggle = await screen.findByRole('button', { name: 'Summary' })
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByRole('textbox', { name: 'Summary' })).not.toBeInTheDocument()
  await user.click(toggle)
  await user.clear(screen.getByRole('textbox', { name: 'Summary' }))
  await user.type(screen.getByRole('textbox', { name: 'Summary' }), 'My unsaved summary.')
  await user.click(toggle)
  await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Summary' })).not.toBeInTheDocument())
  await user.click(toggle)
  expect(screen.getByRole('textbox', { name: 'Summary' })).toHaveValue('My unsaved summary.')
  view.unmount()
  openResume()
  await user.click(await screen.findByRole('button', { name: 'Edit sections' }))
  expect(await screen.findByRole('textbox', { name: 'Summary' })).toHaveValue('Backend engineer.')
  expect(screen.getByRole('button', { name: 'Summary' })).toHaveAttribute('aria-expanded', 'true')
})

it('cancels deletion without a request, then deletes an orphan resume and returns to the list', async () => {
  const user = userEvent.setup()
  const deleted = vi.fn(() => ({ data: { deleteResume: { __typename: 'DeleteResumePayload', resume: { __typename: 'Resume', includeSummary: true, id: 'resume-1' }, errors: [] } } }))
  const { router } = renderPage({ path: '/resumes/:id', url: '/resumes/resume-1', element: <ResumePage />,
    extraRoutes: [{ path: '/resumes', element: <p>Resume list</p> }],
    mocks: [resumeQuery(null), { request: { query: DELETE_RESUME_MUTATION, variables: { id: 'resume-1' } }, result: deleted }],
  })
  await user.click(await screen.findByRole('button', { name: 'Delete resume' }))
  expect(screen.getByText(/career library remain/)).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(deleted).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Delete resume' }))
  await user.click(screen.getByRole('button', { name: 'Delete' }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/resumes'))
  expect(deleted).toHaveBeenCalledOnce()
})

it('keeps edits after network and payload failures, prevents duplicate requests, and retries to the list', async () => {
  const user = userEvent.setup()
  const deleted = vi.fn(() => ({ data: { deleteResume: { __typename: 'DeleteResumePayload', resume: { __typename: 'Resume', includeSummary: true, id: 'resume-1' }, errors: [] } } }))
  const request = { query: DELETE_RESUME_MUTATION, variables: { id: 'resume-1' } }
  const { router } = renderPage({ path: '/resumes/:id', url: '/resumes/resume-1', element: <ResumePage />,
    extraRoutes: [{ path: '/resumes', element: <p>Resume list</p> }],
    mocks: [resumeQuery(null),
      { request, error: new Error('Offline') },
      { request, result: { data: { deleteResume: { __typename: 'DeleteResumePayload', resume: null, errors: ['Try later.'] } } } },
      { request, result: deleted, delay: 200 }],
  })
  await user.click(await screen.findByRole('button', { name: 'Edit sections' }))
  await user.click(await screen.findByRole('button', { name: 'Summary' }))
  await user.type(screen.getByRole('textbox', { name: 'Summary' }), ' Edited.')
  await user.click(screen.getByRole('button', { name: 'Delete resume' }))
  await user.click(screen.getByRole('button', { name: 'Delete' }))
  expect(await screen.findByText(/Check your connection/)).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Delete' }))
  expect(await screen.findByText('Try later.')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(screen.getByRole('textbox', { name: 'Summary' })).toHaveValue('Backend engineer. Edited.')
  await user.click(screen.getByRole('button', { name: 'Delete resume' }))
  await user.click(screen.getByRole('button', { name: 'Delete' }))
  const deleting = screen.getByRole('button', { name: 'Deleting…' })
  expect(deleting).toBeDisabled()
  await user.click(deleting)
  await waitFor(() => expect(router.state.location.pathname).toBe('/resumes'))
  expect(deleted).toHaveBeenCalledOnce()
})

it('clears cached resume detail and list entries while preserving other resumes', async () => {
  const user = userEvent.setup()
  const cache = new InMemoryCache()
  // Only orphaned resumes are edited here; the job workspace's resume tests cover clearing a job's link.
  const resume = { ...resumeQuery(null).result.data.resume, __typename: 'Resume' as const, includeSummary: true, job: null,
    sections: [{ __typename: 'ResumeSection' as const, id: 'section-1', sectionType: 'SUMMARY' as const, title: 'Summary', position: 0, content: { text: 'Backend engineer.' } }] }
  const list = [
    { __typename: 'Resume', includeSummary: true, id: 'resume-1', title: resume.title, updatedAt: '2026-10-18', job: null },
    { __typename: 'Resume', includeSummary: true, id: 'other', title: 'Another resume', updatedAt: '2026-10-18', job: null },
  ]
  cache.writeQuery({ query: RESUMES_QUERY, data: { resumes: list } })
  cache.writeQuery({ query: RESUME_QUERY, variables: { id: 'resume-1' }, data: { resume } })
  const { router } = renderPage({ path: '/resumes/:id', url: '/resumes/resume-1',
    element: <MockedProvider cache={cache} mocks={[{ request: { query: DELETE_RESUME_MUTATION, variables: { id: 'resume-1' } }, result: { data: { deleteResume: { __typename: 'DeleteResumePayload', resume: { __typename: 'Resume', includeSummary: true, id: 'resume-1' }, errors: [] } } } }]}><ResumePage /></MockedProvider>,
    extraRoutes: [{ path: '/resumes', element: <p>Resume list</p> }],
  })
  await user.click(await screen.findByRole('button', { name: 'Delete resume' }))
  await user.click(screen.getByRole('button', { name: 'Delete' }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/resumes'))
  expect(cache.readQuery({ query: RESUME_QUERY, variables: { id: 'resume-1' } })?.resume).toBeNull()
  expect(cache.readQuery({ query: RESUMES_QUERY })?.resumes.map((entry) => entry.id)).toEqual(['other'])
})


it('blocks PDF downloading while a saved resume deletion is pending', async () => {
  const user = userEvent.setup()
  renderPage({ path: '/resumes/:id', url: '/resumes/resume-1', element: <ResumePage />,
    extraRoutes: [{ path: '/resumes', element: <p>Resume list</p> }],
    mocks: [resumeQuery(null), { request: { query: DELETE_RESUME_MUTATION, variables: { id: 'resume-1' } }, delay: 200,
      result: { data: { deleteResume: { __typename: 'DeleteResumePayload', resume: { __typename: 'Resume', includeSummary: true, id: 'resume-1' }, errors: [] } } } }],
  })
  const download = await screen.findByRole('button', { name: 'Download PDF' })
  const docxDownload = screen.getByRole('button', { name: 'Download DOCX' })
  expect(download).toBeEnabled()
  await user.click(screen.getByRole('button', { name: 'Delete resume' }))
  await user.click(screen.getByRole('button', { name: 'Delete' }))
  expect(download).toBeDisabled()
  expect(docxDownload).toBeDisabled()
  expect(await screen.findByText('Resume list')).toBeInTheDocument()
})
