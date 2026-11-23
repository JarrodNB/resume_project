/**
 * Description: Practice home tests: the question bank, type groups, generation, generation requests,
 * kept answers from replaced questions, and confirmed request dismissal.
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { AI_TASK_UPDATED_SUBSCRIPTION } from '@/features/ai-tasks/aiTaskOperations'
import { CAREER_LIBRARY_QUERY } from '@/features/career-library/careerLibraryOperations'
import { normalizeAnswerDrafts } from './answerFormats'
import { renderPage } from '@/test/renderPage'
import { InterviewPrepPage } from './InterviewPrepPage'
import { DELETE_INTERVIEW_QUESTION, DELETE_INTERVIEW_SET, GENERATE_INTERVIEW_SET, INTERVIEW_QUESTION_BANK_QUERY, INTERVIEW_SETS_QUERY, INTERVIEW_SET_QUERY, SAVE_INTERVIEW_ANSWER } from './interviewPrepOperations'

/** A saved synthetic summary enables generation just as a real career library does. */
function libraryMock() {
  return { request: { query: CAREER_LIBRARY_QUERY }, result: { data: {
    me: { __typename: 'User', id: 'user', name: 'Demo', contactEmail: null, phone: null, location: null, links: [], summary: 'Built a scheduling tool.', includeSummary: true },
    experiences: [], projects: [], educations: [], certifications: [], skills: [], careerContexts: [],
  } } }
}

const SETS = {
  'set-1': { __typename: 'InterviewQuestionSet', origin: 'generated', id: 'set-1', number: 1, setType: 'FIT_MOTIVATION', createdAt: '2026-10-11T00:00:00Z' },
  'set-2': { __typename: 'InterviewQuestionSet', origin: 'generated', id: 'set-2', number: 2, setType: 'TECHNICAL', createdAt: '2026-10-12T00:00:00Z' },
} as const

/** Builds one bank row; set membership decides its type label. */
function bankQuestion(id: string, overrides: Record<string, unknown> = {}, setId: keyof typeof SETS = 'set-1') {
  return { __typename: 'InterviewQuestion', id, answerFormat: 'plain_text', answerDrafts: normalizeAnswerDrafts(undefined, typeof overrides.answerText === 'string' ? overrides.answerText : ''), position: 1, retiredAt: null, questionText: `Question ${id}?`, memoryAnchor: '', answerText: '', feedback: {}, feedbackOutdated: false, latestTask: null, questionSet: SETS[setId], ...overrides }
}
const reviewed = { answerText: 'I shipped the scheduler.', feedback: { strengths: ['Specific'] } }
function defaultBank() {
  return [
    bankQuestion('q-tech', { answerText: 'I profiled the slow query.' }, 'set-2'),
    bankQuestion('q-empty', { position: 2 }),
    bankQuestion('q-reviewed', { position: 3, ...reviewed }),
    bankQuestion('q-outdated', { position: 4, answerText: 'Edited answer', feedback: { strengths: ['Clear'] }, feedbackOutdated: true }),
  ]
}
function bankMock(questions: unknown[] = defaultBank()) {
  return { request: { query: INTERVIEW_QUESTION_BANK_QUERY }, result: { data: { interviewQuestions: questions } } }
}
/** Set list rows carry only enough question data for progress counts. */
function setRow(setId: keyof typeof SETS, questions: { id: string; answerText: string }[] = [{ id: `${setId}-only`, answerText: 'Done' }], latestTask: unknown = null) {
  return { ...SETS[setId], latestTask, questions: questions.map((question) => ({ __typename: 'InterviewQuestion', ...question })) }
}
function setsMock(sets: unknown[] = [setRow('set-2'), setRow('set-1')]) {
  return { request: { query: INTERVIEW_SETS_QUERY, INTERVIEW_SET_QUERY, SAVE_INTERVIEW_ANSWER }, result: { data: { interviewQuestionSets: sets } } }
}
function render(mocks: unknown[] = [], options: { bank?: unknown[]; sets?: unknown[] } = {}) {
  return renderPage({ path: '/practice/questions', url: '/practice/questions', element: <InterviewPrepPage />,
    extraRoutes: [{ path: '/practice/questions/:id/:questionId?', element: <p>Question page</p> }],
    mocks: [libraryMock(), bankMock(options.bank), setsMock(options.sets), ...mocks] as never })
}

function detailMock(answerText = 'I profiled the slow query.') {
  return { request: { query: INTERVIEW_SET_QUERY, variables: { id: 'set-2' } }, result: { data: { interviewQuestionSet: {
    ...SETS['set-2'], latestTask: null,
    questions: [{ ...bankQuestion('q-tech', { answerText }, 'set-2'), avoided: false, questionRevision: 1, answerRevision: 1,
      feedbackQuestionRevision: null, feedbackAnswerRevision: null }],
  } } } }
}

it('lists progress and opens the answer editor here without navigating', async () => {
  const { router } = render([detailMock()])
  const row = await screen.findByRole('button', { name: /^Question q-tech\?/ })
  expect(row).toHaveTextContent('No feedback yet · Technical')
  expect(row).toHaveTextContent('I profiled the slow query.')
  expect(screen.queryByText(/Set \d|Question sets/)).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Delete set/ })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('tab', { name: /Fit & motivation/ }))
  expect(screen.getByRole('button', { name: /^Question q-empty\?/ })).toHaveTextContent('Not answered')
  expect(screen.getByRole('button', { name: /^Question q-reviewed\?/ })).toHaveTextContent('Feedback ready')
  expect(screen.getByRole('button', { name: /^Question q-outdated\?/ })).toHaveTextContent('Feedback out of date')
  fireEvent.click(screen.getByRole('tab', { name: /Technical/ }))
  fireEvent.click(screen.getByRole('button', { name: /^Question q-tech/ }))
  expect(await screen.findByRole('textbox', { name: 'Your answer' })).toHaveValue('I profiled the slow query.')
  expect(router.state.location.pathname).toBe('/practice/questions')
})

it('shows only the selected type and searches within it', async () => {
  render()
  await screen.findByRole('button', { name: /^Question q-tech\?/ })
  const technical = screen.getByRole('tabpanel', { name: 'Technical 1' })
  expect(within(technical).getByRole('button', { name: /^Question q-tech/ })).toBeVisible()
  expect(within(technical).queryByRole('button', { name: /^Question q-reviewed/ })).not.toBeInTheDocument()
  expect(screen.queryByRole('group', { name: 'Show questions' })).not.toBeInTheDocument()
  expect(screen.queryByLabelText('Filter by type')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('tab', { name: /Fit & motivation/ }))
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'scheduler' } })
  expect(screen.getAllByRole('button', { name: /^Question q-/ })).toHaveLength(1)
  expect(screen.getByRole('button', { name: /^Question q-reviewed/ })).toBeVisible()
  expect(screen.queryByRole('tabpanel', { name: /Technical/ })).not.toBeInTheDocument()
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'nothing like this' } })
  expect(screen.getByText('No questions match your search.')).toBeVisible()
})

it.each(['FIT_MOTIVATION', 'BEHAVIORAL', 'HYPOTHETICAL', 'TECHNICAL', 'KNOWLEDGE'])('groups saved %s questions together across sets', async (setType) => {
  render([], { bank: [bankQuestion('q-first', { questionSet: { ...SETS['set-1'], setType } }),
    bankQuestion('q-second', { questionSet: { ...SETS['set-2'], setType } })] })
  await screen.findByRole('button', { name: /^Question q-first/ })
  const group = screen.getByRole('tabpanel', { name: / 2$/ })
  expect(within(group).getAllByRole('button', { name: /^Question/ })).toHaveLength(2)
})

it('stays on the bank while generating and shows all five questions on live completion', async () => {
  const task = { __typename: 'AiTask', id: 'task-1', status: 'QUEUED', taskType: 'GENERATE_INTERVIEW_QUESTIONS',
    errorMessage: null, result: null, input: {}, pendingQuestions: [], acceptedAt: null, createdAt: '2026-10-12T00:00:00Z', job: null }
  const questions = [1, 2, 3, 4, 5].map((position) => bankQuestion(`generated-${position}`, { position }))
  const { router } = render([{
    request: { query: GENERATE_INTERVIEW_SET, variables: { setType: 'FIT_MOTIVATION' } },
    result: { data: { generateInterviewQuestionSet: { __typename: 'GenerateInterviewQuestionSetPayload', errors: [], aiTask: { __typename: 'AiTask', id: 'task-1', input: { question_set_id: 'set-1' } } } } },
  }, setsMock([setRow('set-1', [], task)]), bankMock([]), {
    request: { query: AI_TASK_UPDATED_SUBSCRIPTION, variables: { id: 'task-1' } }, delay: 300,
    result: { data: { aiTaskUpdated: { ...task, status: 'COMPLETED' } } },
  }, setsMock([setRow('set-1', questions, { ...task, status: 'COMPLETED' })]), bankMock(questions)], { bank: [], sets: [] })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Get 5 questions' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'Get 5 questions' }))
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Generating questions…'))
  expect(screen.getByRole('button', { name: 'Generating questions…' })).toBeDisabled()
  expect(within(screen.getByRole('group', { name: 'Question type' })).getByRole('button', { name: 'Technical' })).toBeDisabled()
  expect(router.state.location.pathname).toBe('/practice/questions')
  await screen.findByRole('button', { name: /^Question generated-5/ })
  expect(screen.getAllByRole('button', { name: /^Question generated-/ })).toHaveLength(5)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Get 5 questions' })).toBeEnabled())
  expect(screen.queryByText('Generating questions…')).not.toBeInTheDocument()
  expect(router.state.location.pathname).toBe('/practice/questions')
})

it.each([['FIT_MOTIVATION', 'Fit & motivation'], ['BEHAVIORAL', 'Behavioral'], ['HYPOTHETICAL', 'Hypothetical'], ['TECHNICAL', 'Technical'], ['KNOWLEDGE', 'Knowledge']])('submits a deliberately selected %s type', async (setType, label) => {
  const { router } = render([{
    request: { query: GENERATE_INTERVIEW_SET, variables: { setType } }, result: { data: { generateInterviewQuestionSet: { __typename: 'GenerateInterviewQuestionSetPayload', errors: [], aiTask: { __typename: 'AiTask', id: 'typed-task', input: { question_set_id: 'typed-set' } } } } },
  }, setsMock(), bankMock()])
  const types = within(screen.getByRole('group', { name: 'Question type' }))
  expect(types.getByRole('button', { name: 'Fit & motivation' })).toHaveAttribute('aria-pressed', 'true')
  await waitFor(() => expect(types.getByRole('button', { name: label })).toBeEnabled())
  fireEvent.click(types.getByRole('button', { name: label }))
  expect(types.getByRole('button', { name: label })).toHaveAttribute('aria-pressed', 'true')
  await waitFor(() => expect(screen.getByRole('button', { name: 'Get 5 questions' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'Get 5 questions' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Get 5 questions' })).toBeEnabled())
  expect(router.state.location.pathname).toBe('/practice/questions')
})

it('shows usage-limit errors and leaves the bank available', async () => {
  render([{
    request: { query: GENERATE_INTERVIEW_SET, variables: { setType: 'FIT_MOTIVATION' } }, result: { data: { generateInterviewQuestionSet: { __typename: 'GenerateInterviewQuestionSetPayload', errors: ['Monthly AI usage limit reached.'], aiTask: null } } },
  }])
  await waitFor(() => expect(screen.getByRole('button', { name: 'Get 5 questions' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'Get 5 questions' }))
  expect(await screen.findByText('Monthly AI usage limit reached.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /^Question q-tech\?/ })).toBeInTheDocument()
})

it('restores the generation lock and status when opening a bank with queued work', async () => {
  render([{
    request: { query: AI_TASK_UPDATED_SUBSCRIPTION, variables: { id: 'queued-generation' } },
    delay: Infinity, result: { data: {} },
  }], { sets: [setRow('set-2', [], { __typename: 'AiTask', id: 'queued-generation', status: 'QUEUED', errorMessage: null })] })
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Generating questions…'))
  expect(screen.getByRole('button', { name: 'Generating questions…' })).toBeDisabled()
  expect(screen.getByRole('button', { name: /^Question q-tech/ })).toBeVisible()
})

it('shows unfinished generation without batch navigation', async () => {
  render([], { bank: [], sets: [setRow('set-2', [], { __typename: 'AiTask', id: 'gen-1', status: 'FAILED', errorMessage: 'Add more career library details.' })] })
  expect(await screen.findByText('Add more career library details.')).toBeInTheDocument()
  expect(screen.getByText(/Technical questions/)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Technical questions/ })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Dismiss question generation' })).toBeEnabled()
  expect(screen.queryByText('No questions yet')).not.toBeInTheDocument()
})

it('invites first questions when there are no questions', async () => {
  render([], { bank: [], sets: [] })
  expect(await screen.findByText('No questions yet')).toBeInTheDocument()
})

it('keeps answers from replaced questions in their own read-only section', async () => {
  render([], { bank: [...defaultBank(), bankQuestion('q-old', { position: null, retiredAt: '2026-10-20T00:00:00Z', questionText: 'An older question?', answerText: 'My kept answer', answerDrafts: { plain_text: { text: 'My kept answer' }, car: { context: 'Retained context', action: '', result: '' } }, feedback: { improvements: ['Add a result'] } })] })
  fireEvent.click(await screen.findByRole('button', { name: /Answers from replaced questions/ }))
  expect(screen.queryByRole('button', { name: /An older question/ })).not.toBeInTheDocument()
  fireEvent.click(screen.getByText('An older question?'))
  expect(screen.getByText('My kept answer')).toBeInTheDocument()
  expect(screen.getByText('Context: Retained context')).toBeInTheDocument()
  expect(screen.getByText('Add a result')).toBeInTheDocument()
  expect(screen.queryByRole('textbox', { name: /answer/i })).not.toBeInTheDocument()
})

it('cancels dismissal safely and retains a request when dismissal fails', async () => {
  const result = vi.fn(() => ({ data: { deleteInterviewQuestionSet: { __typename: 'DeleteInterviewQuestionSetPayload', errors: ['Please try again.'] } } }))
  render([{ request: { query: DELETE_INTERVIEW_SET, variables: { id: 'set-2' } }, result }], { sets: [setRow('set-2', [])] })
  fireEvent.click(await screen.findByRole('button', { name: 'Dismiss question generation' }))
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(result).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss question generation' }))
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
  expect(await screen.findByText('Please try again.')).toBeInTheDocument()
  await waitFor(() => expect(result).toHaveBeenCalledOnce())
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(screen.getByText(/Technical questions/)).toBeInTheDocument()
})

it('refreshes generation status and preserves saved questions after dismissal', async () => {
  render([{
    request: { query: DELETE_INTERVIEW_SET, variables: { id: 'set-2' } },
    result: { data: { deleteInterviewQuestionSet: { __typename: 'DeleteInterviewQuestionSetPayload', errors: [] } } },
  }, setsMock([setRow('set-1')]), bankMock()], { sets: [setRow('set-2', []), setRow('set-1')] })
  fireEvent.click(await screen.findByRole('button', { name: 'Dismiss question generation' }))
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  await waitFor(() => expect(screen.queryByRole('list', { name: 'Question generation' })).not.toBeInTheDocument())
  expect(screen.getByRole('button', { name: /^Question q-tech\?/ })).toBeInTheDocument()
})

it('deletes only the selected list row after confirmation and stays in the bank', async () => {
  const result = vi.fn(() => ({ data: { deleteInterviewQuestion: { __typename: 'DeleteInterviewQuestionPayload', errors: [] } } }))
  const { router } = render([{
    request: { query: DELETE_INTERVIEW_QUESTION, variables: { questionSetId: 'set-1', questionId: 'q-reviewed' } }, result,
  }])
  await screen.findByRole('tab', { name: /Fit & motivation/ })
  fireEvent.click(screen.getByRole('tab', { name: /Fit & motivation/ }))
  const remove = await screen.findByRole('button', { name: 'Delete question: Question q-reviewed?' })
  fireEvent.click(remove)
  expect(await screen.findByRole('dialog')).toHaveTextContent('Question q-reviewed?')
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(result).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: /^Question q-reviewed/ })).toBeVisible()
  fireEvent.click(remove)
  fireEvent.click(await screen.findByRole('button', { name: 'Delete question' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(screen.queryByRole('button', { name: /^Question q-reviewed/ })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: /^Question q-empty/ })).toBeVisible()
  expect(router.state.location.pathname).toBe('/practice/questions')
  expect(result).toHaveBeenCalledTimes(1)
})

it('keeps a list row when deletion fails and supports retry', async () => {
  const request = { query: DELETE_INTERVIEW_QUESTION, variables: { questionSetId: 'set-2', questionId: 'q-tech' } }
  render([
    { request, error: new Error('Connection lost') },
    { request, result: { data: { deleteInterviewQuestion: { __typename: 'DeleteInterviewQuestionPayload', errors: [] } } } },
  ])
  fireEvent.click(await screen.findByRole('button', { name: 'Delete question: Question q-tech?' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Delete question' }))
  expect(await screen.findByText(/Could not delete this question/)).toBeVisible()
  expect(screen.getByRole('button', { name: /^Question q-tech/, hidden: true })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Delete question' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(screen.queryByRole('button', { name: /^Question q-tech/ })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('tab', { name: /Fit & motivation/ }))
  expect(screen.getByRole('button', { name: /^Question q-empty/ })).toBeVisible()
})

it('finds questions by their saved memory anchors and shows retired cues', async () => {
  render([], { bank: [bankQuestion('q-cue', { memoryAnchor: 'Launch checklist' }), bankQuestion('q-other'),
    bankQuestion('q-retired', { memoryAnchor: 'Retired launch cue', answerText: 'Old answer', retiredAt: '2026-10-12T00:00:00Z' })] })
  fireEvent.change(await screen.findByRole('searchbox', { name: 'Search questions and answers' }), { target: { value: 'checklist' } })
  expect(screen.getByText('Question q-cue?')).toBeInTheDocument()
  expect(screen.queryByText('Question q-other?')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /Answers from replaced questions/ }))
  expect(screen.getByText('Retired launch cue')).toBeInTheDocument()
})

it('supports arrow, Home, and End navigation between type tabs', async () => {
  render()
  const technical = await screen.findByRole('tab', { name: /Technical/ })
  technical.focus()
  fireEvent.keyDown(technical, { key: 'ArrowRight' })
  expect(screen.getByRole('tab', { name: /Knowledge/ })).toHaveFocus()
  expect(screen.getByRole('tab', { name: /Knowledge/ })).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByRole('tabpanel')).toHaveTextContent('No questions of this type yet.')
  fireEvent.keyDown(screen.getByRole('tab', { name: /Knowledge/ }), { key: 'Home' })
  expect(screen.getByRole('tab', { name: /Fit & motivation/ })).toHaveFocus()
  fireEvent.keyDown(screen.getByRole('tab', { name: /Fit & motivation/ }), { key: 'End' })
  expect(screen.getByRole('tab', { name: /Knowledge/ })).toHaveFocus()
})

it('protects inline edits when switching type or leaving and saves without navigating', async () => {
  const answerText = 'I measured the query before changing its index.'
  const { router } = render([detailMock(), {
    request: { query: SAVE_INTERVIEW_ANSWER, variables: { questionSetId: 'set-2', questionId: 'q-tech', answerText, memoryAnchor: '' , answerFormat: 'plain_text', answerDrafts: normalizeAnswerDrafts(undefined, answerText) } },
    result: { data: { saveInterviewAnswer: { __typename: 'SaveInterviewAnswerPayload', errors: [], question: {
      __typename: 'InterviewQuestion', id: 'q-tech', answerText, answerFormat: 'plain_text', answerDrafts: normalizeAnswerDrafts(undefined, answerText), memoryAnchor: '', answerRevision: 2, feedbackOutdated: false,
    } } } },
  }, detailMock(answerText), bankMock(), setsMock()])
  fireEvent.click(await screen.findByRole('button', { name: /^Question q-tech/ }))
  const answer = await screen.findByRole('textbox', { name: 'Your answer' })
  fireEvent.change(answer, { target: { value: answerText } })
  fireEvent.click(screen.getByRole('tab', { name: /Fit & motivation/ }))
  expect(await screen.findByRole('dialog')).toHaveTextContent('unsaved changes')
  fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
  expect(answer).toHaveValue(answerText)
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(screen.getByText('Saved', { exact: true })).toBeVisible())
  expect(router.state.location.pathname).toBe('/practice/questions')
  fireEvent.click(screen.getByRole('tab', { name: /Fit & motivation/ }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.queryByRole('textbox', { name: 'Your answer' })).not.toBeInTheDocument()
})

it('confirms discarding inline edits on collapse and blocks page navigation', async () => {
  const { router } = render([detailMock()])
  fireEvent.click(await screen.findByRole('button', { name: /^Question q-tech/ }))
  fireEvent.change(await screen.findByRole('textbox', { name: 'Your answer' }), { target: { value: 'Unsaved draft' } })
  await act(async () => { void router.navigate('/elsewhere') })
  expect(await screen.findByRole('dialog')).toHaveTextContent('unsaved changes')
  fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
  expect(router.state.location.pathname).toBe('/practice/questions')
  fireEvent.click(screen.getByRole('button', { name: /^Question q-tech/ }))
  expect(await screen.findByRole('dialog')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }))
  expect(screen.queryByRole('textbox', { name: 'Your answer' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: /^Question q-tech/ })).toHaveAttribute('aria-expanded', 'false')
})
