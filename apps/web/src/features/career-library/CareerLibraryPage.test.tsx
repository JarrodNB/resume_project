/**
 * Description: The career library page shows the profile, imported records, and empty states.
 */
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'
import { DEFAULT_SECTION_ORDER_QUERY } from '@/features/resume-tailoring/useDefaultSectionOrder'
import { renderPage } from '@/test/renderPage'
import { PARSE_RESUME_MUTATION } from '@/features/resume-import/resumeImportOperations'
import { CAREER_LIBRARY_QUERY } from './careerLibraryOperations'
import { emptyLibraryReviewMocks } from './libraryReviewTestFixtures'
import { LIBRARY_REVIEW_QUERY } from './libraryReviewOperations'
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
      certifications: [],
      educations: [],
      skills: [{ __typename: 'Skill', id: 'skill-1', name: 'Ruby', category: 'Languages', position: 0 }],
      careerContexts: [],
    },
  },
}

it('shows every section\'s records on arrival, with tabs that jump to each section', async () => {
  renderPage({ path: '/library', url: '/library', element: <CareerLibraryPage />, mocks: [...emptyLibraryReviewMocks, libraryMock] })

  expect(await screen.findByText('Built the billing service')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /^Experience/ })).not.toBeInTheDocument()
  const tabs = within(screen.getByRole('navigation', { name: 'Library sections' }))
  expect(tabs.getByRole('link', { name: /^Experience/ })).toHaveAttribute('href', '#library-experience')
  expect(document.getElementById('library-experience')).toContainElement(screen.getByText('Built the billing service'))
  expect(tabs.queryByText(/questions? for you/)).not.toBeInTheDocument()
})

it('counts waiting review questions and links to the first one', async () => {
  const experienceReview = {
    request: { query: LIBRARY_REVIEW_QUERY, variables: { section: 'experience' } },
    result: { data: { libraryReview: { __typename: 'LibraryReview', aiTask: null, assessments: [
      { __typename: 'LibraryAssessment', kind: 'experience_highlight', recordId: 'hl-1', field: 'content', color: 'red', reason: 'Add the result.', question: 'What changed?', questions: ['What changed?'], reviewTaskId: 'review-1', stale: false },
    ] } } },
  }
  renderPage({ path: '/library', url: '/library', element: <CareerLibraryPage />, mocks: [...emptyLibraryReviewMocks.filter((mock) => mock.request.variables.section !== 'experience'), experienceReview, libraryMock] })

  const tabs = within(await screen.findByRole('navigation', { name: 'Library sections' }))
  expect(await tabs.findByRole('link', { name: '1 question for you' })).toHaveAttribute('href', '#library-detail-experience_highlight:hl-1')
  expect(screen.getByText('Add the result.')).toBeInTheDocument()
})

it('shows a context added from a gap response', async () => {
  renderPage({
    path: '/library',
    url: '/library',
    element: <CareerLibraryPage />,
    mocks: [
      ...emptyLibraryReviewMocks,
      {
        ...libraryMock,
        result: {
          data: {
            ...libraryMock.result.data,
            careerContexts: [
              {
                __typename: 'CareerContext',
                id: 'context-1',
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
  renderPage({ path: '/library', url: '/library', element: <CareerLibraryPage />, mocks: [...emptyLibraryReviewMocks, libraryMock] })

  expect(await screen.findByText('Engineer')).toBeInTheDocument()
  expect(screen.queryByLabelText('Resume file')).not.toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Start with your resume' })).not.toBeInTheDocument()
  expect(screen.getByText('Acme · Perth')).toBeInTheDocument()
  expect(screen.getByText('Mar 2021 – Present')).toBeInTheDocument()
  expect(screen.getByText('Built the billing service')).toBeInTheDocument()
  expect(screen.getByText('Jane Doe')).toBeInTheDocument()
  expect(screen.getByText('jane@example.com · Perth')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'GitHub' })).toBeInTheDocument()
  expect(screen.getByText('Backend engineer.')).toBeInTheDocument()
  expect(screen.getByText('Ruby')).toBeInTheDocument()
  expect(screen.getByText('No projects yet.')).toBeInTheDocument()
  expect(screen.getByText('No career context yet.')).toBeInTheDocument()
})

it('shows certifications in their own section with credential metadata', async () => {
  renderPage({ path: '/library', url: '/library', element: <CareerLibraryPage />, mocks: [...emptyLibraryReviewMocks, {
    ...libraryMock,
    result: { data: { ...libraryMock.result.data, certifications: [{ __typename: 'Certification', id: 'cert-1', name: 'Cloud Architect', issuer: 'Cloud Co', issuedDate: '2024-01-01', issuedDatePrecision: 'day', expiryDate: null, expiryDatePrecision: null, credentialId: 'ABC', credentialUrl: 'https://example.com/ABC', description: null }] } },
  }] })
  expect(await screen.findByText('Cloud Architect')).toBeInTheDocument()
  expect(screen.getByText('Cloud Co, ABC, https://example.com/ABC')).toBeInTheDocument()
  expect(screen.getByText('Issued Jan 1, 2024')).toBeInTheDocument()
})


it('uploads directly from the empty library and opens the review task before saving', async () => {
  const user = userEvent.setup()
  const file = new File(['resume'], 'resume.pdf', { type: 'application/pdf' })
  renderPage({
    path: '/library', url: '/library', element: <CareerLibraryPage />,
    extraRoutes: [{ path: '/library/import/:aiTaskId', element: <p>Parse and review</p> }],
    mocks: [
      ...emptyLibraryReviewMocks,
      { ...libraryMock, result: { data: { ...libraryMock.result.data, experiences: [], skills: [] } } },
      { request: { query: PARSE_RESUME_MUTATION, variables: { file } }, result: { data: {
        parseResume: { __typename: 'ParseResumePayload', aiTask: { __typename: 'AiTask', id: 'task-1', status: 'queued' }, errors: [] },
      } } },
    ],
  })
  expect(await screen.findByRole('heading', { name: 'Start with your resume' })).toBeInTheDocument()
  await user.upload(screen.getByLabelText('Resume file'), file)
  expect(await screen.findByText('Parse and review')).toBeInTheDocument()
})

it('lists sections in the saved order, with the profile first and career context last', async () => {
  const defaultOrder = {
    request: { query: DEFAULT_SECTION_ORDER_QUERY },
    result: { data: { me: { __typename: 'User' as const, id: 'user-1', resumeSectionOrder: ['SKILLS', 'EDUCATION', 'SUMMARY', 'EXPERIENCE', 'PROJECTS', 'CERTIFICATIONS'] } } },
  }
  renderPage({ path: '/library', url: '/library', element: <CareerLibraryPage />, mocks: [...emptyLibraryReviewMocks, libraryMock, defaultOrder] })

  await screen.findByRole('button', { name: 'Drag Skills section' })
  const titles = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)
  expect(titles).toEqual(['Jane Doe', 'Skills', 'Education', 'Summary', 'Experience', 'Projects', 'Certifications', 'Career context'])
  const tabs = within(screen.getByRole('navigation', { name: 'Library sections' })).getAllByRole('link').map((link) => link.textContent?.replace(/\d+$/, ''))
  expect(tabs).toEqual(['Skills', 'Education', 'Summary', 'Experience', 'Projects', 'Certifications', 'Career context'])
  expect(screen.queryByRole('button', { name: 'Drag Profile section' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Drag Skills section' })).toBeInTheDocument()
})
