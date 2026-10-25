/** Every supported narrative section reuses the same review indicator and individual editor. */
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'
import { setSectionOpen } from '@/lib/openSections'
import { renderPage } from '@/test/renderPage'
import { FactsSection } from './FactsSection'
import { ProfileSection } from './ProfileSection'
import { ProjectSection } from './ProjectSection'
import { LIBRARY_EDIT_QUERY } from './libraryEditOperations'
import { LIBRARY_REVIEW_QUERY } from './libraryReviewOperations'

const cases = [
  { section: 'summary', title: 'Summary', sectionId: 'library.profile', kind: 'user', field: 'summary', id: 'user-1',
    element: <ProfileSection profile={{ id: 'user-1', name: 'Jane', contactEmail: 'jane@example.com', phone: null, location: null, links: [], summary: 'I build useful tools.' }} /> },
  { section: 'projects', title: 'Projects', sectionId: 'library.projects', kind: 'project', field: 'description', id: 'project-1',
    element: <ProjectSection projects={[{ id: 'project-1', name: 'Stock sheet', role: 'Contributor', url: null, startDate: null, endDate: null, description: 'Built a shared inventory sheet.' }]} /> },
  { section: 'facts', title: 'Facts', sectionId: 'library.facts', kind: 'library_fact', field: 'response', id: 'fact-1',
    element: <FactsSection facts={[{ id: 'fact-1', requirement: 'Inventory experience', response: 'Maintained the count sheet.' }]} /> },
]

for (const item of cases) {
  it(`reviews ${item.title} separately and opens the selected narrative target`, async () => {
    setSectionOpen(item.sectionId, true)
    const user = userEvent.setup()
    renderPage({ path: '/', url: '/', element: item.element, mocks: [
      { request: { query: LIBRARY_REVIEW_QUERY, variables: { section: item.section } },
        result: { data: { libraryReview: { __typename: 'LibraryReview', aiTask: null, assessments: [
          { __typename: 'LibraryAssessment', kind: item.kind, recordId: item.id, field: item.field, color: 'yellow', reason: 'Clarify your contribution.', stale: false },
        ] } } } },
      { request: { query: LIBRARY_EDIT_QUERY, variables: { kind: item.kind, recordId: item.id } },
        result: { data: { libraryEdit: { __typename: 'LibraryEdit', stale: false, aiTask: null } } } },
    ] })
    expect(screen.getByRole('button', { name: `Review ${item.title}` })).toBeEnabled()
    expect(await screen.findByText('Could improve')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Improve with AI' }))
    expect(await screen.findByLabelText('What would you like to improve? (optional)')).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Generate revision' })).toBeEnabled()
  })
}
