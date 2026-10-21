/** Checks that saved sessions can be found and resumed without a separate management page. */
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { renderPage } from '@/test/renderPage'
import { RecentInterviews } from './RecentInterviews'

vi.mock('./useRecentInterviews', () => ({ useRecentInterviews: () => ({ loading: false, error: null,
  interviews: ['preparing', 'ready', 'active', 'completed'].map((status, index) => ({
    id: status, status, createdAt: '2026-10-21T09:00:00Z', currentQuestionPosition: index,
    questions: status === 'preparing' ? [] : Array.from({ length: 9 }, (_, position) => ({ id: `q${position}` })),
  })) }) }))

describe('RecentInterviews', () => {
  it('shows saved dates, statuses and question progress with resume and review links', async () => {
    renderPage({ path: '/', url: '/', element: <RecentInterviews /> })
    await userEvent.click(screen.getByRole('button', { name: /recent interviews/i }))
    expect(screen.getByText('Preparing')).toBeVisible()
    expect(screen.getByText('Ready')).toBeVisible()
    expect(screen.getByText('Active')).toBeVisible()
    expect(screen.getByText('Completed')).toBeVisible()
    expect(screen.getByText('Question 3 of 9')).toBeVisible()
    expect(screen.getAllByRole('time')).toHaveLength(4)
    expect(screen.getAllByRole('link', { name: /resume interview/i }).map((link) => link.getAttribute('href'))).toEqual([
      '/interviews/demo/preparing', '/interviews/demo/ready', '/interviews/demo/active',
    ])
    expect(screen.getByRole('link', { name: /review interview/i })).toHaveAttribute('href', '/interviews/demo/completed')
  })
})
