/**
 * Description: Answer tests: draft preservation, feedback that saves first, navigation warnings,
 * replacement safety, billing refusals, and avoidance through the question's actions menu.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'
import { normalizeAnswerDrafts } from './answerFormats'
import { renderPage as renderRoutedPage } from '@/test/renderPage'
import { AI_TASK_UPDATED_SUBSCRIPTION } from '@/features/ai-tasks/aiTaskOperations'
import { Link } from 'react-router'
import { QuestionBankList } from './QuestionBankList'
import { useQuestionBank, useInterviewSets } from './useInterviewPrep'
import { GENERATE_INTERVIEW_MEMORY_ANCHOR, INTERVIEW_QUESTION_BANK_QUERY, INTERVIEW_SETS_QUERY, INTERVIEW_SET_QUERY, REQUEST_INTERVIEW_FEEDBACK, SAVE_INTERVIEW_ANSWER, REGENERATE_INTERVIEW_QUESTION, AVOID_INTERVIEW_QUESTION } from './interviewPrepOperations'

/** Builds a saved question with grounded feedback. */
function question(answerText = 'Saved answer', latestTask: unknown = null) {
  return { __typename: 'InterviewQuestion', id: 'q1', answerFormat: 'plain_text', answerDrafts: normalizeAnswerDrafts(undefined, answerText), position: 1, avoided: false, questionText: 'Tell me about yourself', memoryAnchor: '', answerText, answerRevision: 1, questionRevision: 1, feedbackQuestionRevision: 1, feedbackAnswerRevision: 0, feedback: { strengths: ['Clear opening'], improvements: ['Add a result'], example_answer: 'I helped [add your result].' }, feedbackOutdated: false, answered: answerText.trim() !== '', progress: latestTask ? 'REVIEWING' : 'REVIEWED', latestTask }
}
/** Provides a complete set-query response. */
function detail(answerText = 'Saved answer', latestTask: unknown = null) {
  return { request: { query: INTERVIEW_SET_QUERY, variables: { id: 's1' } }, result: { data: { interviewQuestionSet: { __typename: 'InterviewQuestionSet', origin: 'generated', id: 's1', number: 1, setType: 'FIT_MOTIVATION', createdAt: '2026-10-11T00:00:00Z', latestTask: null, questions: [question(answerText, latestTask)] } } } }
}
/** Waits for the open question's answer box. */
async function openAnswer() {
  return screen.findByRole('textbox', { name: 'Your answer' })
}
/** Picks one item from the question's actions menu. */
async function chooseAction(name: string) {
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Question actions' }))
  await user.click(screen.getByRole('menuitem', { name }))
}
const ROUTE = '/practice/questions'
/** Exercises the answer card through its real bank editor and unsaved-navigation protection. */
const bankQuestion = { ...question(), retiredAt: null, latestTask: null,
  questionSet: { id: 's1', number: 1, setType: 'FIT_MOTIVATION' as const, createdAt: '2026-10-11T00:00:00Z' } }
function AnswerBank() {
  const bank = useQuestionBank()
  useInterviewSets()
  return <><Link to="/elsewhere">Leave practice</Link>{bank.questions && <QuestionBankList createdSetId="s1" questions={bank.questions} />}</>
}
function renderPage(options: Parameters<typeof renderRoutedPage>[0]) {
  return renderRoutedPage({ ...options, mocks: [
    { request: { query: INTERVIEW_QUESTION_BANK_QUERY }, maxUsageCount: Infinity, result: { data: { interviewQuestions: [{ ...bankQuestion, __typename: 'InterviewQuestion',
      questionSet: { __typename: 'InterviewQuestionSet', ...bankQuestion.questionSet } }] } } },
    { request: { query: INTERVIEW_SETS_QUERY }, maxUsageCount: Infinity, result: { data: { interviewQuestionSets: [] } } },
    ...options.mocks ?? [],
  ] })
}

it('marks feedback out of date for a changed draft and warns before navigating away', async () => {
  const { router } = renderPage({ path: ROUTE, url: '/practice/questions', element: <AnswerBank />, mocks: [detail()], extraRoutes: [{ path: '/elsewhere', element: <p>Elsewhere</p> }] })
  fireEvent.change(await openAnswer(), { target: { value: 'My draft' } })
  expect(screen.getByText(/Out of date: this feedback is for your earlier answer/)).toBeInTheDocument()
  expect(screen.getByText('[add your result]')).toBeInTheDocument()
  expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('link', { name: 'Leave practice' }))
  expect(await screen.findByText(/unsaved changes/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
  expect(router.state.location.pathname).toBe('/practice/questions')
  expect(screen.getByRole('textbox', { name: 'Your answer' })).toHaveValue('My draft')
})

it('saves the submitted snapshot while preserving edits typed during saving', async () => {
  renderPage({ path: ROUTE, url: '/practice/questions', element: <AnswerBank />, mocks: [detail(), { request: { query: SAVE_INTERVIEW_ANSWER, variables: { questionSetId: 's1', questionId: 'q1', memoryAnchor: '', answerText: 'Submitted answer' , answerFormat: 'plain_text', answerDrafts: normalizeAnswerDrafts(undefined, 'Submitted answer') } }, delay: 100, result: { data: { saveInterviewAnswer: { __typename: 'SaveInterviewAnswerPayload', errors: [], question: { __typename: 'InterviewQuestion', id: 'q1', memoryAnchor: '', answerText: 'Submitted answer', answerFormat: 'plain_text', answerDrafts: normalizeAnswerDrafts(undefined, 'Submitted answer'), answerRevision: 2, feedbackOutdated: true, answered: true, progress: 'OUTDATED' } } } } }, detail('Submitted answer')] })
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
  renderPage({ path: ROUTE, url: '/practice/questions', element: <AnswerBank />, mocks: [reviewed] })
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
  renderPage({ path: ROUTE, url: '/practice/questions', element: <AnswerBank />, mocks: [detail(), { request: { query: SAVE_INTERVIEW_ANSWER, variables: { questionSetId: 's1', questionId: 'q1', memoryAnchor: '', answerText: 'Submitted answer' , answerFormat: 'plain_text', answerDrafts: normalizeAnswerDrafts(undefined, 'Submitted answer') } }, delay: 100, result: { data: { saveInterviewAnswer: { __typename: 'SaveInterviewAnswerPayload', errors: [], question: { __typename: 'InterviewQuestion', id: 'q1', memoryAnchor: '', answerText: 'Submitted answer', answerFormat: 'plain_text', answerDrafts: normalizeAnswerDrafts(undefined, 'Submitted answer'), answerRevision: 2, feedbackOutdated: true, answered: true, progress: 'OUTDATED' } } } } }, detail('Submitted answer')] })
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
  renderPage({ path: ROUTE, url: '/practice/questions', element: <AnswerBank />, mocks: [detail(''), {
    request: { query: REQUEST_INTERVIEW_FEEDBACK, variables: { questionSetId: 's1', questionId: 'q1', memoryAnchor: '', answerText: 'Typed for feedback' , answerFormat: 'plain_text', answerDrafts: normalizeAnswerDrafts(undefined, 'Typed for feedback') } },
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
  renderPage({ path: ROUTE, url: '/practice/questions', element: <AnswerBank />, mocks: [detail(), { request: { query: REGENERATE_INTERVIEW_QUESTION, variables: { questionSetId: 's1', questionId: 'q1', confirmed: true } }, result: { data: { regenerateInterviewQuestion: { __typename: 'RegenerateInterviewQuestionPayload', errors: ['Queue unavailable'], aiTask: null } } } }, detail()] })
  await openAnswer()
  await chooseAction('Replace question')
  expect(screen.getByRole('dialog')).toHaveTextContent('Answers from replaced questions')
  fireEvent.click(screen.getByRole('button', { name: 'Replace question' }))
  expect(await screen.findAllByText('Queue unavailable')).toHaveLength(2)
  expect(screen.getByLabelText('Your answer')).toHaveValue('Saved answer')
})

it('restores replacement progress and disables editing and conflicting controls', async () => {
  renderPage({ path: ROUTE, url: '/practice/questions', element: <AnswerBank />, mocks: [detail('Saved answer', { __typename: 'AiTask', id: 't1', status: 'QUEUED', taskType: 'REGENERATE_INTERVIEW_QUESTION', errorMessage: null }), { request: { query: AI_TASK_UPDATED_SUBSCRIPTION, variables: { id: 't1' } }, delay: Infinity, result: { data: {} } }] })
  expect(await openAnswer()).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Get feedback' })).toBeDisabled()
  await userEvent.setup().click(screen.getByRole('button', { name: 'Question actions' }))
  expect(screen.getByRole('menuitem', { name: 'Replace question' })).toHaveAttribute('aria-disabled', 'true')
})

it('keeps replacement editing locked until the new question revision loads', async () => {
  const task = { __typename: 'AiTask', id: 't1', status: 'QUEUED', taskType: 'REGENERATE_INTERVIEW_QUESTION', errorMessage: null }
  const replacement = detail('')
  replacement.result.data.interviewQuestionSet.questions[0].questionRevision = 2
  replacement.result.data.interviewQuestionSet.questions[0].questionText = 'New replacement question'
  renderPage({ path: ROUTE, url: '/practice/questions', element: <AnswerBank />, mocks: [detail('Saved answer', task), {
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
  renderPage({ path: ROUTE, url: '/practice/questions', element: <AnswerBank />, mocks: [detail('Saved answer', replacementTask), {
    request: { query: AI_TASK_UPDATED_SUBSCRIPTION, variables: { id: 't1' } }, delay: 100,
    result: { data: { aiTaskUpdated: { ...failedTask, result: null, input: {}, pendingQuestions: [], acceptedAt: null, createdAt: '2026-10-11T00:00:00Z', job: null } } },
  }, detail('Saved answer', failedTask), {
    request: { query: REQUEST_INTERVIEW_FEEDBACK, variables: { questionSetId: 's1', questionId: 'q1', memoryAnchor: '', answerText: 'Saved answer' , answerFormat: 'plain_text', answerDrafts: normalizeAnswerDrafts(undefined, 'Saved answer') } },
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
  outdatedDetail.result.data.interviewQuestionSet.questions[0].progress = 'OUTDATED'
  renderPage({ path: ROUTE, url: '/practice/questions', element: <AnswerBank />, mocks: [outdatedDetail, {
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
  updated.result.data.interviewQuestionSet.questions[0].progress = 'OUTDATED'
  renderPage({ path: ROUTE, url: '/practice/questions', element: <AnswerBank />, mocks: [reviewed, {
    request: { query: SAVE_INTERVIEW_ANSWER, variables: { questionSetId: 's1', questionId: 'q1', memoryAnchor: '', answerText: 'Changed saved answer' , answerFormat: 'plain_text', answerDrafts: normalizeAnswerDrafts(undefined, 'Changed saved answer') } },
    result: { data: { saveInterviewAnswer: { __typename: 'SaveInterviewAnswerPayload', errors: [], question: { __typename: 'InterviewQuestion', id: 'q1', memoryAnchor: '', answerText: 'Changed saved answer', answerFormat: 'plain_text', answerDrafts: normalizeAnswerDrafts(undefined, 'Changed saved answer'), answerRevision: 2, feedbackOutdated: true, answered: true, progress: 'OUTDATED' } } } },
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
  renderPage({ path: ROUTE, url: '/practice/questions', element: <AnswerBank />, mocks: [detail(),
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
  expect(screen.getByRole('heading', { name: 'Tell me about yourself' })).toBeVisible()
  expect(textarea).toHaveValue('My unsaved answer')
  expect(screen.getByText(/Unsaved changes/)).toBeVisible()
  expect(screen.getByText('Clear opening')).toBeVisible()
})

it('restores saved avoidance when opening a question set', async () => {
  const saved = detail()
  saved.result.data.interviewQuestionSet.questions[0].avoided = true
  renderPage({ path: ROUTE, url: '/practice/questions', element: <AnswerBank />, mocks: [saved] })
  await openAnswer()
  expect(screen.getByText("Saved. New questions won't repeat this one.")).toBeVisible()
  await userEvent.setup().click(screen.getByRole('button', { name: 'Question actions' }))
  expect(screen.getByRole('menuitem', { name: 'Hidden from new questions' })).toHaveAttribute('aria-disabled', 'true')
})

it('keeps cue-only edits dirty without making feedback outdated', async () => {
  const reviewed = detail()
  reviewed.result.data.interviewQuestionSet.questions[0].feedbackAnswerRevision = 1
  renderPage({ path: ROUTE, url: '/practice/questions', element: <AnswerBank />, mocks: [reviewed] })
  await openAnswer()
  const cue = screen.getByRole('textbox', { name: 'Memory anchor' })
  expect(cue).toHaveAttribute('maxLength', '600')
  fireEvent.change(cue, { target: { value: 'Launch: listen then plan' } })
  expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  expect(screen.getByRole('button', { name: 'Get feedback' })).toBeDisabled()
  expect(screen.queryByText(/Out of date/)).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('link', { name: 'Leave practice' }))
  expect(await screen.findByText(/unsaved changes/)).toBeInTheDocument()
})

it('saves answer and cue together while preserving newer edits to both during saving', async () => {
  const saved = detail('Submitted answer')
  saved.result.data.interviewQuestionSet.questions[0].memoryAnchor = 'Submitted cue'
  renderPage({ path: ROUTE, url: '/practice/questions', element: <AnswerBank />, mocks: [detail(), {
    request: { query: SAVE_INTERVIEW_ANSWER, variables: { questionSetId: 's1', questionId: 'q1', answerText: 'Submitted answer', memoryAnchor: 'Submitted cue' , answerFormat: 'plain_text', answerDrafts: normalizeAnswerDrafts(undefined, 'Submitted answer') } }, delay: 100,
    result: { data: { saveInterviewAnswer: { __typename: 'SaveInterviewAnswerPayload', errors: [], question: { __typename: 'InterviewQuestion', id: 'q1', answerText: 'Submitted answer', answerFormat: 'plain_text', answerDrafts: normalizeAnswerDrafts(undefined, 'Submitted answer'), memoryAnchor: 'Submitted cue', answerRevision: 2, feedbackOutdated: true, answered: true, progress: 'OUTDATED' } } } },
  }, saved] })
  const answer = await openAnswer()
  const cue = screen.getByRole('textbox', { name: 'Memory anchor' })
  fireEvent.change(answer, { target: { value: 'Submitted answer' } })
  fireEvent.change(cue, { target: { value: 'Submitted cue' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(await screen.findByText('Saving…')).toBeInTheDocument()
  fireEvent.change(answer, { target: { value: 'Newer answer' } })
  fireEvent.change(cue, { target: { value: 'Newer cue' } })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled())
  expect(answer).toHaveValue('Newer answer')
  expect(cue).toHaveValue('Newer cue')
  expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
})

it('refreshes both saved drafts after feedback failure while preserving newer cue edits', async () => {
  const saved = detail('Submitted answer')
  saved.result.data.interviewQuestionSet.questions[0].memoryAnchor = 'Submitted cue'
  renderPage({ path: ROUTE, url: '/practice/questions', element: <AnswerBank />, mocks: [detail(), {
    request: { query: REQUEST_INTERVIEW_FEEDBACK, variables: { questionSetId: 's1', questionId: 'q1', answerText: 'Submitted answer', memoryAnchor: 'Submitted cue' , answerFormat: 'plain_text', answerDrafts: normalizeAnswerDrafts(undefined, 'Submitted answer') } }, delay: 100,
    result: { data: { requestInterviewAnswerFeedback: { __typename: 'RequestInterviewAnswerFeedbackPayload', errors: ['Monthly allowance exhausted'], aiTask: null } } },
  }, saved] })
  const answer = await openAnswer()
  const cue = screen.getByRole('textbox', { name: 'Memory anchor' })
  fireEvent.change(answer, { target: { value: 'Submitted answer' } })
  fireEvent.change(cue, { target: { value: 'Submitted cue' } })
  fireEvent.click(screen.getByRole('button', { name: 'Get feedback' }))
  expect(await screen.findByText('Saving and sending for feedback…')).toBeInTheDocument()
  fireEvent.change(cue, { target: { value: 'Newer cue' } })
  expect(await screen.findByText('Monthly allowance exhausted')).toBeInTheDocument()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled())
  // The saved-detail refetch can land after the button re-enables when tests run in parallel.
  await waitFor(() => expect(answer).toHaveValue('Submitted answer'))
  expect(cue).toHaveValue('Newer cue')
  expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
})

it('reminds the user to check a retained cue after editing the answer', async () => {
  const saved = detail()
  saved.result.data.interviewQuestionSet.questions[0].memoryAnchor = 'My existing cue'
  renderPage({ path: ROUTE, url: '/practice/questions', element: <AnswerBank />, mocks: [saved] })
  fireEvent.change(await openAnswer(), { target: { value: 'Changed answer' } })
  expect(screen.getByRole('textbox', { name: 'Memory anchor' })).toHaveValue('My existing cue')
  expect(screen.getByText(/Check that your memory anchor still fits/)).toBeInTheDocument()
})

it('generates an editable anchor while keeping newer local anchor edits', async () => {
  const pending = { __typename: 'AiTask', id: 'anchor-task', status: 'QUEUED', taskType: 'GENERATE_INTERVIEW_MEMORY_ANCHOR', errorMessage: null }
  renderPage({ path: ROUTE, url: '/practice/questions', element: <AnswerBank />, mocks: [detail(), {
    request: { query: GENERATE_INTERVIEW_MEMORY_ANCHOR, variables: { questionSetId: 's1', questionId: 'q1', answerText: 'Saved answer', memoryAnchor: '' , answerFormat: 'plain_text', answerDrafts: normalizeAnswerDrafts(undefined, 'Saved answer') } }, delay: 50,
    result: { data: { generateInterviewMemoryAnchor: { __typename: 'GenerateInterviewMemoryAnchorPayload', errors: [], aiTask: pending } } },
  }, detail('Saved answer', pending), { request: { query: AI_TASK_UPDATED_SUBSCRIPTION, variables: { id: 'anchor-task' } }, delay: Infinity, result: { data: {} } }] })
  await openAnswer()
  fireEvent.click(screen.getByRole('button', { name: 'Generate anchor' }))
  expect(await screen.findByRole('button', { name: 'Generating anchor…' })).toBeDisabled()
  const anchor = screen.getByRole('textbox', { name: 'Memory anchor' })
  fireEvent.change(anchor, { target: { value: 'My own newer cue' } })
  await waitFor(() => expect(screen.getByText('Generating memory anchor. You can keep editing.')).toBeVisible())
  expect(anchor).toHaveValue('My own newer cue')
  expect(screen.getByRole('button', { name: 'Get feedback' })).toBeDisabled()
})

it('restores pending anchor generation and allows retry after failure', async () => {
  const failed = { __typename: 'AiTask', id: 'anchor-task', status: 'FAILED', taskType: 'GENERATE_INTERVIEW_MEMORY_ANCHOR', errorMessage: 'Please try again' }
  renderPage({ path: ROUTE, url: '/practice/questions', element: <AnswerBank />, mocks: [detail('Saved answer', failed)] })
  await openAnswer()
  expect(screen.getByText('Memory anchor generation failed')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Generate anchor' })).toBeEnabled()
  expect(screen.getByRole('textbox', { name: 'Memory anchor' })).toBeEnabled()
})


it('loads a completed generated anchor and leaves it editable', async () => {
  const queued = { __typename: 'AiTask', id: 'anchor-done', status: 'QUEUED', taskType: 'GENERATE_INTERVIEW_MEMORY_ANCHOR', errorMessage: null }
  const completed = { ...queued, status: 'COMPLETED' }
  const refreshed = detail('Saved answer', completed)
  refreshed.result.data.interviewQuestionSet.questions[0].memoryAnchor = 'C: slow process → A★: simplified → R★: faster'
  renderPage({ path: ROUTE, url: '/practice/questions', element: <AnswerBank />, mocks: [detail('Saved answer', queued), {
    request: { query: AI_TASK_UPDATED_SUBSCRIPTION, variables: { id: 'anchor-done' } }, delay: 100,
    result: { data: { aiTaskUpdated: { ...completed, result: null, input: {}, pendingQuestions: [], acceptedAt: null, createdAt: '2026-10-11T00:00:00Z', job: null } } },
  }, refreshed] })
  await openAnswer()
  const anchor = screen.getByRole('textbox', { name: 'Memory anchor' })
  await waitFor(() => expect(anchor).toHaveValue('C: slow process → A★: simplified → R★: faster'))
  fireEvent.change(anchor, { target: { value: 'My preferred cue' } })
  expect(anchor).toHaveValue('My preferred cue')
  expect(screen.getByRole('button', { name: 'Regenerate anchor' })).toBeEnabled()
  expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
})

it('keeps independent drafts when switching formats and explains the selected story fields', async () => {
  renderPage({ path: ROUTE, url: '/practice/questions', element: <AnswerBank />, mocks: [detail()] })
  fireEvent.change(await openAnswer(), { target: { value: 'My plain draft' } })
  fireEvent.change(screen.getByRole('combobox', { name: 'Answer format' }), { target: { value: 'carl' } })
  expect(screen.getByText(/add what you learned/)).toBeInTheDocument()
  fireEvent.change(screen.getByRole('textbox', { name: 'Context' }), { target: { value: 'My context' } })
  fireEvent.change(screen.getByRole('combobox', { name: 'Answer format' }), { target: { value: 'star' } })
  expect(screen.getByRole('textbox', { name: 'Situation' })).toHaveValue('')
  fireEvent.change(screen.getByRole('combobox', { name: 'Answer format' }), { target: { value: 'carl' } })
  expect(screen.getByRole('textbox', { name: 'Context' })).toHaveValue('My context')
  fireEvent.change(screen.getByRole('combobox', { name: 'Answer format' }), { target: { value: 'plain_text' } })
  expect(await openAnswer()).toHaveValue('My plain draft')
  expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
})

it('saves every format draft with the active selection and keeps inactive edits out of feedback currentness', async () => {
  const drafts = normalizeAnswerDrafts(undefined, 'Saved answer')
  drafts.car.context = 'Existing context'
  const reviewed = detail()
  Object.assign(reviewed.result.data.interviewQuestionSet.questions[0], { answerFormat: 'plain_text', answerDrafts: drafts, feedbackAnswerRevision: 1 })
  const changed = { ...drafts, car: { ...drafts.car, context: 'Edited context' } }
  const saved = detail()
  Object.assign(saved.result.data.interviewQuestionSet.questions[0], { answerFormat: 'plain_text', answerDrafts: changed, feedbackAnswerRevision: 1 })
  renderPage({ path: ROUTE, url: '/practice/questions', element: <AnswerBank />, mocks: [reviewed, {
    request: { query: SAVE_INTERVIEW_ANSWER, variables: { questionSetId: 's1', questionId: 'q1', answerText: 'Saved answer', memoryAnchor: '', answerFormat: 'plain_text', answerDrafts: changed } },
    result: { data: { saveInterviewAnswer: { __typename: 'SaveInterviewAnswerPayload', errors: [], question: { __typename: 'InterviewQuestion', id: 'q1', answerText: 'Saved answer', answerFormat: 'plain_text', answerDrafts: changed, memoryAnchor: '', answerRevision: 1, feedbackOutdated: false, answered: true, progress: 'REVIEWED' } } } },
  }, saved] })
  await openAnswer()
  fireEvent.change(screen.getByRole('combobox', { name: 'Answer format' }), { target: { value: 'car' } })
  expect(screen.getByText(/Out of date: this feedback/)).toBeInTheDocument()
  fireEvent.change(screen.getByRole('textbox', { name: 'Context' }), { target: { value: 'Edited context' } })
  fireEvent.change(screen.getByRole('combobox', { name: 'Answer format' }), { target: { value: 'plain_text' } })
  expect(screen.queryByText(/Out of date: this feedback/)).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Get feedback' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(screen.getByText('Saved')).toBeInTheDocument())
  fireEvent.change(screen.getByRole('combobox', { name: 'Answer format' }), { target: { value: 'car' } })
  expect(screen.getByRole('textbox', { name: 'Context' })).toHaveValue('Edited context')
})

it('identifies an oversized inactive draft before saving any formats', async () => {
  renderPage({ path: ROUTE, url: '/practice/questions', element: <AnswerBank />, mocks: [detail()] })
  await openAnswer()
  fireEvent.change(screen.getByRole('combobox', { name: 'Answer format' }), { target: { value: 'car' } })
  fireEvent.change(screen.getByRole('textbox', { name: 'Context' }), { target: { value: 'x'.repeat(2000) } })
  fireEvent.change(screen.getByRole('combobox', { name: 'Answer format' }), { target: { value: 'plain_text' } })
  expect(screen.getByRole('alert')).toHaveTextContent('Shorten CAR')
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
})

it('links to billing when memory anchor generation refuses an expired plan', async () => {
  renderPage({ path: ROUTE, url: '/practice/questions', element: <AnswerBank />, mocks: [detail(), {
    request: { query: GENERATE_INTERVIEW_MEMORY_ANCHOR, variables: { questionSetId: 's1', questionId: 'q1', answerText: 'Saved answer', memoryAnchor: '', answerFormat: 'plain_text', answerDrafts: normalizeAnswerDrafts(undefined, 'Saved answer') } },
    result: { data: { generateInterviewMemoryAnchor: { __typename: 'GenerateInterviewMemoryAnchorPayload', errors: ['Subscribe to continue.'], errorCode: 'PLAN_ENDED', aiTask: null } } },
  }, detail()] })
  await openAnswer()
  fireEvent.click(screen.getByRole('button', { name: 'Generate anchor' }))
  expect(await screen.findByRole('link', { name: 'Plan & billing' })).toHaveAttribute('href', '/account/billing')
  expect(screen.getByRole('textbox', { name: 'Your answer' })).toHaveValue('Saved answer')
})
