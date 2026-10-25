/** Follow an individual edit through actual GraphQL mocks and task subscription updates. */
import { render, screen, waitFor } from '@testing-library/react'
import { MockedProvider } from '@apollo/client/testing/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'
import { AI_TASK_UPDATED_SUBSCRIPTION } from '@/features/ai-tasks/aiTaskOperations'
import { renderPage } from '@/test/renderPage'
import { LibraryEditPanel } from './LibraryEditPanel'
import { ANSWER_LIBRARY_REVIEW_MUTATION, ACCEPT_LIBRARY_EDIT_MUTATION, LIBRARY_EDIT_QUERY, START_LIBRARY_EDIT_MUTATION } from './libraryEditOperations'

const target = { kind: 'experience_highlight', recordId: 'h1' }
const query = { query: LIBRARY_EDIT_QUERY, variables: target }
const task = { __typename: 'AiTask' as const, id: 'edit-1', status: 'COMPLETED' as const,
  result: { text: 'Migrated the billing API with the platform team.', color: 'yellow', reason: 'Add an outcome if known.' },
  input: {}, pendingQuestions: [], errorMessage: null, acceptedAt: null }
const subscription = (value: { id: string } & Record<string, unknown> = task) => ({ request: { query: AI_TASK_UPDATED_SUBSCRIPTION, variables: { id: value.id } },
  result: { data: { aiTaskUpdated: { ...value, taskType: 'IMPROVE_LIBRARY_ENTRY', createdAt: '2026-10-25T00:00:00Z', job: null } } } })
const element = <LibraryEditPanel onClose={() => {}} {...target} sourceRevision="same" />

it('opens saved work and accepts only its server-owned proposal', async () => {
  renderPage({ path: '/', url: '/', element, mocks: [
    { request: query, result: { data: { libraryEdit: { __typename: 'LibraryEdit', stale: false, aiTask: task } } } },
    subscription(),
    { request: { query: ACCEPT_LIBRARY_EDIT_MUTATION, variables: { aiTaskId: task.id } }, result: { data: {
      acceptLibraryEdit: { __typename: 'AcceptLibraryEditPayload', errors: [], aiTask: { ...task, acceptedAt: '2026-10-25T00:00:01Z' } },
    } } },
  ] })
  expect(await screen.findByText('Migrated the billing API with the platform team.')).toBeInTheDocument()
  expect(screen.queryByText('Current text')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Accept revision' }))
  expect(await screen.findByText('Saved to your library.')).toBeInTheDocument()
})

it('restores a pending question and submits a skip as a single continuation', async () => {
  const waiting = { ...task, status: 'NEEDS_USER_INPUT' as const, result: null,
    pendingQuestions: [{ id: 'q1', question: 'Which part did you handle?' }] }
  const next = { ...task, id: 'edit-2' }
  renderPage({ path: '/', url: '/', element, mocks: [
    { request: query, result: { data: { libraryEdit: { __typename: 'LibraryEdit', stale: false, aiTask: waiting } } } },
    subscription(waiting),
    { request: { query: START_LIBRARY_EDIT_MUTATION, variables: { ...target, feedback: '', skip: true, previousTaskId: 'edit-1' } },
      result: { data: { startLibraryEdit: { __typename: 'StartLibraryEditPayload', aiTask: next, errors: [] } } } },
    subscription(next),
  ] })
  expect(await screen.findByText('Which part did you handle?')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Skip question' }))
  expect(await screen.findByText('Migrated the billing API with the platform team.')).toBeInTheDocument()
  expect(screen.queryByText('Which part did you handle?')).not.toBeInTheDocument()
})

it('allows another edit after reopening an accepted draft, with optional initial feedback', async () => {
  const accepted = { ...task, acceptedAt: '2026-10-25T00:00:01Z' }
  const next = { ...task, id: 'edit-new' }
  renderPage({ path: '/', url: '/', element, mocks: [
    { request: query, result: { data: { libraryEdit: { __typename: 'LibraryEdit', stale: true, aiTask: accepted } } } },
    subscription(accepted),
    { request: { query: START_LIBRARY_EDIT_MUTATION, variables: { ...target, feedback: '', skip: false, previousTaskId: null } },
      result: { data: { startLibraryEdit: { __typename: 'StartLibraryEditPayload', aiTask: next, errors: [] } } } },
    subscription(next),
  ] })
  await userEvent.click(await screen.findByRole('button', { name: 'Start another edit' }))
  expect(screen.getByLabelText('What would you like to improve? (optional)')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Generate revision' }))
  expect(await screen.findByText('Proposed revision')).toBeInTheDocument()
})

it('disables acceptance immediately when the visible source changes, even if refresh fails', async () => {
  const fresh = { ...task, id: 'fresh-edit' }
  const mocks = [
    { request: query, result: { data: { libraryEdit: { __typename: 'LibraryEdit', stale: false, aiTask: task } } } },
    subscription(),
    { request: query, error: new Error('offline after edit') },
    { request: { query: START_LIBRARY_EDIT_MUTATION, variables: { ...target, feedback: '', skip: false, previousTaskId: null } },
      result: { data: { startLibraryEdit: { __typename: 'StartLibraryEditPayload', aiTask: fresh, errors: [] } } } },
    subscription(fresh),
  ]
  const view = (source: string) => <MockedProvider mocks={mocks}><LibraryEditPanel onClose={() => {}} {...target} sourceRevision={source} /></MockedProvider>
  const { rerender } = render(view('before'))
  expect(await screen.findByRole('button', { name: 'Accept revision' })).toBeEnabled()
  rerender(view('after'))
  expect(screen.getByRole('button', { name: 'Accept revision' })).toBeDisabled()
  expect(await screen.findByText('Could not refresh this edit. Reload to continue.')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Generate new revision' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Accept revision' })).toBeEnabled())
})

it('offers a review answer without starting an ordinary edit', async () => {
  renderPage({ path: '/', url: '/', element: <LibraryEditPanel onClose={() => {}} {...target} sourceRevision="same"
    reviewQuestion={{ reviewTaskId: 'review-1', question: 'Which endpoints did you migrate?', stale: false }} />, mocks: [
    { request: query, result: { data: { libraryEdit: { __typename: 'LibraryEdit', stale: false, aiTask: null } } } },
  ] })
  expect(await screen.findByText('Which endpoints did you migrate?')).toBeInTheDocument()
  expect(screen.getByLabelText('Your answer')).toBeEnabled()
  expect(screen.getByRole('button', { name: 'Generate revision from answer' })).toBeDisabled()
  expect(screen.queryByLabelText('What would you like to improve? (optional)')).not.toBeInTheDocument()
})


const reviewQuestion = { reviewTaskId: 'review-1', question: 'Which endpoints did you migrate?', stale: false }
const reviewTask = { ...task, input: { review_question: { review_task_id: 'review-1', question: reviewQuestion.question }, feedback: 'I migrated billing.' } }
const reviewElement = <LibraryEditPanel onClose={() => {}} {...target} sourceRevision="same" reviewQuestion={reviewQuestion} />

it('submits an answer through the review mutation and follows the proposal without another question', async () => {
  const queued = { ...reviewTask, status: 'QUEUED', result: null }
  renderPage({ path: '/', url: '/', element: reviewElement, mocks: [
    { request: query, result: { data: { libraryEdit: { __typename: 'LibraryEdit', stale: false, aiTask: null } } } },
    { request: { query: ANSWER_LIBRARY_REVIEW_MUTATION, variables: { ...target, reviewTaskId: 'review-1', answers: [{ questionIndex: 0, answer: 'I migrated billing.' }] } },
      result: { data: { answerLibraryReview: { __typename: 'AnswerLibraryReviewPayload', aiTask: queued, errors: [] } } } },
    subscription(reviewTask),
    { request: { query: ACCEPT_LIBRARY_EDIT_MUTATION, variables: { aiTaskId: task.id } }, result: { data: {
      acceptLibraryEdit: { __typename: 'AcceptLibraryEditPayload', errors: [], aiTask: { ...reviewTask, acceptedAt: '2026-10-25T00:00:01Z' } },
    } } },
  ] })
  await userEvent.type(await screen.findByLabelText('Your answer'), 'I migrated billing.')
  await userEvent.click(screen.getByRole('button', { name: 'Generate revision from answer' }))
  expect(await screen.findByText('Migrated the billing API with the platform team.')).toBeInTheDocument()
  expect(screen.queryByText('Which endpoints did you migrate?')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Generate revision from answer' })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Accept revision' }))
  expect(await screen.findByText('Saved to your library.')).toBeInTheDocument()
})

it('keeps an answer editable when the server reports an unrelated draft conflict', async () => {
  renderPage({ path: '/', url: '/', element: reviewElement, mocks: [
    { request: query, result: { data: { libraryEdit: { __typename: 'LibraryEdit', stale: false, aiTask: task } } } },
    subscription(),
    { request: { query: ANSWER_LIBRARY_REVIEW_MUTATION, variables: { ...target, reviewTaskId: 'review-1', answers: [{ questionIndex: 0, answer: 'I migrated billing.' }] } },
      result: { data: { answerLibraryReview: { __typename: 'AnswerLibraryReviewPayload', aiTask: null, errors: ['Finish or discard your existing draft.'] } } } },
  ] })
  await userEvent.type(await screen.findByLabelText('Your answer'), 'I migrated billing.')
  await userEvent.click(screen.getByRole('button', { name: 'Generate revision from answer' }))
  expect(await screen.findByText('Finish or discard your existing draft.')).toBeInTheDocument()
  expect(screen.getByLabelText('Your answer')).toHaveValue('I migrated billing.')
  expect(screen.getByText('Migrated the billing API with the platform team.')).toBeInTheDocument()
})

it('recovers a saved review proposal and retries a failed review answer as a linked edit', async () => {
  const failed = { ...reviewTask, status: 'FAILED', result: null, errorMessage: 'Temporary provider failure' }
  const next = { ...reviewTask, id: 'retry-edit' }
  renderPage({ path: '/', url: '/', element: reviewElement, mocks: [
    { request: query, result: { data: { libraryEdit: { __typename: 'LibraryEdit', stale: false, aiTask: failed } } } },
    subscription(failed),
    { request: { query: START_LIBRARY_EDIT_MUTATION, variables: { ...target, feedback: 'I migrated billing.', skip: false, previousTaskId: task.id } },
      result: { data: { startLibraryEdit: { __typename: 'StartLibraryEditPayload', aiTask: next, errors: [] } } } },
    subscription(next),
  ] })
  await userEvent.click(await screen.findByRole('button', { name: 'Retry revision' }))
  expect(await screen.findByText('Migrated the billing API with the platform team.')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Generate revision from answer' })).not.toBeInTheDocument()
})

it('disables a stale review question instead of submitting an answer against earlier text', async () => {
  renderPage({ path: '/', url: '/', element: <LibraryEditPanel onClose={() => {}} {...target} sourceRevision="same" reviewQuestion={{ ...reviewQuestion, stale: true }} />, mocks: [
    { request: query, result: { data: { libraryEdit: { __typename: 'LibraryEdit', stale: false, aiTask: null } } } },
  ] })
  expect(await screen.findByLabelText('Your answer')).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Generate revision from answer' })).toBeDisabled()
})

it('submits any answered questions together without shifting indices after blank fields', async () => {
  const batchQuestion = { ...reviewQuestion, questions: ['Which endpoints did you migrate?', 'How did you check it?', 'What changed afterward?'] }
  const batchTask = { ...reviewTask, input: { feedback: '', review_question: { review_task_id: 'review-1', answers: [
    { question_index: 1, question: batchQuestion.questions[1], answer: 'Integration tests.' },
    { question_index: 2, question: batchQuestion.questions[2], answer: 'Less repeated work.' },
  ] } } }
  renderPage({ path: '/', url: '/', element: <LibraryEditPanel onClose={() => {}} {...target} sourceRevision="same" reviewQuestion={batchQuestion} />, mocks: [
    { request: query, result: { data: { libraryEdit: { __typename: 'LibraryEdit', stale: false, aiTask: null } } } },
    { request: { query: ANSWER_LIBRARY_REVIEW_MUTATION, variables: { ...target, reviewTaskId: 'review-1', answers: [
      { questionIndex: 1, answer: 'Integration tests.' }, { questionIndex: 2, answer: 'Less repeated work.' },
    ] } }, result: { data: { answerLibraryReview: { __typename: 'AnswerLibraryReviewPayload', aiTask: batchTask, errors: [] } } } },
    subscription(batchTask),
  ] })
  expect(await screen.findByText('How did you check it?')).toBeInTheDocument()
  const button = screen.getByRole('button', { name: 'Generate revision from answers' })
  expect(button).toBeDisabled()
  const fields = screen.getAllByRole('textbox')
  expect(fields).toHaveLength(3)
  fields.forEach((field) => expect(field).not.toBeRequired())
  await userEvent.type(fields[0], '   ')
  expect(button).toBeDisabled()
  await userEvent.type(fields[1], 'Integration tests.')
  await userEvent.type(fields[2], 'Less repeated work.')
  expect(button).toBeEnabled()
  await userEvent.click(button)
  expect(await screen.findByText('Proposed revision')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Generate revision from answers' })).not.toBeInTheDocument()
})

it.each([{ positions: [0, 2] }, { positions: [0, 1, 2] }])('submits answered positions $positions in one request and preserves all fields on error', async ({ positions }) => {
  const questions = ['Which endpoints did you migrate?', 'How did you check it?', 'What changed afterward?']
  const answers = positions.map((questionIndex) => ({ questionIndex, answer: `Fact ${questionIndex + 1}.` }))
  renderPage({ path: '/', url: '/', element: <LibraryEditPanel onClose={() => {}} {...target} sourceRevision="same" reviewQuestion={{ ...reviewQuestion, questions }} />, mocks: [
    { request: query, result: { data: { libraryEdit: { __typename: 'LibraryEdit', stale: false, aiTask: null } } } },
    { request: { query: ANSWER_LIBRARY_REVIEW_MUTATION, variables: { ...target, reviewTaskId: 'review-1', answers } },
      result: { data: { answerLibraryReview: { __typename: 'AnswerLibraryReviewPayload', aiTask: null, errors: ['Please try again.'] } } } },
  ] })
  await screen.findByText(questions[2])
  const fields = screen.getAllByRole('textbox')
  for (const position of positions) await userEvent.type(fields[position], `Fact ${position + 1}.`)
  await userEvent.click(screen.getByRole('button', { name: 'Generate revision from answers' }))
  expect(await screen.findByText('Please try again.')).toBeInTheDocument()
  fields.forEach((field, index) => expect(field).toHaveValue(positions.includes(index) ? `Fact ${index + 1}.` : ''))
})

it('retries a saved failed batch without replacing its pairs with new feedback', async () => {
  const failed = { ...reviewTask, status: 'FAILED', result: null, errorMessage: 'Temporary provider failure', input: {
    feedback: '', review_question: { review_task_id: 'review-1', answers: [{ question_index: 2, question: 'What changed afterward?', answer: 'Less repeated work.' }] },
  } }
  const next = { ...failed, id: 'batch-retry', status: 'COMPLETED', result: task.result, errorMessage: null }
  renderPage({ path: '/', url: '/', element: reviewElement, mocks: [
    { request: query, result: { data: { libraryEdit: { __typename: 'LibraryEdit', stale: false, aiTask: failed } } } }, subscription(failed),
    { request: { query: START_LIBRARY_EDIT_MUTATION, variables: { ...target, feedback: '', skip: false, previousTaskId: task.id } },
      result: { data: { startLibraryEdit: { __typename: 'StartLibraryEditPayload', aiTask: next, errors: [] } } } }, subscription(next),
  ] })
  await userEvent.click(await screen.findByRole('button', { name: 'Retry revision' }))
  expect(await screen.findByText('Proposed revision')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Generate revision from answer' })).not.toBeInTheDocument()
})
