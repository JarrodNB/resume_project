/**
 * Description: The career library page lists imported records and empty states.
 */
import { screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { renderPage } from '@/test/renderPage'
import { CAREER_LIBRARY_QUERY } from './careerLibraryOperations'
import { CareerLibraryPage } from './CareerLibraryPage'

const libraryMock = {
  request: { query: CAREER_LIBRARY_QUERY },
  result: {
    data: {
      experiences: [
        {
          __typename: 'Experience',
          id: 'exp-1',
          company: 'Acme',
          title: 'Engineer',
          location: 'Perth',
          startDate: '2021-03-01',
          endDate: null,
          description: null,
          highlights: [{ __typename: 'ExperienceHighlight', id: 'hl-1', content: 'Built the billing service' }],
        },
      ],
      projects: [],
      educations: [],
      skills: [{ __typename: 'Skill', id: 'skill-1', name: 'Ruby', category: 'Languages' }],
      resumes: [
        {
          __typename: 'Resume',
          id: 'resume-1',
          title: 'Base resume',
          kind: 'BASE',
          updatedAt: '2026-10-01T00:00:00Z',
          sections: [{ __typename: 'ResumeSection', id: 'section-1' }],
        },
      ],
    },
  },
}

it('shows the imported library', async () => {
  renderPage({ path: '/library', url: '/library', element: <CareerLibraryPage />, mocks: [libraryMock] })

  expect(await screen.findByText('Engineer')).toBeInTheDocument()
  expect(screen.getByText('Acme · Perth')).toBeInTheDocument()
  expect(screen.getByText('Mar 2021 – Present')).toBeInTheDocument()
  expect(screen.getByText('Built the billing service')).toBeInTheDocument()
  expect(screen.getByText('Base resume')).toBeInTheDocument()
  expect(screen.getByText('Ruby')).toBeInTheDocument()
  expect(screen.getByText('No projects yet.')).toBeInTheDocument()
})
