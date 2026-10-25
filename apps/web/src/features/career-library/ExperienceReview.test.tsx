/** Optimistic highlight moves must not leave the previous role's green advice visible. */
import { MockedProvider } from '@apollo/client/testing/react'
import { DragDropProvider } from '@dnd-kit/react'
import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { setSectionOpen } from '@/lib/openSections'
import { LibraryWorkspace } from './LibraryWorkspace'
import { emptyLibraryReviewMocks, emptyReviewLibrary } from './libraryReviewTestFixtures'
import { ExperienceSection } from './ExperienceSection'
import { LIBRARY_REVIEW_QUERY } from './libraryReviewOperations'

it('keeps grades neutral while a highlight save and assessment refetch are pending', async () => {
  setSectionOpen('library.experience', true)
  const experiences = [{ __typename: 'Experience' as const, id: 'e1', title: 'Engineer', company: 'Acme', location: null,
    startDate: null, endDate: null, description: 'Builds services.', highlights: [] }]
  const mocks = [...emptyLibraryReviewMocks.filter((mock) => mock.request.variables.section !== 'experience'), {
    request: { query: LIBRARY_REVIEW_QUERY, variables: { section: 'experience' } },
    result: { data: { libraryReview: { __typename: 'LibraryReview', aiTask: null, assessments: [
      { __typename: 'LibraryAssessment', kind: 'experience', recordId: 'e1', field: 'description', color: 'green', reason: 'Clear scope.', question: 'Which services did you build?', stale: false },
    ] } } },
  }]
  const view = (pending: boolean) => <MockedProvider mocks={mocks}><LibraryWorkspace library={{ ...emptyReviewLibrary, experiences }} movingHighlight={pending}><DragDropProvider>
    <ExperienceSection experiences={experiences} highlightsOf={() => []} movingHighlight={pending} />
  </DragDropProvider></LibraryWorkspace></MockedProvider>
  const { rerender } = render(view(false))
  expect(await screen.findByText('Looks good')).toBeInTheDocument()
  expect(screen.getByText('Which services did you build?')).toBeInTheDocument()
  rerender(view(true))
  expect(screen.getByText('Needs review')).toBeInTheDocument()
  expect(screen.queryByText('Looks good')).not.toBeInTheDocument()
  expect(screen.queryByText('Which services did you build?')).not.toBeInTheDocument()
})
