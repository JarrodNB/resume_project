/** Retained coaching and transcript disappear together when an open review expires. */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'
import { MockedProvider } from '@apollo/client/testing/react'
import type { InterviewSnapshotFragment } from '@/graphql/generated/graphql'
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
