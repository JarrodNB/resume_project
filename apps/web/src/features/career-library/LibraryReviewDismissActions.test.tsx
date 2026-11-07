/** Exercises saved dismissal controls through the section review hook and GraphQL responses. */
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'
import { renderPage } from '@/test/renderPage'
import { LibraryWorkspace } from './LibraryWorkspace'
import { LibraryDetail } from './LibraryDetail'
import { emptyLibraryReviewMocks, emptyReviewLibrary } from './libraryReviewTestFixtures'
import { DISMISS_LIBRARY_REVIEW_MUTATION, LIBRARY_REVIEW_QUERY } from './libraryReviewOperations'

const record = { __typename: 'Project' as const, id: 'p1', name: 'Billing', role: null, url: null, startDate: null, endDate: null, ongoing: false, description: 'Built billing services.' }
const assessment = { __typename: 'LibraryAssessment', kind: 'project', recordId: 'p1', field: 'description', color: 'yellow', reason: 'Explain your contribution.', question: 'Which part did you build?', questions: ['Which part did you build?'], reviewTaskId: 'review-1', stale: false }
const query = { query: LIBRARY_REVIEW_QUERY, variables: { section: 'projects' } }
const response = (assessments: object[]) => ({ data: { libraryReview: { __typename: 'LibraryReview', aiTask: null, assessments } } })
const element = <LibraryWorkspace library={{ ...emptyReviewLibrary, projects: [record] }}><LibraryDetail kind="project" recordId="p1" text={record.description} /></LibraryWorkspace>

it.each([['questions', 'Nothing to add'], ['review', 'Dismiss review']])('saves a %s dismissal and refreshes visible feedback', async (scope, label) => {
  renderPage({ path: '/', url: '/', element, mocks: [
    ...emptyLibraryReviewMocks.filter((mock) => mock.request.variables.section !== 'projects'),
    { request: query, result: response([assessment]) },
    { request: { query: DISMISS_LIBRARY_REVIEW_MUTATION, variables: { reviewTaskId: 'review-1', kind: 'project', recordId: 'p1', scope } }, result: { data: { dismissLibraryReview: { __typename: 'DismissLibraryReviewPayload', errors: [] } } } },
    { request: query, result: response(scope === 'review' ? [] : [{ ...assessment, question: null, questions: [] }]) },
  ] })
  await userEvent.click(await screen.findByRole('button', { name: label }))
  await waitFor(() => {
    expect(screen.queryByText(assessment.question)).not.toBeInTheDocument()
    expect(screen.getByText(record.description)).toBeInTheDocument()
    if (scope === 'review') expect(screen.getByText('No AI review yet')).toBeInTheDocument()
    else expect(screen.getByText(assessment.reason)).toBeInTheDocument()
  })
})

it('keeps the feedback visible and explains a failed dismissal', async () => {
  renderPage({ path: '/', url: '/', element, mocks: [
    ...emptyLibraryReviewMocks.filter((mock) => mock.request.variables.section !== 'projects'),
    { request: query, result: response([assessment]) },
    { request: { query: DISMISS_LIBRARY_REVIEW_MUTATION, variables: { reviewTaskId: 'review-1', kind: 'project', recordId: 'p1', scope: 'questions' } }, result: { data: { dismissLibraryReview: { __typename: 'DismissLibraryReviewPayload', errors: ['This review is out of date. Review this section again.'] } } } },
  ] })
  await userEvent.click(await screen.findByRole('button', { name: 'Nothing to add' }))
  expect(await screen.findByText('This review is out of date. Review this section again.')).toBeInTheDocument()
  expect(screen.getByText(assessment.question)).toBeInTheDocument()
})
