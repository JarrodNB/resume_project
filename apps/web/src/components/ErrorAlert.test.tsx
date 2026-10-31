/**
 * Description: Task errors dismiss, expire, and show again for a new task.
 * Index: notification lifecycle regression tests
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ErrorAlert } from './ErrorAlert'
import { TRANSIENT_ALERT_EXIT_MS, TRANSIENT_ALERT_MS } from './TransientAlert'

afterEach(() => vi.useRealTimers())

it('keeps a dismissed failure hidden on rerender and shows a new task failure', async () => {
  const { rerender } = render(<ErrorAlert notificationId="task-1" messages={['Feedback failed']} />)
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  rerender(<ErrorAlert notificationId="task-1" messages={['Feedback failed']} />)
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  rerender(<ErrorAlert notificationId="task-2" messages={['Feedback failed']} />)
  expect(screen.getByRole('alert')).toBeInTheDocument()
})

it('automatically hides task errors after eight seconds', () => {
  vi.useFakeTimers()
  render(<ErrorAlert notificationId="task-1" messages={['Feedback failed']} />)
  act(() => vi.advanceTimersByTime(TRANSIENT_ALERT_MS))
  act(() => vi.advanceTimersByTime(TRANSIENT_ALERT_EXIT_MS))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it('keeps ordinary form errors visible', () => {
  vi.useFakeTimers()
  render(<ErrorAlert messages={['Answer is required']} />)
  act(() => vi.advanceTimersByTime(TRANSIENT_ALERT_MS))
  expect(screen.getByRole('alert')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument()
})
