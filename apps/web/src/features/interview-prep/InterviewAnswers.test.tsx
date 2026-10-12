/**
 * Description: Answer draft preservation, feedback persistence, navigation warnings, and replacement safety.
 * Index: question, detail, openAnswer
 */
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { expect, it } from 'vitest'
import { renderPage } from '@/test/renderPage'
import { AI_TASK_UPDATED_SUBSCRIPTION } from '@/features/ai-tasks/aiTaskOperations'
import { InterviewSetPage } from './InterviewSetPage'
import { INTERVIEW_SET_QUERY, REQUEST_INTERVIEW_FEEDBACK, SAVE_INTERVIEW_ANSWER, REGENERATE_INTERVIEW_QUESTION } from './interviewPrepOperations'

/** Builds a saved question with grounded feedback. */
function question(answerText = 'Saved answer', latestTask: unknown = null) {
  return { __typename: 'InterviewQuestion', id: 'q1', position: 1, questionText: 'Tell me about yourself', answerText, answerRevision: 1, questionRevision: 1, feedbackQuestionRevision: 1, feedbackAnswerRevision: 0, feedback: { strengths: ['Clear opening'], improvements: ['Add a result'], example_answer: 'I helped [add your result].' }, feedbackOutdated: false, latestTask }
}
/** Provides a complete set-query response. */
function detail(answerText = 'Saved answer', latestTask: unknown = null) {
  return { request: { query: INTERVIEW_SET_QUERY, variables: { id: 's1' } }, result: { data: { interviewQuestionSet: { __typename: 'InterviewQuestionSet', id: 's1', number: 1, setType: 'GENERAL', createdAt: '2026-10-11T00:00:00Z', latestTask: null, questions: [question(answerText, latestTask)] } } } }
}
/** Opens the initially collapsed answer card. */
async function openAnswer() {
  fireEvent.click(await screen.findByRole('button', { name: 'Question 1' }))
  return screen.getByRole('textbox', { name: 'Your answer' })
}

it('keeps drafts through collapse and warns before navigating away', async () => {
  const { router } = renderPage({ path: '/interview-prep/:id', url: '/interview-prep/s1', element: <InterviewSetPage />, mocks: [detail()], extraRoutes: [{ path: '/interview-prep', element: <p>Sets list</p> }] })
  fireEvent.change(await openAnswer(), { target: { value: 'My draft' } })
  expect(screen.getByText(/Outdated feedback/)).toBeInTheDocument()
  expect(screen.getByText('[add your result]')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Question 1' }))
  fireEvent.click(screen.getByRole('button', { name: 'Question 1' }))
  expect(screen.getByRole('textbox')).toHaveValue('My draft')
  fireEvent.click(screen.getByRole('link', { name: 'All question sets' }))
  expect(await screen.findByText(/Leave and discard/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
  expect(router.state.location.pathname).toBe('/interview-prep/s1')
})

it('saves the submitted snapshot while preserving edits typed during saving', async () => {
  renderPage({ path: '/interview-prep/:id', url: '/interview-prep/s1', element: <InterviewSetPage />, mocks: [detail(), { request: { query: SAVE_INTERVIEW_ANSWER, variables: { questionSetId: 's1', questionId: 'q1', answerText: 'Submitted answer' } }, delay: 100, result: { data: { saveInterviewAnswer: { __typename: 'SaveInterviewAnswerPayload', errors: [], question: { __typename: 'InterviewQuestion', id: 'q1', answerText: 'Submitted answer', answerRevision: 2, feedbackOutdated: true } } } } }, detail('Submitted answer')] })
  const textarea = await openAnswer()
  fireEvent.change(textarea, { target: { value: 'Submitted answer' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save answer' }))
  expect(await screen.findByText(/Saving answer/)).toBeInTheDocument()
  fireEvent.change(textarea, { target: { value: 'Newer draft' } })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save answer' })).toBeEnabled())
  expect(textarea).toHaveValue('Newer draft')
  expect(screen.getByText(/Unsaved changes/)).toBeInTheDocument()
})

it('keeps feedback current for formatting edits while still requiring the answer to be saved', async () => {
  renderPage({ path: '/interview-prep/:id', url: '/interview-prep/s1', element: <InterviewSetPage />, mocks: [detail()] })
  const textarea = await openAnswer()
  fireEvent.change(textarea, { target: { value: '  SAVED\n answer ' } })
  expect(screen.queryByText(/Outdated feedback/)).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Save answer' })).toBeEnabled()
  expect(screen.getByRole('button', { name: 'Get feedback' })).toBeDisabled()
  fireEvent.change(textarea, { target: { value: 'A different answer' } })
  expect(screen.getByText(/Outdated feedback — you have unsaved answer changes/)).toBeInTheDocument()
})

it('preserves a draft reverted to the previous saved text while saving', async () => {
  renderPage({ path: '/interview-prep/:id', url: '/interview-prep/s1', element: <InterviewSetPage />, mocks: [detail(), { request: { query: SAVE_INTERVIEW_ANSWER, variables: { questionSetId: 's1', questionId: 'q1', answerText: 'Submitted answer' } }, delay: 100, result: { data: { saveInterviewAnswer: { __typename: 'SaveInterviewAnswerPayload', errors: [], question: { __typename: 'InterviewQuestion', id: 'q1', answerText: 'Submitted answer', answerRevision: 2, feedbackOutdated: true } } } } }, detail('Submitted answer')] })
  const textarea = await openAnswer()
  fireEvent.change(textarea, { target: { value: 'Submitted answer' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save answer' }))
  expect(await screen.findByText(/Saving answer/)).toBeInTheDocument()
  fireEvent.change(textarea, { target: { value: 'Saved answer' } })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save answer' })).toBeEnabled())
  expect(textarea).toHaveValue('Saved answer')
  expect(screen.getByText(/Unsaved changes/)).toBeInTheDocument()
})

it('requires saving before feedback and disables feedback again after editing', async () => {
  renderPage({ path: '/interview-prep/:id', url: '/interview-prep/s1', element: <InterviewSetPage />, mocks: [detail(''), { request: { query: SAVE_INTERVIEW_ANSWER, variables: { questionSetId: 's1', questionId: 'q1', answerText: 'Typed for feedback' } }, result: { data: { saveInterviewAnswer: { __typename: 'SaveInterviewAnswerPayload', errors: [], question: { __typename: 'InterviewQuestion', id: 'q1', answerText: 'Typed for feedback', answerRevision: 2, feedbackOutdated: true } } } } }, detail('Typed for feedback')] })
  const textarea = await openAnswer()
  expect(textarea).toHaveAttribute('maxlength', '1000')
  expect(screen.getByRole('button', { name: 'Get feedback' })).toBeDisabled()
  fireEvent.change(textarea, { target: { value: 'Typed for feedback' } })
  expect(screen.getByRole('button', { name: 'Get feedback' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Save answer' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Get feedback' })).toBeEnabled())
  expect(textarea).toHaveValue('Typed for feedback')
  fireEvent.change(textarea, { target: { value: 'New draft' } })
  expect(screen.getByRole('button', { name: 'Get feedback' })).toBeDisabled()
})

it('requires answered replacement confirmation and preserves content on queue failure', async () => {
  renderPage({ path: '/interview-prep/:id', url: '/interview-prep/s1', element: <InterviewSetPage />, mocks: [detail(), { request: { query: REGENERATE_INTERVIEW_QUESTION, variables: { questionSetId: 's1', questionId: 'q1', confirmed: true } }, result: { data: { regenerateInterviewQuestion: { __typename: 'RegenerateInterviewQuestionPayload', errors: ['Queue unavailable'], aiTask: null } } } }, detail()] })
  await openAnswer()
  fireEvent.click(screen.getByRole('button', { name: 'Regenerate question' }))
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Replace question' }))
  expect(await screen.findAllByText('Queue unavailable')).toHaveLength(2)
  expect(screen.getByLabelText('Your answer')).toHaveValue('Saved answer')
})

it('restores replacement progress and disables editing and conflicting controls', async () => {
  renderPage({ path: '/interview-prep/:id', url: '/interview-prep/s1', element: <InterviewSetPage />, mocks: [detail('Saved answer', { __typename: 'AiTask', id: 't1', status: 'QUEUED', taskType: 'REGENERATE_INTERVIEW_QUESTION', errorMessage: null }), { request: { query: AI_TASK_UPDATED_SUBSCRIPTION, variables: { id: 't1' } }, delay: Infinity, result: { data: {} } }] })
  expect(await openAnswer()).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Get feedback' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Regenerate question' })).toBeDisabled()
})

it('keeps replacement editing locked until the new question revision loads', async () => {
  const task = { __typename: 'AiTask', id: 't1', status: 'QUEUED', taskType: 'REGENERATE_INTERVIEW_QUESTION', errorMessage: null }
  const replacement = detail('')
  replacement.result.data.interviewQuestionSet.questions[0].questionRevision = 2
  replacement.result.data.interviewQuestionSet.questions[0].questionText = 'New replacement question'
  renderPage({ path: '/interview-prep/:id', url: '/interview-prep/s1', element: <InterviewSetPage />, mocks: [detail('Saved answer', task), {
    request: { query: AI_TASK_UPDATED_SUBSCRIPTION, variables: { id: 't1' } }, delay: 100,
    result: { data: { aiTaskUpdated: { ...task, status: 'COMPLETED', result: null, input: {}, pendingQuestions: [], acceptedAt: null, createdAt: '2026-10-11T00:00:00Z', job: null } } },
  }, { ...replacement, delay: 300 }] })
  const textarea = await openAnswer()
  expect(textarea).toBeDisabled()
  expect(textarea).toHaveValue('Saved answer')
  expect(await screen.findByText('New replacement question')).toBeInTheDocument()
  await waitFor(() => expect(textarea).toBeEnabled())
  expect(textarea).toHaveValue('')
})

it('keeps editing available during feedback after a failed replacement', async () => {
  const replacementTask = { __typename: 'AiTask', id: 't1', status: 'QUEUED', taskType: 'REGENERATE_INTERVIEW_QUESTION', errorMessage: null }
  const failedTask = { ...replacementTask, status: 'FAILED', errorMessage: 'Replacement failed' }
  const feedbackTask = { ...replacementTask, id: 't2', taskType: 'REVIEW_INTERVIEW_ANSWER' }
  renderPage({ path: '/interview-prep/:id', url: '/interview-prep/s1', element: <InterviewSetPage />, mocks: [detail('Saved answer', replacementTask), {
    request: { query: AI_TASK_UPDATED_SUBSCRIPTION, variables: { id: 't1' } }, delay: 100,
    result: { data: { aiTaskUpdated: { ...failedTask, result: null, input: {}, pendingQuestions: [], acceptedAt: null, createdAt: '2026-10-11T00:00:00Z', job: null } } },
  }, detail('Saved answer', failedTask), {
    request: { query: REQUEST_INTERVIEW_FEEDBACK, variables: { questionSetId: 's1', questionId: 'q1', answerText: 'Saved answer' } },
    delay: 100,
    result: { data: { requestInterviewAnswerFeedback: { __typename: 'RequestInterviewAnswerFeedbackPayload', errors: [], aiTask: feedbackTask } } },
  }, detail('Saved answer', feedbackTask), { request: { query: AI_TASK_UPDATED_SUBSCRIPTION, variables: { id: 't2' } }, delay: Infinity, result: { data: {} } }] })
  const textarea = await openAnswer()
  expect(await screen.findByText('Replacement failed')).toBeInTheDocument()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Get feedback' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'Get feedback' }))
  expect(await screen.findByRole('button', { name: 'Requesting feedback…' })).toBeDisabled()
  expect(screen.getByText('Sending your answer for feedback…')).toBeInTheDocument()
  expect(await screen.findByRole('button', { name: 'Reviewing answer…' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Reviewing answer…' })).toBeDisabled()
  expect(screen.getByText('Feedback is being prepared. You can keep editing your answer.')).toBeInTheDocument()
  expect(textarea).toBeEnabled()
  fireEvent.change(textarea, { target: { value: 'Keep editing during feedback' } })
  expect(textarea).toHaveValue('Keep editing during feedback')
})

it('clears the feedback progress indicator when the task finishes', async () => {
  const task = { __typename: 'AiTask', id: 'feedback-1', status: 'QUEUED', taskType: 'REVIEW_INTERVIEW_ANSWER', errorMessage: null }
  const completed = { ...task, status: 'COMPLETED' }
  const completedDetail = detail('Saved answer', completed)
  completedDetail.result.data.interviewQuestionSet.questions[0].feedbackAnswerRevision = 1
  const outdatedDetail = detail('Saved answer', task)
  outdatedDetail.result.data.interviewQuestionSet.questions[0].feedbackOutdated = true
  renderPage({ path: '/interview-prep/:id', url: '/interview-prep/s1', element: <InterviewSetPage />, mocks: [outdatedDetail, {
    request: { query: AI_TASK_UPDATED_SUBSCRIPTION, variables: { id: task.id } }, delay: 300,
    result: { data: { aiTaskUpdated: { ...completed, result: null, input: {}, pendingQuestions: [], acceptedAt: null, createdAt: '2026-10-11T00:00:00Z', job: null } } },
  }, completedDetail] })
  await openAnswer()
  expect(screen.getByText(/Outdated feedback — this reviews an earlier saved answer/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Reviewing answer…' })).toBeDisabled()
  await waitFor(() => expect(screen.getByText(/Feedback received for this version/)).toBeInTheDocument())
  expect(screen.getByRole('button', { name: 'Get feedback' })).toBeDisabled()
  expect(screen.queryByText('Feedback is being prepared. You can keep editing your answer.')).not.toBeInTheDocument()
  await waitFor(() => expect(screen.queryByText(/Outdated feedback/)).not.toBeInTheDocument())
})

it('requires a changed saved version after feedback, including after reload', async () => {
  const reviewed = detail()
  reviewed.result.data.interviewQuestionSet.questions[0].feedbackAnswerRevision = 1
  const updated = detail('Changed saved answer')
  updated.result.data.interviewQuestionSet.questions[0].answerRevision = 2
  updated.result.data.interviewQuestionSet.questions[0].feedbackAnswerRevision = 1
  updated.result.data.interviewQuestionSet.questions[0].feedbackOutdated = true
  renderPage({ path: '/interview-prep/:id', url: '/interview-prep/s1', element: <InterviewSetPage />, mocks: [reviewed, {
    request: { query: SAVE_INTERVIEW_ANSWER, variables: { questionSetId: 's1', questionId: 'q1', answerText: 'Changed saved answer' } },
    result: { data: { saveInterviewAnswer: { __typename: 'SaveInterviewAnswerPayload', errors: [], question: { __typename: 'InterviewQuestion', id: 'q1', answerText: 'Changed saved answer', answerRevision: 2, feedbackOutdated: true } } } },
  }, updated] })
  const textarea = await openAnswer()
  expect(screen.getByRole('button', { name: 'Get feedback' })).toBeDisabled()
  fireEvent.change(textarea, { target: { value: 'Changed saved answer' } })
  expect(screen.getByRole('button', { name: 'Get feedback' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Save answer' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Get feedback' })).toBeEnabled())
})
