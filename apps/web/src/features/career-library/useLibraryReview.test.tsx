/** Exercise section review through GraphQL requests and real subscription updates. */
import { render, screen, waitFor } from '@testing-library/react'
import { MockedProvider } from '@apollo/client/testing/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'
import { AI_TASK_UPDATED_SUBSCRIPTION } from '@/features/ai-tasks/aiTaskOperations'
import { renderPage } from '@/test/renderPage'
import { LibraryAssessment } from './LibraryAssessment'
import { LIBRARY_REVIEW_QUERY, REVIEW_LIBRARY_SECTION_MUTATION } from './libraryReviewOperations'
import { useLibraryReview } from './useLibraryReview'

function Harness({ source = 'same source' }: { source?: string }) {
  const review = useLibraryReview('experience', source)
  return <>
    <button onClick={() => void review.start()} disabled={review.busy}>{review.busy ? 'Reviewing…' : 'Review'}</button>
    <LibraryAssessment assessment={review.assessments[0]} />
    {review.errors.map((error) => <p key={error}>{error}</p>)}
  </>
}

const query = { query: LIBRARY_REVIEW_QUERY, variables: { section: 'experience' } }
const completed = { __typename: 'AiTask', id: 'task-1', status: 'COMPLETED', errorMessage: null }

it('starts one section and loads saved colors after the subscription completes', async () => {
  renderPage({ path: '/', url: '/', element: <Harness />, mocks: [
    { request: query, result: { data: { libraryReview: { __typename: 'LibraryReview', aiTask: null, assessments: [] } } } },
    { request: { query: REVIEW_LIBRARY_SECTION_MUTATION, variables: { section: 'experience' } }, result: { data: {
      reviewLibrarySection: { __typename: 'ReviewLibrarySectionPayload', aiTask: { ...completed, status: 'QUEUED' }, errors: [] },
    } } },
    { request: { query: AI_TASK_UPDATED_SUBSCRIPTION, variables: { id: 'task-1' } }, result: { data: {
      aiTaskUpdated: { ...completed, taskType: 'REVIEW_LIBRARY_SECTION', result: null, input: {}, pendingQuestions: [], acceptedAt: null, createdAt: '2026-10-25T00:00:00Z', job: null },
    } } },
    { request: query, result: { data: { libraryReview: { __typename: 'LibraryReview', aiTask: completed, assessments: [
      { __typename: 'LibraryAssessment', kind: 'experience', recordId: 'e1', field: 'description', color: 'yellow', reason: 'Explain the scope.', stale: false },
    ] } } } },
  ] })
  await userEvent.click(await screen.findByRole('button', { name: 'Review' }))
  expect(await screen.findByText('Could improve')).toBeInTheDocument()
  expect(screen.getByText('Explain the scope.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Review' })).toBeEnabled()
})

it('explains failed assessment loading instead of silently showing current grades', async () => {
  renderPage({ path: '/', url: '/', element: <Harness />, mocks: [
    { request: query, error: new Error('offline') },
  ] })
  expect(await screen.findByText('Could not load the assessments. Reload to try again.')).toBeInTheDocument()
  expect(screen.queryByText('Looks good')).not.toBeInTheDocument()
})


it('hides old green advice if a source change cannot refresh freshness', async () => {
  const mocks = [
    { request: query, result: { data: { libraryReview: { __typename: 'LibraryReview', aiTask: completed, assessments: [
      { __typename: 'LibraryAssessment', kind: 'experience', recordId: 'e1', field: 'description', color: 'green', reason: 'Clear scope.', stale: false },
    ] } } } },
    { request: query, error: new Error('offline after edit') },
  ]
  const { rerender } = render(<MockedProvider mocks={mocks}><Harness source="before" /></MockedProvider>)
  expect(await screen.findByText('Looks good')).toBeInTheDocument()
  rerender(<MockedProvider mocks={mocks}><Harness source="after" /></MockedProvider>)
  await waitFor(() => expect(screen.getByText('Needs review')).toBeInTheDocument())
  expect(await screen.findByText('Could not load the assessments. Reload to try again.')).toBeInTheDocument()
  expect(screen.queryByText('Looks good')).not.toBeInTheDocument()
})
