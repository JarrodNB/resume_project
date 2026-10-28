/** Exercises explicit coaching requests and saved feedback without running browser/provider work. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MockedProvider } from '@apollo/client/testing/react'
import { CompletedInterviewFeedback } from './CompletedInterviewFeedback'
import { REQUEST_INTERVIEW_SESSION_FEEDBACK } from './interviewOperations'
import type { SavedSessionFeedback } from './useInterviewSessionFeedback'

vi.mock('@/features/ai-tasks/useAiTaskUpdates', () => ({ useAiTaskUpdates: () => ({ aiTask: null, error: null }) }))
afterEach(() => { cleanup(); localStorage.clear() })
describe('CompletedInterviewFeedback', () => {
  it('offers generation only after the candidate opens feedback', async () => {
    render(<MockedProvider><CompletedInterviewFeedback interviewId="session" saved={null} questions={[]} hasAnswers /></MockedProvider>)
    expect(screen.queryByRole('button', { name: 'Generate feedback' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Interview feedback' }))
    expect(screen.getByRole('button', { name: 'Generate feedback' })).toBeEnabled()
  })

  it('queues only after an explicit click and displays pending status', async () => {
    const saved = { __typename: 'InterviewSessionFeedback' as const, id: 'feedback', status: 'queued', content: {}, attemptCount: 1, aiTaskId: 'task', deadline: '2099-10-28T00:00:00Z' }
    const result = vi.fn(() => ({ data: { requestInterviewSessionFeedback: { __typename: 'RequestInterviewSessionFeedbackPayload', errors: [], feedback: saved } } }))
    render(<MockedProvider mocks={[{ request: { query: REQUEST_INTERVIEW_SESSION_FEEDBACK, variables: { input: { interviewId: 'session', retryFailed: false } } }, result }]}>
      <CompletedInterviewFeedback interviewId="session" saved={null} questions={[]} hasAnswers />
    </MockedProvider>)
    await userEvent.click(screen.getByRole('button', { name: 'Interview feedback' }))
    expect(result).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Generate feedback' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Generating interview feedback')
    await waitFor(() => expect(result).toHaveBeenCalledOnce())
    expect(screen.queryByRole('button', { name: 'Generate feedback' })).not.toBeInTheDocument()
  })

  it('reopens saved summary and coaching grouped by the actual core question', async () => {
    const saved: SavedSessionFeedback = { id: 'feedback', status: 'completed', content: {
      summary: 'Make your outcomes clearer.', questions: [{ question_id: 'question', strengths: ['Specific contribution'], improvements: ['Explain the outcome'], example_answer: 'I tested the scheduler with the team.' }],
    }, attemptCount: 1, aiTaskId: 'task', deadline: '2099-10-28T00:00:00Z' }
    render(<MockedProvider><CompletedInterviewFeedback interviewId="session" saved={saved} questions={[{ id: 'question', content: 'Tell me about teamwork.', position: 0 }]} hasAnswers /></MockedProvider>)
    await userEvent.click(screen.getByRole('button', { name: 'Interview feedback' }))
    expect(screen.getByText('Make your outcomes clearer.')).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Core question 1: Tell me about teamwork.' })).toBeVisible()
    expect(screen.getByText('Specific contribution')).toBeVisible()
    expect(screen.getByText('Explain the outcome')).toBeVisible()
    expect(screen.getByText('I tested the scheduler with the team.')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Generate feedback' })).not.toBeInTheDocument()
  })

  it('explains why an all-skipped interview cannot be assessed', async () => {
    render(<MockedProvider><CompletedInterviewFeedback interviewId="session" saved={null} questions={[]} hasAnswers={false} /></MockedProvider>)
    await userEvent.click(screen.getByRole('button', { name: 'Interview feedback' }))
    expect(screen.getByText(/No answers were submitted/)).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Generate feedback' })).not.toBeInTheDocument()
  })

})
