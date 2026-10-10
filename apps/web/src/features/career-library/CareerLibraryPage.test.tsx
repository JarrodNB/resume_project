/**
 * Description: The career library page shows the profile, imported records, and empty states.
 */
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'
import { setSectionOpen } from '@/lib/openSections'
import { renderPage } from '@/test/renderPage'
import { CAREER_LIBRARY_QUERY } from './careerLibraryOperations'
import { CareerLibraryPage } from './CareerLibraryPage'

const libraryMock = {
  request: { query: CAREER_LIBRARY_QUERY },
  result: {
    data: {
      me: {
        __typename: 'User',
        id: 'user-1',
        name: 'Jane Doe',
        contactEmail: 'jane@example.com',
        phone: null,
        location: 'Perth',
        links: [{ __typename: 'ProfileLink', label: 'GitHub', url: 'https://github.com/jane' }],
        summary: 'Backend engineer.',
      },
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
          highlights: [{ __typename: 'ExperienceHighlight', id: 'hl-1', content: 'Built the billing service', position: 0 }],
        },
      ],
      projects: [],
      educations: [],
      skills: [{ __typename: 'Skill', id: 'skill-1', name: 'Ruby', category: 'Languages', position: 0 }],
      libraryFacts: [],
    },
  },
}

const LIBRARY_SECTION_IDS = ['library.profile', 'library.experience', 'library.projects', 'library.education', 'library.skills', 'library.facts']

/** Opens every library section so a test can read what is inside. */
function openLibrarySections() {
  for (const sectionId of LIBRARY_SECTION_IDS) setSectionOpen(sectionId, true)
}

it('keeps a section collapsed until it is opened', async () => {
  const user = userEvent.setup()
  const page = { path: '/library', url: '/library', element: <CareerLibraryPage />, mocks: [libraryMock] }
  const { unmount } = renderPage(page)

  const experience = await screen.findByRole('button', { name: /Experience/ })
  expect(experience).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByText('Engineer')).not.toBeInTheDocument()

  await user.click(experience)
  expect(screen.getByText('Engineer')).toBeInTheDocument()

  unmount()
  renderPage(page)
  expect(await screen.findByText('Engineer')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Experience/ })).toHaveAttribute('aria-expanded', 'true')
})

it('shows a fact added from a gap response', async () => {
  openLibrarySections()
  renderPage({
    path: '/library',
    url: '/library',
    element: <CareerLibraryPage />,
    mocks: [
      {
        ...libraryMock,
        result: {
          data: {
            ...libraryMock.result.data,
            libraryFacts: [
              {
                __typename: 'LibraryFact',
                id: 'fact-1',
                requirement: 'Experience with Kubernetes',
                response: 'I used Kubernetes at Acme for two years',
              },
            ],
          },
        },
      },
    ],
  })

  expect(await screen.findByText('Experience with Kubernetes')).toBeInTheDocument()
  expect(screen.getByText('I used Kubernetes at Acme for two years')).toBeInTheDocument()
})

it('shows the imported library', async () => {
  openLibrarySections()
  renderPage({ path: '/library', url: '/library', element: <CareerLibraryPage />, mocks: [libraryMock] })

  expect(await screen.findByText('Engineer')).toBeInTheDocument()
  expect(screen.getByText('Acme · Perth')).toBeInTheDocument()
  expect(screen.getByText('Mar 2021 – Present')).toBeInTheDocument()
  expect(screen.getByText('Built the billing service')).toBeInTheDocument()
  expect(screen.getByText('Jane Doe')).toBeInTheDocument()
  expect(screen.getByText('jane@example.com · Perth')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'GitHub' })).toBeInTheDocument()
  expect(screen.getByText('Backend engineer.')).toBeInTheDocument()
  expect(screen.getByText('Ruby')).toBeInTheDocument()
  expect(screen.getByText('No projects yet.')).toBeInTheDocument()
  expect(screen.getByText('No facts yet.')).toBeInTheDocument()
})
