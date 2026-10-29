/**
 * Description: Answer tests: draft preservation, feedback that saves first, navigation warnings,
 * replacement safety, and avoidance through the question's actions menu.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'
import { renderPage } from '@/test/renderPage'
import { AI_TASK_UPDATED_SUBSCRIPTION } from '@/features/ai-tasks/aiTaskOperations'
import { InterviewSetPage } from './InterviewSetPage'
import { INTERVIEW_SET_QUERY, REQUEST_INTERVIEW_FEEDBACK, SAVE_INTERVIEW_ANSWER, REGENERATE_INTERVIEW_QUESTION, AVOID_INTERVIEW_QUESTION } from './interviewPrepOperations'

/** Builds a saved question with grounded feedback. */
function question(answerText = 'Saved answer', latestTask: unknown = null) {
  return { __typename: 'InterviewQuestion', id: 'q1', position: 1, avoided: false, questionText: 'Tell me about yourself', answerText, answerRevision: 1, questionRevision: 1, feedbackQuestionRevision: 1, feedbackAnswerRevision: 0, feedback: { strengths: ['Clear opening'], improvements: ['Add a result'], example_answer: 'I helped [add your result].' }, feedbackOutdated: false, latestTask }
}
/** Provides a complete set-query response. */
function detail(answerText = 'Saved answer', latestTask: unknown = null) {
  return { request: { query: INTERVIEW_SET_QUERY, variables: { id: 's1' } }, result: { data: { interviewQuestionSet: { __typename: 'InterviewQuestionSet', id: 's1', number: 1, setType: 'GENERAL', createdAt: '2026-10-11T00:00:00Z', latestTask: null, questions: [question(answerText, latestTask)] } } } }
}
/** Waits for the open question's answer box. */
async function openAnswer() {
  return screen.findByRole('textbox', { name: 'Your answer' })
}
/** Picks one item from the question's actions menu. */
async function chooseAction(name: string) {
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Actions for question 1' }))
  await user.click(screen.getByRole('menuitem', { name }))
}
const ROUTE = '/practice/questions/:id/:questionId?'

it('marks feedback out of date for a changed draft and warns before navigating away', async () => {
  const { router } = renderPage({ path: ROUTE, url: '/practice/questions/s1/q1', element: <InterviewSetPage />, mocks: [detail()], extraRoutes: [{ path: '/practice/questions', element: <p>Question bank</p> }] })
  fireEvent.change(await openAnswer(), { target: { value: 'My draft' } })
  expect(screen.getByText(/Out of date: this feedback is for your earlier answer/)).toBeInTheDocument()
  expect(screen.getByText('[add your result]')).toBeInTheDocument()
  expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('link', { name: 'All questions' }))
  expect(await screen.findByText(/Leave and discard/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
  expect(router.state.location.pathname).toBe('/practice/questions/s1/q1')
  expect(screen.getByRole('textbox', { name: 'Your answer' })).toHaveValue('My draft')
})

it('saves the submitted snapshot while preserving edits typed during saving', async () => {
  renderPage({ path: ROUTE, url: '/practice/questions/s1', element: <InterviewSetPage />, mocks: [detail(), { request: { query: SAVE_INTERVIEW_ANSWER, variables: { questionSetId: 's1', questionId: 'q1', answerText: 'Submitted answer' } }, delay: 100, result: { data: { saveInterviewAnswer: { __typename: 'SaveInterviewAnswerPayload', errors: [], question: { __typename: 'InterviewQuestion', id: 'q1', answerText: 'Submitted answer', answerRevision: 2, feedbackOutdated: true } } } } }, detail('Submitted answer')] })
  const textarea = await openAnswer()
  fireEvent.change(textarea, { target: { value: 'Submitted answer' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(await screen.findByText('Saving…')).toBeInTheDocument()
  fireEvent.change(textarea, { target: { value: 'Newer draft' } })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled())
  expect(textarea).toHaveValue('Newer draft')
  expect(screen.getByText(/Unsaved changes/)).toBeInTheDocument()
})

it('keeps feedback current for formatting edits while still offering to save them', async () => {
  const reviewed = detail()
  reviewed.result.data.interviewQuestionSet.questions[0].feedbackAnswerRevision = 1
  renderPage({ path: ROUTE, url: '/practice/questions/s1', element: <InterviewSetPage />, mocks: [reviewed] })
  const textarea = await openAnswer()
  fireEvent.change(textarea, { target: { value: '  SAVED\n answer ' } })
  expect(screen.queryByText(/Out of date/)).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  expect(screen.getByRole('button', { name: 'Get feedback' })).toBeDisabled()
  fireEvent.change(textarea, { target: { value: 'A different answer' } })
  expect(screen.getByText(/Out of date: this feedback is for your earlier answer/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Get feedback' })).toBeEnabled()
})

it('preserves a draft reverted to the previous saved text while saving', async () => {
  renderPage({ path: ROUTE, url: '/practice/questions/s1', element: <InterviewSetPage />, mocks: [detail(), { request: { query: SAVE_INTERVIEW_ANSWER, variables: { questionSetId: 's1', questionId: 'q1', answerText: 'Submitted answer' } }, delay: 100, result: { data: { saveInterviewAnswer: { __typename: 'SaveInterviewAnswerPayload', errors: [], question: { __typename: 'InterviewQuestion', id: 'q1', answerText: 'Submitted answer', answerRevision: 2, feedbackOutdated: true } } } } }, detail('Submitted answer')] })
  const textarea = await openAnswer()
  fireEvent.change(textarea, { target: { value: 'Submitted answer' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(await screen.findByText('Saving…')).toBeInTheDocument()
  fireEvent.change(textarea, { target: { value: 'Saved answer' } })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled())
  expect(textarea).toHaveValue('Saved answer')
  expect(screen.getByText(/Unsaved changes/)).toBeInTheDocument()
})

it('sends a typed answer for feedback without a separate save', async () => {
  const task = { __typename: 'AiTask', id: 'fb-1', status: 'QUEUED', taskType: 'REVIEW_INTERVIEW_ANSWER', errorMessage: null }
  renderPage({ path: ROUTE, url: '/practice/questions/s1', element: <InterviewSetPage />, mocks: [detail(''), {
    request: { query: REQUEST_INTERVIEW_FEEDBACK, variables: { questionSetId: 's1', questionId: 'q1', answerText: 'Typed for feedback' } },
    result: { data: { requestInterviewAnswerFeedback: { __typename: 'RequestInterviewAnswerFeedbackPayload', errors: [], aiTask: task } } },
  }, detail('Typed for feedback', task), { request: { query: AI_TASK_UPDATED_SUBSCRIPTION, variables: { id: 'fb-1' } }, delay: Infinity, result: { data: {} } }] })
  const textarea = await openAnswer()
  expect(textarea).toHaveAttribute('maxlength', '2000')
  expect(screen.getByRole('button', { name: 'Get feedback' })).toBeDisabled()
  fireEvent.change(textarea, { target: { value: 'Typed for feedback' } })
  fireEvent.click(screen.getByRole('button', { name: 'Get feedback' }))
  expect(await screen.findByRole('button', { name: 'Getting feedback…' })).toBeDisabled()
  expect(screen.getByText('Getting feedback. You can keep editing.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  expect(textarea).toHaveValue('Typed for feedback')
})

it('requires answered replacement confirmation and preserves content on queue failure', async () => {
  renderPage({ path: ROUTE, url: '/practice/questions/s1', element: <InterviewSetPage />, mocks: [detail(), { request: { query: REGENERATE_INTERVIEW_QUESTION, variables: { questionSetId: 's1', questionId: 'q1', confirmed: true } }, result: { data: { regenerateInterviewQuestion: { __typename: 'RegenerateInterviewQuestionPayload', errors: ['Queue unavailable'], aiTask: null } } } }, detail()] })
  await openAnswer()
  await chooseAction('Replace question')
  expect(screen.getByRole('dialog')).toHaveTextContent('Answers from replaced questions')
  fireEvent.click(screen.getByRole('button', { name: 'Replace question' }))
  expect(await screen.findAllByText('Queue unavailable')).toHaveLength(2)
  expect(screen.getByLabelText('Your answer')).toHaveValue('Saved answer')
})

it('restores replacement progress and disables editing and conflicting controls', async () => {
  renderPage({ path: ROUTE, url: '/practice/questions/s1', element: <InterviewSetPage />, mocks: [detail('Saved answer', { __typename: 'AiTask', id: 't1', status: 'QUEUED', taskType: 'REGENERATE_INTERVIEW_QUESTION', errorMessage: null }), { request: { query: AI_TASK_UPDATED_SUBSCRIPTION, variables: { id: 't1' } }, delay: Infinity, result: { data: {} } }] })
  expect(await openAnswer()).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Get feedback' })).toBeDisabled()
  await userEvent.setup().click(screen.getByRole('button', { name: 'Actions for question 1' }))
  expect(screen.getByRole('menuitem', { name: 'Replace question' })).toHaveAttribute('aria-disabled', 'true')
})

it('keeps replacement editing locked until the new question revision loads', async () => {
  const task = { __typename: 'AiTask', id: 't1', status: 'QUEUED', taskType: 'REGENERATE_INTERVIEW_QUESTION', errorMessage: null }
  const replacement = detail('')
  replacement.result.data.interviewQuestionSet.questions[0].questionRevision = 2
  replacement.result.data.interviewQuestionSet.questions[0].questionText = 'New replacement question'
  renderPage({ path: ROUTE, url: '/practice/questions/s1', element: <InterviewSetPage />, mocks: [detail('Saved answer', task), {
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
  renderPage({ path: ROUTE, url: '/practice/questions/s1', element: <InterviewSetPage />, mocks: [detail('Saved answer', replacementTask), {
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
  expect(await screen.findByRole('button', { name: 'Sending…' })).toBeDisabled()
  expect(screen.getByText('Saving and sending for feedback…')).toBeInTheDocument()
  expect(await screen.findByRole('button', { name: 'Getting feedback…' })).toBeDisabled()
  expect(screen.getByText('Getting feedback. You can keep editing.')).toBeInTheDocument()
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
  renderPage({ path: ROUTE, url: '/practice/questions/s1', element: <InterviewSetPage />, mocks: [outdatedDetail, {
    request: { query: AI_TASK_UPDATED_SUBSCRIPTION, variables: { id: task.id } }, delay: 300,
    result: { data: { aiTaskUpdated: { ...completed, result: null, input: {}, pendingQuestions: [], acceptedAt: null, createdAt: '2026-10-11T00:00:00Z', job: null } } },
  }, completedDetail] })
  await openAnswer()
  expect(screen.getByText(/Out of date: this reviews an earlier saved answer/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Getting feedback…' })).toBeDisabled()
  await waitFor(() => expect(screen.getByText(/This feedback is for your current answer/)).toBeInTheDocument())
  expect(screen.getByRole('button', { name: 'Get feedback' })).toBeDisabled()
  expect(screen.queryByText('Getting feedback. You can keep editing.')).not.toBeInTheDocument()
  await waitFor(() => expect(screen.queryByText(/Out of date/)).not.toBeInTheDocument())
})

it('offers new feedback only once the answer changes, including after reload', async () => {
  const reviewed = detail()
  reviewed.result.data.interviewQuestionSet.questions[0].feedbackAnswerRevision = 1
  const updated = detail('Changed saved answer')
  updated.result.data.interviewQuestionSet.questions[0].answerRevision = 2
  updated.result.data.interviewQuestionSet.questions[0].feedbackAnswerRevision = 1
  updated.result.data.interviewQuestionSet.questions[0].feedbackOutdated = true
  renderPage({ path: ROUTE, url: '/practice/questions/s1', element: <InterviewSetPage />, mocks: [reviewed, {
    request: { query: SAVE_INTERVIEW_ANSWER, variables: { questionSetId: 's1', questionId: 'q1', answerText: 'Changed saved answer' } },
    result: { data: { saveInterviewAnswer: { __typename: 'SaveInterviewAnswerPayload', errors: [], question: { __typename: 'InterviewQuestion', id: 'q1', answerText: 'Changed saved answer', answerRevision: 2, feedbackOutdated: true } } } },
  }, updated] })
  const textarea = await openAnswer()
  expect(screen.getByRole('button', { name: 'Get feedback' })).toBeDisabled()
  fireEvent.change(textarea, { target: { value: 'Changed saved answer' } })
  expect(screen.getByRole('button', { name: 'Get feedback' })).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(screen.getByText('Saved')).toBeInTheDocument())
  expect(screen.getByRole('button', { name: 'Get feedback' })).toBeEnabled()
})

it('saves avoidance after a retry while preserving the current question and unsaved answer', async () => {
  const request = { query: AVOID_INTERVIEW_QUESTION, variables: { questionSetId: 's1', questionId: 'q1', expectedRevision: 1 } }
  const refreshed = detail()
  refreshed.result.data.interviewQuestionSet.questions[0].avoided = true
  renderPage({ path: ROUTE, url: '/practice/questions/s1', element: <InterviewSetPage />, mocks: [detail(),
    { request, error: new Error('Connection lost') },
    { request, delay: 100, result: { data: { avoidInterviewQuestion: { __typename: 'AvoidInterviewQuestionPayload', saved: true, errors: [] } } } }, refreshed,
  ] })
  const textarea = await openAnswer()
  fireEvent.change(textarea, { target: { value: 'My unsaved answer' } })
  await chooseAction("Don't show this again")
  expect(await screen.findByText(/Could not save this preference/)).toBeVisible()
  await chooseAction("Don't show this again")
  expect(await screen.findByText('Saving preference…')).toBeVisible()
  expect(await screen.findByText("Saved. New questions won't repeat this one.")).toBeVisible()
  expect(screen.getByText('Tell me about yourself')).toBeVisible()
  expect(textarea).toHaveValue('My unsaved answer')
  expect(screen.getByText(/Unsaved changes/)).toBeVisible()
  expect(screen.getByText('Clear opening')).toBeVisible()
})

it('restores saved avoidance when opening a question set', async () => {
  const saved = detail()
  saved.result.data.interviewQuestionSet.questions[0].avoided = true
  renderPage({ path: ROUTE, url: '/practice/questions/s1', element: <InterviewSetPage />, mocks: [saved] })
  await openAnswer()
  expect(screen.getByText("Saved. New questions won't repeat this one.")).toBeVisible()
  await userEvent.setup().click(screen.getByRole('button', { name: 'Actions for question 1' }))
  expect(screen.getByRole('menuitem', { name: 'Hidden from new questions' })).toHaveAttribute('aria-disabled', 'true')
})
