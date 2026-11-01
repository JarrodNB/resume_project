import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ChatReplyWaiting } from './ChatReplyWaiting'

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

it('changes the visible caption over time while screen readers hear one steady status', () => {
  render(<ChatReplyWaiting />)
  expect(screen.getByRole('status')).toHaveTextContent('Preparing your reply…')
  expect(screen.getByText('Reading your message…')).toHaveAttribute('aria-hidden', 'true')
  act(() => { vi.advanceTimersByTime(3200) })
  expect(screen.getByText('Thinking it through…')).toBeInTheDocument()
  expect(screen.queryByText('Reading your message…')).not.toBeInTheDocument()
  for (let step = 0; step < 6; step += 1) act(() => { vi.advanceTimersByTime(3200) })
  expect(screen.getByText(/Still working on it/)).toBeInTheDocument()
})
