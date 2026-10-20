/** Confirmation links are captured before auth bootstrap and require an explicit submit. */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import { AuthProvider } from './AuthProvider'
import { VerifyEmailPage } from './VerifyEmailPage'
import { captureConfirmationToken } from './confirmationLink'
import { SignUpPage } from './SignUpPage'
import { StrictMode } from 'react'

afterEach(() => { vi.unstubAllGlobals(); history.replaceState(null, '', '/') })
it('clears the fragment before bootstrap, waits for consent and does not sign in', async () => {
  history.replaceState(null, '', '/verify-email#confirmation_token=token-from-email')
  captureConfirmationToken()
  expect(location.hash).toBe('')
  const fetcher = vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith('/auth/session')
    ? { user: null, csrfToken: 'csrf' } : { message: 'Email verified. You can now sign in.' })))
  vi.stubGlobal('fetch', fetcher)
  render(<StrictMode><MemoryRouter><AuthProvider><VerifyEmailPage /></AuthProvider></MemoryRouter></StrictMode>)
  await screen.findByRole('button', { name: 'Verify email' })
  expect(screen.queryByRole('button', { name: 'Resend verification email' })).not.toBeInTheDocument()
  expect(fetcher.mock.calls.every(([url]) => url.endsWith('/auth/session'))).toBe(true)
  await userEvent.click(screen.getByRole('button', { name: 'Verify email' }))
  expect(await screen.findByText('Email verified. You can now sign in.')).toBeInTheDocument()
  expect(fetcher).toHaveBeenLastCalledWith(expect.stringContaining('/auth/confirmation/verify'), expect.objectContaining({
    method: 'POST', credentials: 'include', body: JSON.stringify({ confirmation_token: 'token-from-email' }),
  }))
  expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/sign-in')
})

it('shows signup next steps without creating an authenticated session', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith('/auth/session')
    ? { user: null, csrfToken: 'csrf' } : { message: 'Check email' }), { status: url.endsWith('/auth/session') ? 200 : 202 })))
  render(<MemoryRouter><AuthProvider><SignUpPage /></AuthProvider></MemoryRouter>)
  const user = userEvent.setup()
  await user.type(await screen.findByLabelText('Email'), 'new@example.com')
  await user.type(screen.getByLabelText('Password'), 'a quiet orchard after rain')
  await user.click(screen.getByRole('button', { name: 'Create account' }))
  expect(await screen.findByRole('status')).toHaveTextContent('Check your email')
  await user.click(screen.getByText("Didn't receive an email?"))
  expect(screen.getByRole('button', { name: 'Resend verification email' })).toBeInTheDocument()
})

it('supports refresh recovery, pending resend, 429 and network retries', async () => {
  captureConfirmationToken()
  let complete!: (response: Response) => void
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ user: null, csrfToken: 'csrf' })))
    .mockImplementationOnce(() => new Promise<Response>((resolve) => { complete = resolve }))
    .mockRejectedValueOnce(new TypeError('offline'))
    .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Check your inbox or spam folder.' }), { status: 202 }))
  vi.stubGlobal('fetch', fetcher)
  render(<MemoryRouter><AuthProvider><VerifyEmailPage /></AuthProvider></MemoryRouter>)
  const user = userEvent.setup()
  await user.type(await screen.findByLabelText('Email'), 'new@example.com')
  await user.click(screen.getByRole('button', { name: 'Resend verification email' }))
  expect(screen.getByRole('button', { name: 'Sending…' })).toBeDisabled()
  complete(new Response(JSON.stringify({ errors: ['Too many requests. Please try again later.'] }), { status: 429 }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Too many requests')
  await user.click(screen.getByRole('button', { name: 'Resend verification email' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the server')
  await user.click(screen.getByRole('button', { name: 'Resend verification email' }))
  expect(await screen.findByRole('status')).toHaveTextContent('Check your inbox')
})

it('lets signed-in users verify without switching their account, cancel and request a new link', async () => {
  history.replaceState(null, '', '/verify-email#confirmation_token=expired-token')
  captureConfirmationToken()
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ user: { id: 'existing', email: 'existing@example.com', name: 'Existing' }, csrfToken: 'csrf' })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ errors: ['This verification link is invalid or expired.'] }), { status: 422 }))
  vi.stubGlobal('fetch', fetcher)
  render(<MemoryRouter><AuthProvider><VerifyEmailPage /></AuthProvider></MemoryRouter>)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'Verify email' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('invalid or expired')
  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(screen.queryByRole('button', { name: 'Verify email' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Resend verification email' })).toBeInTheDocument()
  expect(fetcher).toHaveBeenCalledTimes(2)
})

it('blocks duplicate verification submissions and allows a retry after network failure', async () => {
  history.replaceState(null, '', '/verify-email#confirmation_token=retry-token')
  captureConfirmationToken()
  let fail!: (error: Error) => void
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ user: null, csrfToken: 'csrf' })))
    .mockImplementationOnce(() => new Promise<Response>((_resolve, reject) => { fail = reject }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Verified' })))
  vi.stubGlobal('fetch', fetcher)
  render(<MemoryRouter><AuthProvider><VerifyEmailPage /></AuthProvider></MemoryRouter>)
  const user = userEvent.setup()
  await user.dblClick(await screen.findByRole('button', { name: 'Verify email' }))
  expect(screen.getByRole('button', { name: 'Verifying…' })).toBeDisabled()
  expect(fetcher).toHaveBeenCalledTimes(2)
  fail(new TypeError('offline'))
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the server')
  await user.click(screen.getByRole('button', { name: 'Verify email' }))
  expect(await screen.findByRole('status')).toHaveTextContent('Email verified')
})
