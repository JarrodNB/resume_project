/** Checks Home's This week lane: counts from jobs, interviews and resumes, and the empty-week message. */
import { screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { renderPage } from '@/test/renderPage'
import { RECENT_INTERVIEWS } from '@/features/interviews/interviewOperations'
import { RESUMES_QUERY } from '@/features/resumes/resumesOperations'
import { WeekPanel } from './WeekPanel'

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 10, 25, 15, 0)) })
afterEach(() => vi.useRealTimers())

const at = (day: number) => new Date(2026, 10, day, 9).toISOString()
const job = (id: string, createdAt: string, appliedAt: string | null = null) => ({ __typename: 'JobPipelineEntry', nextStep: 'NONE', job: { __typename: 'Job', id, title: id, company: null, location: null, stage: 'APPLIED', createdAt, appliedAt } })

function renderWeek(entries: unknown[], resumes: unknown[] = [], sessions: unknown[] = []) {
  return renderPage({ path: '/', url: '/', element: <WeekPanel entries={entries as never} />, mocks: [
    { request: { query: RESUMES_QUERY }, result: { data: { resumes } } },
    { request: { query: RECENT_INTERVIEWS }, result: { data: { recentInterviewSessions: sessions } } },
  ] as never })
}

const total = (lane: HTMLElement, label: string) => within(lane).getByText(label).previousElementSibling?.textContent

it('counts what happened in the last seven days across jobs, applications, interviews and resumes', async () => {
  renderWeek(
    [job('new', at(24)), job('applied', at(1), at(25)), job('old', at(1))],
    [{ __typename: 'Resume', id: 'r1', title: 'R', updatedAt: at(23), job: null }],
    [
      { __typename: 'InterviewSession', id: 'i1', status: 'completed', createdAt: at(22), currentQuestionPosition: 0, questions: [], jobContext: null },
      { __typename: 'InterviewSession', id: 'i2', status: 'abandoned', createdAt: at(22), currentQuestionPosition: 0, questions: [], jobContext: null },
    ],
  )
  const lane = await screen.findByRole('region', { name: 'This week' })
  await within(lane).findByText('Jobs saved')
  await screen.findByText('Applications sent')
  expect(total(lane, 'Jobs saved')).toBe('1')
  expect(total(lane, 'Applications sent')).toBe('1')
  expect(total(lane, 'Interviews practiced')).toBe('1')
  expect(total(lane, 'Resumes edited')).toBe('1')
  expect(within(lane).queryByText(/quiet week/)).not.toBeInTheDocument()
  expect(within(lane).getByText('Today')).toBeInTheDocument()
})

it('describes an empty week plainly and suggests one small step', async () => {
  renderWeek([job('old', at(1))])
  const lane = await screen.findByRole('region', { name: 'This week' })
  expect(await within(lane).findByText(/A quiet week so far/)).toBeInTheDocument()
  expect(within(lane).getByRole('link', { name: 'Find a job' })).toHaveAttribute('href', '/jobs/find')
  expect(within(lane).getByRole('link', { name: 'answer one practice question' })).toHaveAttribute('href', '/practice/questions')
})
