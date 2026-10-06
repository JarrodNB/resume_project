/**
 * Description: The resumes page lists saved resumes and shows an empty state.
 */
import { screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { renderPage } from '@/test/renderPage'
import { ResumesPage } from './ResumesPage'
import { RESUMES_QUERY } from './resumesOperations'

function resumesMock(resumes: Record<string, unknown>[]) {
  return { request: { query: RESUMES_QUERY }, result: { data: { resumes } } }
}

it('lists saved resumes and links to each one', async () => {
  renderPage({
    path: '/resumes',
    url: '/resumes',
    element: <ResumesPage />,
    mocks: [
      resumesMock([
        {
          __typename: 'Resume',
          id: 'resume-1',
          title: 'Tailored resume',
          updatedAt: '2026-10-05T00:00:00Z',
          job: { __typename: 'Job', id: 'job-1', title: 'Engineer', company: 'Acme' },
        },
        {
          __typename: 'Resume',
          id: 'resume-2',
          title: 'Old resume',
          updatedAt: '2026-09-01T00:00:00Z',
          job: null,
        },
      ]),
    ],
  })

  expect(await screen.findByText('Tailored resume')).toBeInTheDocument()
  expect(screen.getByText('Engineer at Acme')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /Tailored resume/ })).toHaveAttribute('href', '/resumes/resume-1')
  expect(screen.getByText('The job for this resume was removed.')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /Old resume/ })).toHaveAttribute('href', '/resumes/resume-2')
})

it('points to jobs when there are no resumes', async () => {
  renderPage({ path: '/resumes', url: '/resumes', element: <ResumesPage />, mocks: [resumesMock([])] })

  expect(await screen.findByText(/No resumes yet/)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Go to jobs' })).toHaveAttribute('href', '/jobs')
})
