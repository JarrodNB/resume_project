/**
 * Description: Practice home tests: the question bank, its filters, generation, pending sets,
 * kept answers from replaced questions, and confirmed set deletion.
 */
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { CAREER_LIBRARY_QUERY } from '@/features/career-library/careerLibraryOperations'
import { renderPage } from '@/test/renderPage'
import { InterviewPrepPage } from './InterviewPrepPage'
import { DELETE_INTERVIEW_SET, GENERATE_INTERVIEW_SET, INTERVIEW_QUESTION_BANK_QUERY, INTERVIEW_SETS_QUERY } from './interviewPrepOperations'

/** A saved synthetic summary enables generation just as a real career library does. */
function libraryMock() {
  return { request: { query: CAREER_LIBRARY_QUERY }, result: { data: {
    me: { __typename: 'User', id: 'user', name: 'Demo', contactEmail: null, phone: null, location: null, links: [], summary: 'Built a scheduling tool.' },
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
    extraRoutes: [{ path: '/practice/questions/:id/:questionId?', element: <p>Set page</p> }],
    mocks: [libraryMock(), bankMock(options.bank), setsMock(options.sets), ...mocks] as never })
}

it('lists every question with its progress and opens it inside its set', async () => {
  const { router } = render()
  const row = await screen.findByRole('link', { name: /Question q-tech\?/ })
  expect(row).toHaveTextContent('No feedback yet · Technical · Set 2')
  expect(row).toHaveTextContent('I profiled the slow query.')
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

it('opens the new set immediately after queuing generation', async () => {
  const { router } = render([{
    request: { query: GENERATE_INTERVIEW_SET, variables: { setType: 'GENERAL' } }, result: { data: { generateInterviewQuestionSet: { __typename: 'GenerateInterviewQuestionSetPayload', errors: [], aiTask: { __typename: 'AiTask', id: 'task-1', input: { question_set_id: 'set-3' } } } } },
  }])
  await waitFor(() => expect(screen.getByRole('button', { name: 'Get 5 questions' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'Get 5 questions' }))
  expect(await screen.findByText('Set page')).toBeInTheDocument()
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
  expect(await screen.findByText('Set page')).toBeInTheDocument()
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

it('shows a set that is still generating above the bank, with deletion', async () => {
  render([], { bank: [], sets: [setRow('set-2', [], { __typename: 'AiTask', id: 'gen-1', status: 'FAILED', errorMessage: 'Add more career library details.' })] })
  expect(await screen.findByText('Add more career library details.')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /^Set 2 · Technical/ })).toHaveAttribute('href', '/practice/questions/set-2')
  expect(screen.getByRole('button', { name: 'Delete set 2' })).toBeEnabled()
  expect(screen.queryByText('No questions yet')).not.toBeInTheDocument()
})

it('invites a first set when there are no questions', async () => {
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

it('requires confirmation, cancels safely, and retains a set when deletion fails', async () => {
  const result = vi.fn(() => ({ data: { deleteInterviewQuestionSet: { __typename: 'DeleteInterviewQuestionSetPayload', errors: ['Please try again.'] } } }))
  render([{ request: { query: DELETE_INTERVIEW_SET, variables: { id: 'set-2' } }, result }])
  fireEvent.click(await screen.findByRole('button', { name: /Question sets/ }))
  expect(screen.getByRole('link', { name: /^Set 2 · Technical/ }).closest('li')).toHaveTextContent('1 of 1 answered')
  fireEvent.click(screen.getByRole('button', { name: 'Delete set 2' }))
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(result).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Delete set 2' }))
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
  expect(await screen.findByText('Please try again.')).toBeInTheDocument()
  await waitFor(() => expect(result).toHaveBeenCalledOnce())
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(screen.getByRole('link', { name: /^Set 2 · Technical/ })).toBeInTheDocument()
})

it('refreshes the bank and sets after confirmed deletion', async () => {
  render([{
    request: { query: DELETE_INTERVIEW_SET, variables: { id: 'set-2' } },
    result: { data: { deleteInterviewQuestionSet: { __typename: 'DeleteInterviewQuestionSetPayload', errors: [] } } },
  }, setsMock([setRow('set-1')]), bankMock(defaultBank().slice(1))])
  fireEvent.click(await screen.findByRole('button', { name: /Question sets/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Delete set 2' }))
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  await waitFor(() => expect(screen.queryByRole('link', { name: /^Set 2 ·/ })).not.toBeInTheDocument())
  expect(screen.queryByRole('link', { name: /Question q-tech\?/ })).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: /^Set 1 · General/ })).toBeInTheDocument()
})
