/** Exercises selection, saved draft recovery, deletion, and the mobile workspace boundary. */
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MockedProvider } from '@apollo/client/testing/react'
import { DragDropProvider } from '@dnd-kit/react'
import { afterEach, expect, it, vi } from 'vitest'
import { setSectionOpen } from '@/lib/openSections'
import { AI_TASK_UPDATED_SUBSCRIPTION } from '@/features/ai-tasks/aiTaskOperations'
import { LibraryWorkspace } from './LibraryWorkspace'
import { LibraryAiWorkspace } from './LibraryAiWorkspace'
import { ExperienceSection } from './ExperienceSection'
import { emptyLibraryReviewMocks, emptyReviewLibrary } from './libraryReviewTestFixtures'
import { LIBRARY_REVIEW_QUERY, REVIEW_LIBRARY_SECTION_MUTATION } from './libraryReviewOperations'
import { LIBRARY_EDIT_QUERY } from './libraryEditOperations'

const experience = { id: 'e1', title: 'Engineer', company: 'Acme', location: null, startDate: null, endDate: null, description: null,
  highlights: [{ id: 'h1', content: 'Built the billing service.', position: 0 }] }
const library = { ...emptyReviewLibrary, experiences: [experience] }
const task = { __typename: 'AiTask', id: 'edit-1', status: 'COMPLETED', result: { text: 'Built and deployed the billing API.', color: 'green', reason: 'Clear contribution.' }, input: {}, pendingQuestions: [], errorMessage: null, acceptedAt: null }
const mocks = [...emptyLibraryReviewMocks,
  { request: { query: REVIEW_LIBRARY_SECTION_MUTATION, variables: { section: 'experience' } }, result: { data: { reviewLibrarySection: { __typename: 'ReviewLibrarySectionPayload', aiTask: null, errors: ['Review limit reached.'] } } } },
  { request: { query: LIBRARY_EDIT_QUERY, variables: { kind: 'experience_highlight', recordId: 'h1' } }, result: { data: { libraryEdit: { __typename: 'LibraryEdit', stale: false, aiTask: task } } }, maxUsageCount: Infinity },
  { request: { query: AI_TASK_UPDATED_SUBSCRIPTION, variables: { id: task.id } }, result: { data: { aiTaskUpdated: { ...task, taskType: 'IMPROVE_LIBRARY_ENTRY', createdAt: '2026-10-25T00:00:00Z', job: null } } }, maxUsageCount: Infinity },
]
function Workspace({ removed = false }: { removed?: boolean }) {
  const current = removed ? { ...library, experiences: [] } : library
  return <MockedProvider mocks={mocks}><LibraryWorkspace library={current}>
    <DragDropProvider><ExperienceSection experiences={current.experiences} highlightsOf={() => experience.highlights} /></DragDropProvider>
    <LibraryAiWorkspace />
  </LibraryWorkspace></MockedProvider>
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('keeps AI editing separate from the source and restores the saved draft after closing', async () => {
  const user = userEvent.setup()
  render(<Workspace />)
  expect(screen.queryByText('Built the billing service.')).not.toBeInTheDocument()
  expect(screen.queryByRole('combobox', { name: 'Section to review' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: /^Experience 1/ }))
  const source = document.getElementById('library-detail-experience_highlight:h1')!
  const scrollIntoView = vi.fn()
  source.scrollIntoView = scrollIntoView
  const focus = vi.spyOn(HTMLElement.prototype, 'focus')
  await user.click(screen.getByRole('button', { name: 'Improve with AI' }))
  expect(await screen.findByText('Built and deployed the billing API.')).toBeInTheDocument()
  expect(screen.getByText('Built the billing service.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /^Experience 1/ })).toHaveAttribute('aria-expanded', 'true')
  expect(document.getElementById('library-detail-experience_highlight:h1')).toHaveAttribute('data-selected', 'true')
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Improve with AI' })).toHaveFocus())
  expect(scrollIntoView).not.toHaveBeenCalled()
  expect(focus).toHaveBeenLastCalledWith({ preventScroll: true })
  expect(within(screen.getByRole('article')).queryByRole('region', { name: 'Improve this career detail' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Close AI workspace' }))
  const trigger = screen.getByRole('button', { name: 'Improve with AI' })
  await waitFor(() => expect(trigger).toHaveFocus())
  expect(focus).toHaveBeenLastCalledWith({ preventScroll: true })
  await user.click(trigger)
  expect(await screen.findByText('Built and deployed the billing API.')).toBeInTheDocument()
})

it('removes acceptance when the selected detail is deleted', async () => {
  const { rerender } = render(<Workspace />)
  await userEvent.click(screen.getByRole('button', { name: /^Experience 1/ }))
  await userEvent.click(screen.getByRole('button', { name: 'Improve with AI' }))
  expect(await screen.findByRole('button', { name: 'Accept revision' })).toBeEnabled()
  rerender(<Workspace removed />)
  expect(screen.getByText('This detail is no longer in your library.')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Accept revision' })).not.toBeInTheDocument()
})

it('opens AI work in a mobile dialog and returns focus to the source on close', async () => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener() {}, removeEventListener() {} })))
  setSectionOpen('library.experience', true)
  render(<Workspace />)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  const trigger = screen.getByRole('button', { name: 'Improve with AI' })
  await userEvent.click(trigger)
  const dialog = await screen.findByRole('dialog', { name: 'Career library AI workspace' })
  expect(await within(dialog).findByText('Built and deployed the billing API.')).toBeInTheDocument()
  await userEvent.click(within(dialog).getByText('View saved text'))
  expect(within(dialog).getByText('Built the billing service.')).toBeVisible()
  await userEvent.click(within(dialog).getByRole('button', { name: 'Close AI workspace' }))
  await waitFor(() => expect(trigger).toHaveFocus())
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it('runs section review directly without opening an overview or duplicating library records', async () => {
  render(<Workspace />)
  const panel = screen.getByRole('complementary', { name: 'AI workspace' })
  expect(within(panel).queryByRole('list')).not.toBeInTheDocument()
  expect(within(panel).queryByRole('combobox')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: /^Experience 1/ }))
  await userEvent.click(screen.getByRole('button', { name: 'Review Experience' }))
  expect(await screen.findByText('Review limit reached.')).toBeInTheDocument()
  expect(within(panel).queryByText('Built the billing service.')).not.toBeInTheDocument()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it('opens review answering in the same selected-detail workspace while keeping Improve with AI', async () => {
  setSectionOpen('library.experience', true)
  const reviewMocks = [...emptyLibraryReviewMocks.filter((mock) => mock.request.variables.section !== 'experience'),
    { request: { query: LIBRARY_REVIEW_QUERY, variables: { section: 'experience' } }, result: { data: { libraryReview: {
      __typename: 'LibraryReview', aiTask: { __typename: 'AiTask', id: 'review-newer-failed', status: 'FAILED', errorMessage: null }, assessments: [
        { __typename: 'LibraryAssessment', kind: 'experience_highlight', recordId: 'h1', field: 'content', color: 'yellow', reason: 'Add your contribution.', question: 'Which part did you build?', questions: ['Which part did you build?', 'How did you check it?', 'What changed afterward?'], reviewTaskId: 'review-completed', stale: false },
      ],
    } } } },
    { request: { query: LIBRARY_EDIT_QUERY, variables: { kind: 'experience_highlight', recordId: 'h1' } }, result: { data: { libraryEdit: { __typename: 'LibraryEdit', stale: false, aiTask: null } } }, maxUsageCount: Infinity },
  ]
  render(<MockedProvider mocks={reviewMocks}><LibraryWorkspace library={library}>
    <DragDropProvider><ExperienceSection experiences={library.experiences} highlightsOf={() => experience.highlights} /></DragDropProvider><LibraryAiWorkspace />
  </LibraryWorkspace></MockedProvider>)
  await userEvent.click(await screen.findByRole('button', { name: 'Answer review questions' }))
  const panel = screen.getByRole('complementary', { name: 'AI workspace' })
  expect(await within(panel).findByLabelText('Your answer to question 1 (optional)')).toBeEnabled()
  expect(within(panel).getAllByRole('textbox')).toHaveLength(3)
  expect(within(panel).getByText('Which part did you build?')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Improve with AI' })).toBeEnabled()
  expect(document.getElementById('library-detail-experience_highlight:h1')).toHaveAttribute('data-selected', 'true')
})
