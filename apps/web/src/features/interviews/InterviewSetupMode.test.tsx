/** Verifies the Turn-based / Live choice in the round step for practice-role and saved-job setup. */
import { fireEvent, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { renderPage } from '@/test/renderPage'
import { InterviewSetup } from './InterviewSetup'

const { start } = vi.hoisted(() => ({ start: vi.fn() }))
vi.mock('./useInterviewSession', () => ({ useStartInterview: () => ({ start, loading: false, error: null }) }))
vi.mock('@/features/auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'owner' } }) }))
const job = { id: 'job-1', title: 'Laboratory technician', company: 'Sample Labs', description: null,
  requirements: [], responsibilities: [], niceToHaves: [] }

beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); start.mockResolvedValue('session') })

function startFromSettings() {
  fireEvent.click(screen.getByRole('button', { name: 'Continue to settings' }))
  fireEvent.click(screen.getByRole('button', { name: 'Start interview' }))
}

it('offers Turn-based by default and sends it with a practice-role start', () => {
  renderPage({ path: '/practice/interviews', url: '/practice/interviews', element: <InterviewSetup />, mocks: [] })
  expect(screen.getByRole('radio', { name: 'Turn-based' })).toBeChecked()
  expect(screen.getByRole('radio', { name: /Full loop/ })).toBeInTheDocument()
  startFromSettings()
  expect(start).toHaveBeenCalledWith('', expect.objectContaining({ questionCount: 8 }), undefined, 'turn_based')
})

it('hides the twelve-question length for Live and moves a full loop to eight questions', () => {
  renderPage({ path: '/practice/interviews', url: '/practice/interviews', element: <InterviewSetup />, mocks: [] })
  fireEvent.click(screen.getByRole('radio', { name: /Full loop/ }))
  fireEvent.click(screen.getByRole('radio', { name: 'Live' }))
  expect(screen.queryByRole('radio', { name: /Full loop/ })).not.toBeInTheDocument()
  expect(screen.getByRole('radio', { name: /Standard/ })).toBeChecked()
  startFromSettings()
  expect(start).toHaveBeenCalledWith('', expect.objectContaining({ questionCount: 8 }), undefined, 'live')
})

it('sends a Live choice with a saved-job start', () => {
  renderPage({ path: '/jobs/:jobId/interview', url: '/jobs/job-1/interview', element: <InterviewSetup job={job} />, mocks: [] })
  fireEvent.click(screen.getByRole('radio', { name: 'Live' }))
  fireEvent.click(screen.getByRole('radio', { name: /Short/ }))
  startFromSettings()
  expect(start).toHaveBeenCalledWith('', expect.objectContaining({ questionCount: 5 }), 'job-1', 'live')
})
