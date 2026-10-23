/** Protect unsent input when skipping, and keep recovery visible after a failed request. */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { SkipInterviewQuestionButton } from './SkipInterviewQuestionButton'

it('requires confirmation for unsent input and retains the dialog on failure', async () => {
  const skip = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
  const onSkipped = vi.fn()
  render(<SkipInterviewQuestionButton dirty disabled={false} busy={false} error="Connection lost. Try again." skip={skip} onSkipped={onSkipped} />)
  await userEvent.click(screen.getByRole('button', { name: 'Skip question' }))
  expect(skip).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: 'Skip and discard' }))
  expect(onSkipped).not.toHaveBeenCalled()
  expect(screen.getByRole('dialog')).toBeVisible()
  expect(screen.getByRole('alert')).toHaveTextContent('Connection lost')
  await userEvent.click(screen.getByRole('button', { name: 'Skip and discard' }))
  expect(onSkipped).toHaveBeenCalledOnce()
})
