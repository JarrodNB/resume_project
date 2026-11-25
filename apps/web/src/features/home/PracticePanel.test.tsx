/** Checks Home's Practice lane: resuming an interview, the written question bank's next step, jobs ready for practice, and quiet failure. */
import { screen, within } from '@testing-library/react'
import { expect, it } from 'vitest'
import { renderPage } from '@/test/renderPage'
import { INTERVIEW_QUESTION_BANK_QUERY } from '@/features/interview-prep/interviewPrepOperations'
import { RECENT_INTERVIEWS } from '@/features/interviews/interviewOperations'
import { PRACTICE_JOB_LIMIT, PracticePanel } from './PracticePanel'

function job(id: string, title: string, nextStep = 'PRACTICE_INTERVIEW') {
  return { __typename: 'JobPipelineEntry' as const, nextStep, job: { __typename: 'Job' as const, id, title, company: 'Synthetic Co', location: null, stage: 'INTERVIEWING' as const, createdAt: '2026-10-01T00:00:00Z', appliedAt: null } }
}

function question(id: string, answerText: string, extra: Record<string, unknown> = {}) {
  return {
    __typename: 'InterviewQuestion', id, position: 1, retiredAt: null, questionText: `Question ${id}`, answerText, answerFormat: 'free', answerDrafts: {},
    memoryAnchor: '', feedback: {}, feedbackOutdated: false, latestTask: null,
    questionSet: { __typename: 'InterviewQuestionSet', id: 'set-1', number: 1, setType: 'BEHAVIORAL', createdAt: '2026-11-01T00:00:00Z' }, ...extra,
  }
}

const reviewed = { feedback: { strengths: ['Clear'], improvements: [] } }

function session(id: string, status: string, createdAt: string, extra: Record<string, unknown> = {}) {
  return { __typename: 'InterviewSession', id, status, createdAt, currentQuestionPosition: 1, questions: [{ __typename: 'InterviewSessionQuestion', id: `${id}-q1` }, { __typename: 'InterviewSessionQuestion', id: `${id}-q2` }, { __typename: 'InterviewSessionQuestion', id: `${id}-q3` }], jobContext: null, ...extra }
}

function renderPanel({ entries = [] as unknown[], questions = [] as unknown[], sessions = [] as unknown[] } = {}) {
  return renderPage({ path: '/', url: '/', element: <PracticePanel entries={entries as never} />, mocks: [
    { request: { query: INTERVIEW_QUESTION_BANK_QUERY }, result: { data: { interviewQuestions: questions } } },
    { request: { query: RECENT_INTERVIEWS }, result: { data: { recentInterviewSessions: sessions } } },
  ] as never })
}

it('invites a new user to generate written questions or start a spoken interview', async () => {
  renderPanel()
  const lane = await screen.findByRole('region', { name: 'Practice' })
  expect(await within(lane).findByRole('link', { name: 'Generate practice questions: Written questions' })).toHaveAttribute('href', '/practice/questions')
  expect(within(lane).getByRole('link', { name: 'Start a spoken interview' })).toHaveAttribute('href', '/practice/interviews')
})

it('resumes the newest unfinished interview and does not also offer a review', async () => {
  renderPanel({ sessions: [
    session('old', 'active', '2026-11-01T00:00:00Z'),
    session('new', 'active', '2026-11-20T00:00:00Z', { jobContext: { __typename: 'InterviewJobContext', id: 'job-9', title: 'Data Analyst', company: 'Acme' } }),
    session('done', 'completed', '2026-11-10T00:00:00Z'),
    session('gone', 'abandoned', '2026-11-22T00:00:00Z'),
  ] })
  const lane = await screen.findByRole('region', { name: 'Practice' })
  expect(await within(lane).findByRole('link', { name: 'Resume interview: Interview for Data Analyst' })).toHaveAttribute('href', '/practice/interviews/new')
  expect(within(lane).getByText('Question 2 of 3')).toBeInTheDocument()
  expect(within(lane).queryByRole('link', { name: /Review interview/ })).not.toBeInTheDocument()
})

it('offers a review of the last finished interview when none is in progress', async () => {
  renderPanel({ sessions: [session('done', 'completed', '2026-11-10T00:00:00Z')] })
  const lane = await screen.findByRole('region', { name: 'Practice' })
  expect(await within(lane).findByRole('link', { name: 'Review interview: Last interview' })).toHaveAttribute('href', '/practice/interviews/done')
})

it.each([
  ['unanswered questions', [question('1', ''), question('2', 'My answer', reviewed)], 'Answer next question', '1 of 2 answered · 1 with feedback'],
  ['answers without feedback', [question('1', 'My answer')], 'Get feedback', '1 of 1 answered · 0 with feedback'],
  ['feedback out of date', [question('1', 'My answer', { ...reviewed, feedbackOutdated: true })], 'Refresh feedback', '1 of 1 answered · 0 with feedback'],
  ['feedback being written', [question('1', 'My answer', { latestTask: { __typename: 'AiTask', id: 't', status: 'QUEUED', taskType: 'REVIEW_INTERVIEW_ANSWER' } })], 'Getting feedback', '1 of 1 answered · 0 with feedback'],
  ['everything reviewed', [question('1', 'My answer', reviewed)], 'Up to date', '1 of 1 answered · 1 with feedback'],
])('shows the next written-question step for %s', async (_name, questions, label, detail) => {
  renderPanel({ questions })
  const lane = await screen.findByRole('region', { name: 'Practice' })
  expect(await within(lane).findByRole('link', { name: `${label}: Written questions` })).toHaveAttribute('href', '/practice/questions')
  expect(within(lane).getByText(detail)).toBeInTheDocument()
})

it('ignores retired question copies', async () => {
  renderPanel({ questions: [question('1', 'My answer', reviewed), question('2', '', { retiredAt: '2026-11-02T00:00:00Z' })] })
  expect(await screen.findByRole('link', { name: 'Up to date: Written questions' })).toBeInTheDocument()
})

it('lists jobs ready for interview practice, capped, and says how many more', async () => {
  const entries = Array.from({ length: PRACTICE_JOB_LIMIT + 2 }, (_, index) => job(`job-${index}`, `Role ${index}`))
  renderPanel({ entries: [...entries, job('job-x', 'Waiting Role', 'AWAITING_RESPONSE')] })
  const lane = await screen.findByRole('region', { name: 'Practice' })
  expect(await within(lane).findByRole('link', { name: 'Practice interview: Role 0' })).toHaveAttribute('href', '/jobs/job-0/interview')
  expect(within(lane).getAllByRole('link', { name: /^Practice interview: / })).toHaveLength(PRACTICE_JOB_LIMIT)
  expect(within(lane).getByText('2 more jobs are ready for interview practice.')).toBeInTheDocument()
  expect(within(lane).queryByText('Waiting Role')).not.toBeInTheDocument()
})

it('says quietly when practice cannot load, without hiding the rest of the lane', async () => {
  renderPage({ path: '/', url: '/', element: <PracticePanel entries={[]} />, mocks: [
    { request: { query: INTERVIEW_QUESTION_BANK_QUERY }, error: new Error('Network down') },
    { request: { query: RECENT_INTERVIEWS }, error: new Error('Network down') },
  ] })
  expect(await screen.findByText(/Couldn’t load your practice/)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Start a spoken interview' })).toBeInTheDocument()
})
