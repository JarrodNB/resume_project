/** Every supported narrative section reuses the same review indicator and individual editor. */
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'
import { setSectionOpen } from '@/lib/openSections'
import { renderPage } from '@/test/renderPage'
import { LibraryWorkspace } from './LibraryWorkspace'
import { LibraryAiWorkspace } from './LibraryAiWorkspace'
import { emptyLibraryReviewMocks, emptyReviewLibrary } from './libraryReviewTestFixtures'
import { FactsSection } from './FactsSection'
import { ProfileSection } from './ProfileSection'
import { ProjectSection } from './ProjectSection'
import { LIBRARY_EDIT_QUERY } from './libraryEditOperations'
import { LIBRARY_REVIEW_QUERY } from './libraryReviewOperations'

const cases = [
  { section: 'summary', title: 'Summary', sectionId: 'library.profile', kind: 'user', field: 'summary', id: 'user-1',
    library: { ...emptyReviewLibrary, me: { ...emptyReviewLibrary.me, name: 'Jane', summary: 'I build useful tools.' } },
    element: <ProfileSection profile={{ id: 'user-1', name: 'Jane', contactEmail: 'jane@example.com', phone: null, location: null, links: [], summary: 'I build useful tools.' }} /> },
  { section: 'projects', title: 'Projects', sectionId: 'library.projects', kind: 'project', field: 'description', id: 'project-1',
    library: { ...emptyReviewLibrary, projects: [{ id: 'project-1', name: 'Stock sheet', role: 'Contributor', url: null, startDate: null, endDate: null, description: 'Built a shared inventory sheet.' }] },
    element: <ProjectSection projects={[{ id: 'project-1', name: 'Stock sheet', role: 'Contributor', url: null, startDate: null, endDate: null, description: 'Built a shared inventory sheet.' }]} /> },
  { section: 'facts', title: 'Facts', sectionId: 'library.facts', kind: 'library_fact', field: 'response', id: 'fact-1',
    library: { ...emptyReviewLibrary, libraryFacts: [{ id: 'fact-1', requirement: 'Inventory experience', response: 'Maintained the count sheet.' }] },
    element: <FactsSection facts={[{ id: 'fact-1', requirement: 'Inventory experience', response: 'Maintained the count sheet.' }]} /> },
]

for (const item of cases) {
  it(`reviews ${item.title} separately and opens the selected narrative target`, async () => {
    setSectionOpen(item.sectionId, true)
    const user = userEvent.setup()
    renderPage({ path: '/', url: '/', element: <LibraryWorkspace library={item.library}>{item.element}<LibraryAiWorkspace /></LibraryWorkspace>, mocks: [
      ...emptyLibraryReviewMocks.filter((mock) => mock.request.variables.section !== item.section),
      { request: { query: LIBRARY_REVIEW_QUERY, variables: { section: item.section } },
        result: { data: { libraryReview: { __typename: 'LibraryReview', aiTask: null, assessments: [
          { __typename: 'LibraryAssessment', kind: item.kind, recordId: item.id, field: item.field, color: 'yellow', reason: 'Clarify your contribution.', stale: false },
        ] } } } },
      { request: { query: LIBRARY_EDIT_QUERY, variables: { kind: item.kind, recordId: item.id } },
        result: { data: { libraryEdit: { __typename: 'LibraryEdit', stale: false, aiTask: null } } } },
    ] })
    expect(screen.getByRole('button', { name: `Review ${item.title}` })).toBeEnabled()
    expect((await screen.findAllByText('Could improve')).length).toBeGreaterThan(0)
    await user.click(screen.getByRole('button', { name: 'Improve with AI' }))
    expect(await screen.findByLabelText('What would you like to improve? (optional)')).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Generate revision' })).toBeEnabled()
  })
}
