/** Check that upload rejection is announced and cleared after a valid selection. */
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { ResumeDropzone } from './ResumeDropzone'

it('announces invalid files and clears the field error on a valid selection', async () => {
  const selected = vi.fn()
  render(<ResumeDropzone onFileSelected={selected} />)
  const input = screen.getByLabelText('Resume file')
  await userEvent.tab()
  expect(input).toHaveFocus()
  fireEvent.change(input, { target: { files: [new File(['text'], 'resume.txt')] } })
  const error = screen.getByRole('alert')
  expect(input).toHaveAttribute('aria-invalid', 'true')
  expect(input.getAttribute('aria-describedby')?.split(' ')).toContain(error.id)
  expect(selected).not.toHaveBeenCalled()

  const file = new File(['synthetic PDF'], 'resume.pdf')
  fireEvent.change(input, { target: { files: [file] } })
  expect(selected).toHaveBeenCalledWith(file)
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(input).not.toHaveAttribute('aria-invalid')
})
