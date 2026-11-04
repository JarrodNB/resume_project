/**
 * Description: Practice home tests: the question bank, its filters, generation, generation requests,
 * kept answers from replaced questions, and confirmed request dismissal.
 */
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { CAREER_LIBRARY_QUERY } from '@/features/career-library/careerLibraryOperations'
import { renderPage } from '@/test/renderPage'
import { InterviewPrepPage } from './InterviewPrepPage'
import { DELETE_INTERVIEW_QUESTION, DELETE_INTERVIEW_SET, GENERATE_INTERVIEW_SET, INTERVIEW_QUESTION_BANK_QUERY, INTERVIEW_SETS_QUERY } from './interviewPrepOperations'

/** A saved synthetic summary enables generation just as a real career library does. */
function libraryMock() {
  return { request: { query: CAREER_LIBRARY_QUERY }, result: { data: {
    me: { __typename: 'User', id: 'user', name: 'Demo', contactEmail: null, phone: null, location: null, links: [], summary: 'Built a scheduling tool.', includeSummary: true },
    experiences: [], projects: [], educations: [], certifications: [], skills: [], careerContexts: [],
  } } }
}

const SETS = {
  'set-1': { __typename: 'InterviewQuestionSet', id: 'set-1', number: 1, setType: 'GENERAL', createdAt: '2026-10-11T00:00:00Z' },
  'set-2': { __typename: 'InterviewQuestionSet', id: 'set-2', number: 2, setType: 'TECHNICAL', createdAt: '2026-10-12T00:00:00Z' },
} as const

/** Builds one bank row; set membership decides its type label. */
function bankQuestion(id: string, overrides: Record<string, unknown> = {}, setId: keyof typeof SETS = 'set-1') {
  return { __typename: 'InterviewQuestion', id, position: 1, retiredAt: null, questionText: `Question ${id}?`, answerText: '', feedback: {}, feedbackOutdated: false, latestTask: null, questionSet: SETS[setId], ...overrides }
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
  return { request: { query: INTERVIEW_SETS_QUERY }, result: { data: { interviewQuestionSets: sets } } }
}
function render(mocks: unknown[] = [], options: { bank?: unknown[]; sets?: unknown[] } = {}) {
  return renderPage({ path: '/practice/questions', url: '/practice/questions', element: <InterviewPrepPage />,
    extraRoutes: [{ path: '/practice/questions/:id/:questionId?', element: <p>Question page</p> }],
    mocks: [libraryMock(), bankMock(options.bank), setsMock(options.sets), ...mocks] as never })
}

it('lists every question with its progress and opens it directly without set labels', async () => {
  const { router } = render()
  const row = await screen.findByRole('link', { name: /Question q-tech\?/ })
  expect(row).toHaveTextContent('No feedback yet · Technical')
  expect(row).toHaveTextContent('I profiled the slow query.')
  expect(screen.queryByText(/Set \d|Question sets/)).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Delete set/ })).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: /Question q-empty\?/ })).toHaveTextContent('Not answered')
  expect(screen.getByRole('link', { name: /Question q-reviewed\?/ })).toHaveTextContent('Feedback ready')
  expect(screen.getByRole('link', { name: /Question q-outdated\?/ })).toHaveTextContent('Feedback out of date')
  fireEvent.click(row)
  await waitFor(() => expect(router.state.location.pathname).toBe('/practice/questions/set-2/q-tech'))
})

it('filters by progress and type and searches answers', async () => {
  render()
  await screen.findByRole('link', { name: /Question q-tech\?/ })
  const filters = within(screen.getByRole('group', { name: 'Show questions' }))
  expect(filters.getByRole('button', { name: /To answer/ })).toHaveTextContent('1')
  expect(filters.getByRole('button', { name: /Needs feedback/ })).toHaveTextContent('2')
  fireEvent.click(filters.getByRole('button', { name: /Feedback ready/ }))
  expect(filters.getByRole('button', { name: /Feedback ready/ })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getAllByRole('link', { name: /Question q-/ }).map((link) => link.getAttribute('href'))).toEqual(['/practice/questions/set-1/q-reviewed'])
  fireEvent.click(filters.getByRole('button', { name: /All/ }))
  fireEvent.change(screen.getByLabelText('Filter by type'), { target: { value: 'TECHNICAL' } })
  expect(screen.getAllByRole('link', { name: /Question q-/ })).toHaveLength(1)
  expect(filters.getByRole('button', { name: /To answer/ })).toHaveTextContent('0')
  fireEvent.change(screen.getByLabelText('Filter by type'), { target: { value: 'ALL' } })
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search questions and answers' }), { target: { value: 'scheduler' } })
  expect(screen.getAllByRole('link', { name: /Question q-/ }).map((link) => link.textContent)).toEqual([expect.stringContaining('q-reviewed')])
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search questions and answers' }), { target: { value: 'nothing like this' } })
  expect(screen.getByText('No questions match these filters.')).toBeInTheDocument()
})

it('opens new questions immediately after queuing generation', async () => {
  const { router } = render([{
    request: { query: GENERATE_INTERVIEW_SET, variables: { setType: 'GENERAL' } }, result: { data: { generateInterviewQuestionSet: { __typename: 'GenerateInterviewQuestionSetPayload', errors: [], aiTask: { __typename: 'AiTask', id: 'task-1', input: { question_set_id: 'set-3' } } } } },
  }])
  await waitFor(() => expect(screen.getByRole('button', { name: 'Get 5 questions' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'Get 5 questions' }))
  expect(await screen.findByText('Question page')).toBeInTheDocument()
  expect(router.state.location.pathname).toBe('/practice/questions/set-3')
})

it.each(['TECHNICAL', 'KNOWLEDGE'])('submits a deliberately selected %s type', async (setType) => {
  render([{
    request: { query: GENERATE_INTERVIEW_SET, variables: { setType } }, result: { data: { generateInterviewQuestionSet: { __typename: 'GenerateInterviewQuestionSetPayload', errors: [], aiTask: { __typename: 'AiTask', id: 'typed-task', input: { question_set_id: 'typed-set' } } } } },
  }])
  const types = within(screen.getByRole('group', { name: 'Question type' }))
  expect(types.getByRole('button', { name: 'General' })).toHaveAttribute('aria-pressed', 'true')
  const label = setType === 'TECHNICAL' ? 'Technical' : 'Knowledge'
  fireEvent.click(types.getByRole('button', { name: label }))
  expect(types.getByRole('button', { name: label })).toHaveAttribute('aria-pressed', 'true')
  await waitFor(() => expect(screen.getByRole('button', { name: 'Get 5 questions' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'Get 5 questions' }))
  expect(await screen.findByText('Question page')).toBeInTheDocument()
})

it('shows usage-limit errors and leaves the bank available', async () => {
  render([{
    request: { query: GENERATE_INTERVIEW_SET, variables: { setType: 'GENERAL' } }, result: { data: { generateInterviewQuestionSet: { __typename: 'GenerateInterviewQuestionSetPayload', errors: ['Monthly AI usage limit reached.'], aiTask: null } } },
  }])
  await waitFor(() => expect(screen.getByRole('button', { name: 'Get 5 questions' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'Get 5 questions' }))
  expect(await screen.findByText('Monthly AI usage limit reached.')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /Question q-tech\?/ })).toBeInTheDocument()
})

it('shows unfinished generation without batch navigation', async () => {
  render([], { bank: [], sets: [setRow('set-2', [], { __typename: 'AiTask', id: 'gen-1', status: 'FAILED', errorMessage: 'Add more career library details.' })] })
  expect(await screen.findByText('Add more career library details.')).toBeInTheDocument()
  expect(screen.getByText(/Technical questions/)).toBeInTheDocument()
  expect(screen.queryByRole('link', { name: /Technical questions/ })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Dismiss question generation' })).toBeEnabled()
  expect(screen.queryByText('No questions yet')).not.toBeInTheDocument()
})

it('invites first questions when there are no questions', async () => {
  render([], { bank: [], sets: [] })
  expect(await screen.findByText('No questions yet')).toBeInTheDocument()
})

it('keeps answers from replaced questions in their own read-only section', async () => {
  render([], { bank: [...defaultBank(), bankQuestion('q-old', { position: null, retiredAt: '2026-10-20T00:00:00Z', questionText: 'An older question?', answerText: 'My kept answer', feedback: { improvements: ['Add a result'] } })] })
  fireEvent.click(await screen.findByRole('button', { name: /Answers from replaced questions/ }))
  expect(screen.queryByRole('link', { name: /An older question/ })).not.toBeInTheDocument()
  fireEvent.click(screen.getByText('An older question?'))
  expect(screen.getByText('My kept answer')).toBeInTheDocument()
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
  expect(screen.getByRole('link', { name: /Question q-tech\?/ })).toBeInTheDocument()
})

it('deletes only the selected list row after confirmation and stays in the bank', async () => {
  const result = vi.fn(() => ({ data: { deleteInterviewQuestion: { __typename: 'DeleteInterviewQuestionPayload', errors: [] } } }))
  const { router } = render([{
    request: { query: DELETE_INTERVIEW_QUESTION, variables: { questionSetId: 'set-1', questionId: 'q-reviewed' } }, result,
  }])
  const remove = await screen.findByRole('button', { name: 'Delete question: Question q-reviewed?' })
  fireEvent.click(remove)
  expect(await screen.findByRole('dialog')).toHaveTextContent('Question q-reviewed?')
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(result).not.toHaveBeenCalled()
  expect(screen.getByRole('link', { name: /Question q-reviewed/ })).toBeVisible()
  fireEvent.click(remove)
  fireEvent.click(await screen.findByRole('button', { name: 'Delete question' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(screen.queryByRole('link', { name: /Question q-reviewed/ })).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: /Question q-empty/ })).toBeVisible()
  expect(screen.getByRole('button', { name: /Feedback ready/ })).toHaveTextContent('0')
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
  expect(screen.getByRole('link', { name: /Question q-tech/, hidden: true })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Delete question' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(screen.queryByRole('link', { name: /Question q-tech/ })).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: /Question q-empty/ })).toBeVisible()
})
