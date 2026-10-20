/** Password guidance and visibility work through the same form used for account entry. */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { AuthForm } from './AuthForm'
import { AuthRequestError } from './authApi'

it('describes new passwords and shows the value without submitting or losing it', async () => {
  const onSubmit = vi.fn()
  const user = userEvent.setup()
  render(<AuthForm submitLabel="Create account" includeName onSubmit={onSubmit} />)
  const password = screen.getByLabelText('Password')
  expect(password).toHaveAccessibleDescription(/at least 15 characters/i)
  expect(password).toHaveAttribute('autocomplete', 'new-password')
  await user.type(password, 'a quiet orchard after rain')
  await user.click(screen.getByRole('button', { name: 'Show password' }))
  expect(password).toHaveAttribute('type', 'text')
  expect(password).toHaveValue('a quiet orchard after rain')
  expect(screen.getByRole('button', { name: 'Hide password' })).toHaveAttribute('aria-pressed', 'true')
  expect(onSubmit).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Hide password' }))
  expect(password).toHaveAttribute('type', 'password')
})

it('preserves pasted Unicode passwords and associates server validation with the field', async () => {
  const message = 'Password must be 72 bytes or fewer (some characters use more than one byte)'
  const onSubmit = vi.fn().mockRejectedValue(new AuthRequestError([message]))
  const user = userEvent.setup()
  render(<AuthForm submitLabel="Create account" includeName onSubmit={onSubmit} />)
  await user.type(screen.getByLabelText('Email'), 'ada@example.com')
  const password = screen.getByLabelText('Password')
  await user.click(password)
  const pasted = ' 🌳 ' + 'é'.repeat(40) + ' '
  await user.paste(pasted)
  expect(password).toHaveValue(pasted)
  expect(password).not.toHaveAttribute('maxlength')
  await user.click(screen.getByRole('button', { name: 'Create account' }))
  expect(onSubmit).toHaveBeenCalledWith({ name: '', email: 'ada@example.com', password: pasted })
  expect(await screen.findByRole('alert')).toHaveTextContent(message)
  expect(password).toHaveAccessibleDescription(new RegExp('Password must be 72 bytes'))
  expect(password).toHaveAttribute('aria-invalid', 'true')
  expect(password).toHaveValue(pasted)
})

it('allows legacy short passwords on sign-in with password-manager autofill', async () => {
  const onSubmit = vi.fn().mockResolvedValue(undefined)
  const user = userEvent.setup()
  render(<AuthForm submitLabel="Sign in" onSubmit={onSubmit} />)
  const password = screen.getByLabelText('Password')
  expect(password).toHaveAttribute('autocomplete', 'current-password')
  expect(password).not.toHaveAttribute('minlength')
  expect(password).not.toHaveAttribute('maxlength')
  expect(screen.queryByText(/at least 15 characters/i)).not.toBeInTheDocument()
  await user.type(screen.getByLabelText('Email'), 'ada@example.com')
  await user.type(password, 'short')
  await user.tab()
  expect(screen.getByRole('button', { name: 'Show password' })).toHaveFocus()
  await user.keyboard(' ')
  expect(password).toHaveAttribute('type', 'text')
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
  expect(onSubmit).toHaveBeenCalledWith({ email: 'ada@example.com', password: 'short' })
})
