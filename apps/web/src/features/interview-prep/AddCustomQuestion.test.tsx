/** Candidate questions save through the public mutation and keep drafts on failure. */
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { expect, it } from 'vitest'
import { renderPage } from '@/test/renderPage'
import { AddCustomQuestion } from './AddCustomQuestion'
import { CREATE_CUSTOM_INTERVIEW_QUESTION } from './interviewPrepOperations'

it('adds a typed question with an optional answer without a library query', async () => {
  const { router } = renderPage({ path: '/practice/questions', url: '/practice/questions', element: <AddCustomQuestion />,
    extraRoutes: [{ path: '/practice/questions/:id', element: <p>Saved question</p> }], mocks: [{
      request: { query: CREATE_CUSTOM_INTERVIEW_QUESTION, variables: { setType: 'KNOWLEDGE', questionText: 'What is caching?', answerText: 'Reuse results.' } },
      result: { data: { createCustomInterviewQuestion: { __typename: 'CreateCustomInterviewQuestionPayload', errors: [], questionSet: { __typename: 'InterviewQuestionSet', id: 'custom' } } } },
    }] })
  fireEvent.click(screen.getByRole('button', { name: 'Add your own question' }))
  fireEvent.click(screen.getByRole('button', { name: 'Knowledge' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Question' }), { target: { value: 'What is caching?' } })
  fireEvent.change(screen.getByRole('textbox', { name: 'Initial answer (optional)' }), { target: { value: 'Reuse results.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Add question' }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/practice/questions/custom'))
})

it('keeps entered wording when saving fails', async () => {
  renderPage({ path: '/practice/questions', url: '/practice/questions', element: <AddCustomQuestion />, mocks: [{
    request: { query: CREATE_CUSTOM_INTERVIEW_QUESTION, variables: { setType: 'FIT_MOTIVATION', questionText: 'My question?', answerText: '' } },
    result: { data: { createCustomInterviewQuestion: { __typename: 'CreateCustomInterviewQuestionPayload', errors: ['Try again.'], questionSet: null } } },
  }] })
  fireEvent.click(screen.getByRole('button', { name: 'Add your own question' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Question' }), { target: { value: 'My question?' } })
  fireEvent.click(screen.getByRole('button', { name: 'Add question' }))
  expect(await screen.findByText('Try again.')).toBeVisible()
  expect(screen.getByRole('textbox', { name: 'Question' })).toHaveValue('My question?')
})
