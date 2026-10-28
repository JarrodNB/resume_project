/** Checks that saved sessions can be found and resumed without a separate management page. */
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { renderPage } from '@/test/renderPage'
import { RecentInterviews } from './RecentInterviews'

vi.mock('./useRecentInterviews', () => ({ useRecentInterviews: () => ({ loading: false, error: null,
  interviews: ['preparing', 'ready', 'active', 'completed', 'abandoned', 'expired'].map((status, index) => ({
    id: status, status, createdAt: '2026-10-21T09:00:00Z', currentQuestionPosition: index,
    jobContext: status === 'active' ? { id: 'job-live', title: 'Laboratory technician', company: 'Sample Labs' }
      : status === 'completed' ? { id: null, title: 'Research coordinator', company: null } : null,
    questions: status === 'preparing' ? [] : Array.from({ length: 9 }, (_, position) => ({ id: `q${position}` })),
  })) }) }))

describe('RecentInterviews', () => {
  it('identifies saved-job practice using its frozen title and company, including a deleted source', async () => {
    renderPage({ path: '/', url: '/', element: <RecentInterviews /> })
    await userEvent.click(screen.getByRole('button', { name: /recent interviews/i }))
    expect(screen.getByText('Laboratory technician')).toBeVisible()
    expect(screen.getByText('Sample Labs')).toBeVisible()
    expect(screen.getByText('Research coordinator')).toBeVisible()
    expect(screen.getByText('Unknown company')).toBeVisible()
    expect(screen.getByRole('link', { name: /resume interview for laboratory technician/i })).toHaveAttribute('href', '/practice/interviews/active')
    expect(screen.getByRole('link', { name: /review interview for research coordinator/i })).toHaveAttribute('href', '/practice/interviews/completed')
  })
  it('shows saved dates, statuses and question progress with resume and review links', async () => {
    renderPage({ path: '/', url: '/', element: <RecentInterviews /> })
    await userEvent.click(screen.getByRole('button', { name: /recent interviews/i }))
    expect(screen.getByText('Preparing')).toBeVisible()
    expect(screen.getByText('Ready')).toBeVisible()
    expect(screen.getByText('Active')).toBeVisible()
    expect(screen.getByText('Completed')).toBeVisible()
    expect(screen.getByText('Ended')).toBeVisible()
    expect(screen.getByText('Expired')).toBeVisible()
    expect(screen.getAllByRole('link')).toHaveLength(4)
    expect(screen.getByText('Core question 3 of 9')).toBeVisible()
    expect(screen.getAllByRole('time')).toHaveLength(6)
    expect(screen.getAllByRole('link', { name: /resume interview/i }).map((link) => link.getAttribute('href'))).toEqual([
      '/practice/interviews/preparing', '/practice/interviews/ready', '/practice/interviews/active',
    ])
    expect(screen.getByRole('link', { name: /review interview/i })).toHaveAttribute('href', '/practice/interviews/completed')
  })
})
