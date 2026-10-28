/** Completed reviews save individual approved answers and hide retained text at expiry. */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'
import { MockedProvider } from '@apollo/client/testing/react'
import type { InterviewSnapshotFragment } from '@/graphql/generated/graphql'
import userEvent from '@testing-library/user-event'
import { CREATE_CAREER_CONTEXT_MUTATION } from '@/features/career-library/careerLibrarySaveMutations'
import { CompletedInterviewReview } from './CompletedInterviewReview'

vi.mock('@/features/ai-tasks/useAiTaskUpdates', () => ({ useAiTaskUpdates: () => ({ aiTask: null, error: null }) }))
afterEach(() => { cleanup(); vi.useRealTimers(); localStorage.clear() })
it('hides saved coaching and its controls at session expiry even without a network update', () => {
  vi.useFakeTimers()
  const interview: InterviewSnapshotFragment = {
    id: 'session', status: 'completed', interviewType: 'basic', executionMode: 'real', speechPlaybackMode: 'browser',
    revision: 1, answerCap: 2, currentQuestionPosition: 0, expiresAt: new Date(Date.now() + 1000).toISOString(), preparedRole: {}, jobContext: null,
    setup: { questionCount: 1, questionFormat: 'mixed', difficulty: 'realistic', interviewer: 'daniel', focusAreas: [] },
    questions: [{ id: 'question', content: 'How did you help?', questionType: 'behavioral', position: 0, acceptedAnswerCount: 1, skipped: false }], messages: [], operations: [],
    feedback: { id: 'feedback', status: 'completed', content: { summary: 'Explain your outcome.', questions: [{ question_id: 'question', strengths: ['Specific action'], improvements: ['Add the outcome'], example_answer: 'I tested it.' }] }, attemptCount: 1, aiTaskId: 'task', deadline: new Date(Date.now() + 1000).toISOString() },
  }
  render(<MockedProvider><MemoryRouter><CompletedInterviewReview interview={interview} /></MemoryRouter></MockedProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'Interview feedback' }))
  expect(screen.getByText('Explain your outcome.')).toBeVisible()
  act(() => { vi.advanceTimersByTime(1001) })
  expect(screen.queryByText('Explain your outcome.')).not.toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Interview expired' })).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Interview feedback' })).not.toBeInTheDocument()
})

function reviewSnapshot(): InterviewSnapshotFragment {
  const message = (id: string, position: number, kind: string, content: string) => ({ id, position, kind, content,
    questionId: 'question', acknowledgement: null, spokenContent: '', avoided: false, careerReferences: null, clarification: null })
  return {
    id: 'session', status: 'completed', interviewType: 'basic', executionMode: 'real', speechPlaybackMode: 'browser',
    revision: 1, answerCap: 2, currentQuestionPosition: 0, expiresAt: new Date(Date.now() + 60_000).toISOString(), preparedRole: {}, jobContext: null,
    setup: { questionCount: 1, questionFormat: 'mixed', difficulty: 'realistic', interviewer: 'daniel', focusAreas: [] },
    questions: [{ id: 'question', content: 'Describe your migration.', questionType: 'behavioral', position: 0, acceptedAnswerCount: 2, skipped: false }],
    messages: [message('opening', 0, 'opening', 'Describe your migration.'), message('first', 1, 'answer', 'Migrated the release pipeline.'),
      message('followup', 2, 'follow_up', 'What was the outcome?'), message('second', 3, 'answer', 'Reduced release delays.')], operations: [], feedback: null,
  }
}

it('saves individual core and follow-up answers from completed reviews through an editable preview', async () => {
  const interview = reviewSnapshot()
  const saved = vi.fn(() => ({ data: { createCareerContext: { __typename: 'CreateCareerContextPayload', errors: [] } } }))
  render(<MockedProvider mocks={[{ request: { query: CREATE_CAREER_CONTEXT_MUTATION, variables: { attributes: {
    requirement: 'Release outcomes', response: 'Reduced release delays by one day.',
  } } }, result: saved }]}><MemoryRouter><CompletedInterviewReview interview={interview} /></MemoryRouter></MockedProvider>)
  await userEvent.click(screen.getByRole('button', { name: 'Core question 1' }))
  const buttons = screen.getAllByRole('button', { name: 'Save to Career context' })
  expect(buttons).toHaveLength(2)
  await userEvent.click(buttons[0])
  expect(screen.getByLabelText('Requirement')).toHaveValue('Describe your migration.')
  expect(screen.getByLabelText('Response')).toHaveValue('Migrated the release pipeline.')
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  await userEvent.click(buttons[1])
  expect(screen.getByLabelText('Requirement')).toHaveValue('What was the outcome?')
  expect(screen.getByLabelText('Response')).toHaveValue('Reduced release delays.')
  fireEvent.change(screen.getByLabelText('Requirement'), { target: { value: 'Release outcomes' } })
  fireEvent.change(screen.getByLabelText('Response'), { target: { value: 'Reduced release delays by one day.' } })
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(await screen.findByRole('status')).toHaveTextContent('Saved to Career context.')
  expect(saved).toHaveBeenCalledOnce()
  expect(interview.messages[3].content).toBe('Reduced release delays.')
  expect(within(screen.getByLabelText('Saved questions and answers')).getByText('Reduced release delays.')).toBeVisible()
})

it('removes an open save preview when retained interview text expires', () => {
  vi.useFakeTimers()
  const interview = reviewSnapshot()
  interview.expiresAt = new Date(Date.now() + 1000).toISOString()
  render(<MockedProvider><MemoryRouter><CompletedInterviewReview interview={interview} /></MemoryRouter></MockedProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'Core question 1' }))
  fireEvent.click(screen.getAllByRole('button', { name: 'Save to Career context' })[0])
  expect(screen.getByLabelText('Response')).toHaveValue('Migrated the release pipeline.')
  act(() => { vi.advanceTimersByTime(1001) })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Save to Career context' })).not.toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Interview expired' })).toBeVisible()
})

it('offers no save action for expired or unavailable answer text', async () => {
  const interview = reviewSnapshot()
  interview.messages[1].content = '[expired]'
  interview.messages[3].content = ''
  render(<MockedProvider><MemoryRouter><CompletedInterviewReview interview={interview} /></MemoryRouter></MockedProvider>)
  await userEvent.click(screen.getByRole('button', { name: 'Core question 1' }))
  expect(screen.queryByRole('button', { name: 'Save to Career context' })).not.toBeInTheDocument()
})
