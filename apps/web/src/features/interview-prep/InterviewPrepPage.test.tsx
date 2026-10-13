/**
 * Description: Interview set list, generation allowance errors, and confirmed deletion tests.
 * Index: listMock, setFixture
 */
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { renderPage } from '@/test/renderPage'
import { InterviewPrepPage } from './InterviewPrepPage'
import { DELETE_INTERVIEW_SET, GENERATE_INTERVIEW_SET, INTERVIEW_SETS_QUERY } from './interviewPrepOperations'

/** Builds a persistent set fixture. */
function setFixture(number: number) {
  return { __typename: 'InterviewQuestionSet', id: `set-${number}`, number, setType: 'GENERAL', createdAt: '2026-10-11T00:00:00Z', latestTask: null }
}
/** Returns a list response with a reusable result for mutation refetches. */
function listMock(sets = [setFixture(1), setFixture(2)]) {
  return { request: { query: INTERVIEW_SETS_QUERY }, result: { data: { interviewQuestionSets: sets } } }
}

it('orders saved numbered sets newest first with detail links', async () => {
  renderPage({ path: '/interview-prep', url: '/interview-prep', element: <InterviewPrepPage />, mocks: [listMock()] })
  const newest = await screen.findByRole('link', { name: /Set 2/ })
  expect(newest).toHaveAttribute('href', '/interview-prep/set-2')
  expect(newest).toHaveTextContent('General')
  expect(screen.getByRole('link', { name: /Set 1/ })).toHaveTextContent('General')
  expect(screen.getAllByRole('link').map((link) => link.textContent)).toEqual([expect.stringContaining('Set 2'), expect.stringContaining('Set 1')])
})

it('opens the persistent set immediately after queuing generation', async () => {
  const { router } = renderPage({ path: '/interview-prep', url: '/interview-prep', element: <InterviewPrepPage />, extraRoutes: [{ path: '/interview-prep/:id', element: <p>Queued set</p> }], mocks: [listMock([]), {
    request: { query: GENERATE_INTERVIEW_SET, variables: { setType: 'GENERAL' } }, result: { data: { generateInterviewQuestionSet: { __typename: 'GenerateInterviewQuestionSetPayload', errors: [], aiTask: { __typename: 'AiTask', id: 'task-1', input: { question_set_id: 'set-3' } } } } },
  }] })
  fireEvent.click(screen.getByRole('button', { name: 'Generate questions' }))
  expect(await screen.findByText('Queued set')).toBeInTheDocument()
  expect(router.state.location.pathname).toBe('/interview-prep/set-3')
})

it('shows usage-limit errors and leaves the saved list available', async () => {
  renderPage({ path: '/interview-prep', url: '/interview-prep', element: <InterviewPrepPage />, mocks: [listMock(), {
    request: { query: GENERATE_INTERVIEW_SET, variables: { setType: 'GENERAL' } }, result: { data: { generateInterviewQuestionSet: { __typename: 'GenerateInterviewQuestionSetPayload', errors: ['Monthly AI usage limit reached.'], aiTask: null } } },
  }] })
  fireEvent.click(screen.getByRole('button', { name: 'Generate questions' }))
  expect(await screen.findByText('Monthly AI usage limit reached.')).toBeInTheDocument()
  expect(await screen.findByRole('link', { name: /Set 2/ })).toBeInTheDocument()
})

it('deliberately selects technical practice and submits that type', async () => {
  renderPage({ path: '/interview-prep', url: '/interview-prep', element: <InterviewPrepPage />, extraRoutes: [{ path: '/interview-prep/:id', element: <p>Technical set queued</p> }], mocks: [listMock([]), {
    request: { query: GENERATE_INTERVIEW_SET, variables: { setType: 'TECHNICAL' } }, result: { data: { generateInterviewQuestionSet: { __typename: 'GenerateInterviewQuestionSetPayload', errors: [], aiTask: { __typename: 'AiTask', id: 'technical-task', input: { question_set_id: 'technical-set', set_type: 'technical' } } } } },
  }] })
  expect(screen.getByRole('tab', { name: 'General' })).toHaveAttribute('aria-selected', 'true')
  await userEvent.click(screen.getByRole('tab', { name: 'Technical' }))
  expect(screen.getByRole('tab', { name: 'Technical' })).toHaveAttribute('aria-selected', 'true')
  fireEvent.click(screen.getByRole('button', { name: 'Generate questions' }))
  expect(await screen.findByText('Technical set queued')).toBeInTheDocument()
})

it('selects knowledge practice and submits its persisted scope', async () => {
  renderPage({ path: '/interview-prep', url: '/interview-prep', element: <InterviewPrepPage />, extraRoutes: [{ path: '/interview-prep/:id', element: <p>Knowledge set queued</p> }], mocks: [listMock([]), {
    request: { query: GENERATE_INTERVIEW_SET, variables: { setType: 'KNOWLEDGE' } }, result: { data: { generateInterviewQuestionSet: { __typename: 'GenerateInterviewQuestionSetPayload', errors: [], aiTask: { __typename: 'AiTask', id: 'knowledge-task', input: { question_set_id: 'knowledge-set', set_type: 'knowledge' } } } } },
  }] })
  await userEvent.click(screen.getByRole('tab', { name: 'Knowledge' }))
  expect(screen.getByRole('tab', { name: 'Knowledge' })).toHaveAttribute('aria-selected', 'true')
  fireEvent.click(screen.getByRole('button', { name: 'Generate questions' }))
  expect(await screen.findByText('Knowledge set queued')).toBeInTheDocument()
})

it('labels reloaded knowledge sets independently of the generation selector', async () => {
  renderPage({ path: '/interview-prep', url: '/interview-prep', element: <InterviewPrepPage />, mocks: [listMock([{ ...setFixture(3), setType: 'KNOWLEDGE' }])] })
  expect(screen.getByRole('tab', { name: 'General' })).toHaveAttribute('aria-selected', 'true')
  await userEvent.click(screen.getByRole('tab', { name: 'Knowledge' }))
  expect(await screen.findByRole('link', { name: /Set 3 · Knowledge/ })).toHaveAttribute('href', '/interview-prep/set-3')
  expect(screen.getByRole('tab', { name: 'Knowledge' })).toHaveAttribute('aria-selected', 'true')
})

it('requires confirmation, cancels safely, and retains a set when deletion fails', async () => {
  const result = vi.fn(() => ({ data: { deleteInterviewQuestionSet: { __typename: 'DeleteInterviewQuestionSetPayload', errors: ['Please try again.'] } } }))
  renderPage({ path: '/interview-prep', url: '/interview-prep', element: <InterviewPrepPage />, mocks: [listMock(), { request: { query: DELETE_INTERVIEW_SET, variables: { id: 'set-2' } }, result }] })
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
  renderPage({ path: '/interview-prep', url: '/interview-prep', element: <InterviewPrepPage />, mocks: [listMock(), {
    request: { query: DELETE_INTERVIEW_SET, variables: { id: 'set-2' } },
    result: { data: { deleteInterviewQuestionSet: { __typename: 'DeleteInterviewQuestionSetPayload', errors: [] } } },
  }, listMock([setFixture(1)])] })
  fireEvent.click(await screen.findByRole('button', { name: 'Delete set 2' }))
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
  await waitFor(() => expect(screen.queryByText(/Set 2 ·/)).not.toBeInTheDocument())
  expect(screen.getByRole('link', { name: /Set 1/ })).toBeInTheDocument()
})


it('groups saved sets into their question type tabs', async () => {
  renderPage({ path: '/interview-prep', url: '/interview-prep', element: <InterviewPrepPage />, mocks: [listMock([
    setFixture(1), { ...setFixture(2), setType: 'TECHNICAL' }, { ...setFixture(3), setType: 'KNOWLEDGE' },
  ])] })
  expect(await screen.findByRole('link', { name: /Set 1/ })).toBeInTheDocument()
  expect(screen.queryByRole('link', { name: /Set 2/ })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('tab', { name: 'Technical' }))
  expect(screen.getByRole('link', { name: /Set 2/ })).toBeInTheDocument()
  expect(screen.queryByRole('link', { name: /Set 1/ })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('tab', { name: 'Knowledge' }))
  expect(screen.getByRole('link', { name: /Set 3/ })).toBeInTheDocument()
  expect(screen.queryByRole('link', { name: /Set 2/ })).not.toBeInTheDocument()
})
