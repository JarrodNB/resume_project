/** Verify deliberate, memory-only text submission and recoverable editor failures. */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { expect, it, vi } from 'vitest'
import { AnswerEditor } from './AnswerEditor'

it('submits exactly edited text once and keeps it after a failed save', async () => {
  let complete!: (saved: boolean) => void
  const submit = vi.fn(() => new Promise<boolean>((resolve) => { complete = resolve }))
  function Editor() {
    const [text, setText] = useState('')
    return <AnswerEditor text={text} onTextChange={setText} disabled={false} onSubmit={submit} />
  }
  render(<Editor />)
  const input = screen.getByRole('textbox', { name: 'Your answer' })
  expect(input).toHaveAttribute('placeholder', 'Your answer will appear here as you speak. Review and edit the text here, or type your answer.')
  expect(screen.queryByText(/Unsent text stays/)).not.toBeInTheDocument()
  fireEvent.change(input, { target: { value: '  I corrected the recognition text.  ' } })
  fireEvent.click(screen.getByRole('button', { name: 'Submit answer' }))
  fireEvent.click(screen.getByRole('button', { name: 'Submitting answer…' }))
  expect(submit).toHaveBeenCalledExactlyOnceWith('  I corrected the recognition text.  ')
  expect(screen.getByRole('button', { name: 'Submitting answer…' })).toBeDisabled()
  expect(input).toBeDisabled()
  complete(false)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Submit answer' })).toBeEnabled())
  expect(input).toHaveValue('  I corrected the recognition text.  ')
  expect(JSON.stringify(localStorage)).not.toContain('recognition text')
})

it('explains when appended dictation needs shortening before it can be submitted', () => {
  render(<AnswerEditor text={'x'.repeat(4_001)} onTextChange={vi.fn()} disabled={false} onSubmit={vi.fn()} />)
  expect(screen.getByRole('alert')).toHaveTextContent('4,000')
  expect(screen.getByRole('textbox', { name: 'Your answer' })).toBeEnabled()
  expect(screen.getByRole('button', { name: 'Submit answer' })).toBeDisabled()
})
