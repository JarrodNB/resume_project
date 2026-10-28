/**
 * Description: Interview set list, generation allowance errors, and confirmed deletion tests.
 * Index: listMock, setFixture
 */
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { CAREER_LIBRARY_QUERY } from '@/features/career-library/careerLibraryOperations'
import { renderPage } from '@/test/renderPage'
import { InterviewPrepPage } from './InterviewPrepPage'
import { DELETE_INTERVIEW_SET, GENERATE_INTERVIEW_SET, INTERVIEW_SETS_QUERY } from './interviewPrepOperations'

/** A saved synthetic summary enables generation just as a real career library does. */
function libraryMock() {
  return { request: { query: CAREER_LIBRARY_QUERY }, result: { data: {
    me: { __typename: 'User', id: 'user', name: 'Demo', contactEmail: null, phone: null, location: null, links: [], summary: 'Built a scheduling tool.' },
    experiences: [], projects: [], educations: [], certifications: [], skills: [], libraryFacts: [],
  } } }
}

/** Builds a persistent set fixture. */
function setFixture(number: number) {
  return { __typename: 'InterviewQuestionSet', id: `set-${number}`, number, setType: number === 2 ? 'TECHNICAL' : 'GENERAL', createdAt: '2026-10-11T00:00:00Z', latestTask: null }
}
/** Returns a list response with a reusable result for mutation refetches. */
function listMock(sets = [setFixture(1), setFixture(2)]) {
  return { request: { query: INTERVIEW_SETS_QUERY }, result: { data: { interviewQuestionSets: sets } } }
}

it('orders saved numbered sets newest first with detail links', async () => {
  renderPage({ path: '/practice/questions', url: '/practice/questions', element: <InterviewPrepPage />, mocks: [libraryMock(), listMock()] })
  const newest = await screen.findByRole('link', { name: /Set 2/ })
  expect(newest).toHaveAttribute('href', '/practice/questions/set-2')
  expect(newest).toHaveTextContent('Technical')
  expect(screen.getByRole('link', { name: /Set 1/ })).toHaveTextContent('General')
  expect(screen.getAllByRole('link').map((link) => link.textContent)).toEqual([expect.stringContaining('Set 2'), expect.stringContaining('Set 1')])
})

it('opens the persistent set immediately after queuing generation', async () => {
  const { router } = renderPage({ path: '/practice/questions', url: '/practice/questions', element: <InterviewPrepPage />, extraRoutes: [{ path: '/practice/questions/:id', element: <p>Queued set</p> }], mocks: [libraryMock(), listMock([]), {
    request: { query: GENERATE_INTERVIEW_SET, variables: { setType: 'GENERAL' } }, result: { data: { generateInterviewQuestionSet: { __typename: 'GenerateInterviewQuestionSetPayload', errors: [], aiTask: { __typename: 'AiTask', id: 'task-1', input: { question_set_id: 'set-3' } } } } },
  }] })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Generate questions' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'Generate questions' }))
  expect(await screen.findByText('Queued set')).toBeInTheDocument()
  expect(router.state.location.pathname).toBe('/practice/questions/set-3')
})

it('shows usage-limit errors and leaves the saved list available', async () => {
  renderPage({ path: '/practice/questions', url: '/practice/questions', element: <InterviewPrepPage />, mocks: [libraryMock(), listMock(), {
    request: { query: GENERATE_INTERVIEW_SET, variables: { setType: 'GENERAL' } }, result: { data: { generateInterviewQuestionSet: { __typename: 'GenerateInterviewQuestionSetPayload', errors: ['Monthly AI usage limit reached.'], aiTask: null } } },
  }] })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Generate questions' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'Generate questions' }))
  expect(await screen.findByText('Monthly AI usage limit reached.')).toBeInTheDocument()
  expect(await screen.findByRole('link', { name: /Set 2/ })).toBeInTheDocument()
})

it('deliberately selects technical practice and submits that type', async () => {
  renderPage({ path: '/practice/questions', url: '/practice/questions', element: <InterviewPrepPage />, extraRoutes: [{ path: '/practice/questions/:id', element: <p>Technical set queued</p> }], mocks: [libraryMock(), listMock([]), {
    request: { query: GENERATE_INTERVIEW_SET, variables: { setType: 'TECHNICAL' } }, result: { data: { generateInterviewQuestionSet: { __typename: 'GenerateInterviewQuestionSetPayload', errors: [], aiTask: { __typename: 'AiTask', id: 'technical-task', input: { question_set_id: 'technical-set', set_type: 'technical' } } } } },
  }] })
  expect(screen.getByRole('radio', { name: 'General' })).toBeChecked()
  fireEvent.click(screen.getByRole('radio', { name: 'Technical' }))
  expect(screen.getByRole('radio', { name: 'Technical' })).toBeChecked()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Generate questions' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'Generate questions' }))
  expect(await screen.findByText('Technical set queued')).toBeInTheDocument()
})

it('selects knowledge practice and submits its persisted scope', async () => {
  renderPage({ path: '/practice/questions', url: '/practice/questions', element: <InterviewPrepPage />, extraRoutes: [{ path: '/practice/questions/:id', element: <p>Knowledge set queued</p> }], mocks: [libraryMock(), listMock([]), {
    request: { query: GENERATE_INTERVIEW_SET, variables: { setType: 'KNOWLEDGE' } }, result: { data: { generateInterviewQuestionSet: { __typename: 'GenerateInterviewQuestionSetPayload', errors: [], aiTask: { __typename: 'AiTask', id: 'knowledge-task', input: { question_set_id: 'knowledge-set', set_type: 'knowledge' } } } } },
  }] })
  fireEvent.click(screen.getByRole('radio', { name: 'Knowledge' }))
  expect(screen.getByRole('radio', { name: 'Knowledge' })).toBeChecked()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Generate questions' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'Generate questions' }))
  expect(await screen.findByText('Knowledge set queued')).toBeInTheDocument()
})

it('labels reloaded knowledge sets independently of the generation selector', async () => {
  renderPage({ path: '/practice/questions', url: '/practice/questions', element: <InterviewPrepPage />, mocks: [libraryMock(), listMock([{ ...setFixture(3), setType: 'KNOWLEDGE' }])] })
  expect(await screen.findByRole('link', { name: /Set 3 · Knowledge/ })).toHaveAttribute('href', '/practice/questions/set-3')
  expect(screen.getByRole('radio', { name: 'General' })).toBeChecked()
})

it('requires confirmation, cancels safely, and retains a set when deletion fails', async () => {
  const result = vi.fn(() => ({ data: { deleteInterviewQuestionSet: { __typename: 'DeleteInterviewQuestionSetPayload', errors: ['Please try again.'] } } }))
  renderPage({ path: '/practice/questions', url: '/practice/questions', element: <InterviewPrepPage />, mocks: [libraryMock(), listMock(), { request: { query: DELETE_INTERVIEW_SET, variables: { id: 'set-2' } }, result }] })
  fireEvent.click(await screen.findByRole('button', { name: 'Delete set 2' }))
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(result).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Delete set 2' }))
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
  expect(await screen.findByText('Please try again.')).toBeInTheDocument()
  await waitFor(() => expect(result).toHaveBeenCalledOnce())
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(screen.getByRole('link', { name: /Set 2/ })).toBeInTheDocument()
})

it('removes a set from the persistent list after confirmed deletion succeeds', async () => {
  renderPage({ path: '/practice/questions', url: '/practice/questions', element: <InterviewPrepPage />, mocks: [libraryMock(), listMock(), {
    request: { query: DELETE_INTERVIEW_SET, variables: { id: 'set-2' } },
    result: { data: { deleteInterviewQuestionSet: { __typename: 'DeleteInterviewQuestionSetPayload', errors: [] } } },
  }, listMock([setFixture(1)])] })
  fireEvent.click(await screen.findByRole('button', { name: 'Delete set 2' }))
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
  await waitFor(() => expect(screen.queryByText(/Set 2 ·/)).not.toBeInTheDocument())
  expect(screen.getByRole('link', { name: /Set 1/ })).toBeInTheDocument()
})
