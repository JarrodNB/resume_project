/** Exercises password recovery and change through real auth state and router transitions. */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { afterEach, expect, it, vi } from 'vitest'
import { AuthProvider } from './AuthProvider'
import { appRoutes } from '@/appRoutes'
import { SessionApolloProvider } from '@/graphql/SessionApolloProvider'

afterEach(() => { vi.unstubAllGlobals(); history.replaceState(null, '', '/') })
it('requests reset mail with CSRF and shows the generic next step', async () => {
  const fetcher = vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith('/auth/session')
    ? { user: null, csrfToken: 'csrf' } : { message: 'If this address belongs to a verified account, check your email.' })))
  vi.stubGlobal('fetch', fetcher)
  render(<AuthProvider><SessionApolloProvider><RouterProvider router={createMemoryRouter(appRoutes, { initialEntries: ['/forgot-password'] })} /></SessionApolloProvider></AuthProvider>)
  const user = userEvent.setup()
  await user.type(await screen.findByLabelText('Email'), 'user@example.com')
  await user.click(screen.getByRole('button', { name: 'Send reset email' }))
  expect(await screen.findByRole('status')).toHaveTextContent('verified account')
  expect(fetcher).toHaveBeenLastCalledWith(expect.stringContaining('/auth/password'), expect.objectContaining({ method: 'POST', credentials: 'include', headers: expect.objectContaining({ 'X-CSRF-Token': 'csrf' }) }))
})

it('clears reset fragments before bootstrap and preserves retry after an invalid link', async () => {
  history.replaceState(null, '', '/reset-password#reset_password_token=private-reset-token')
  // Capture at the same pre-bootstrap boundary as main.tsx.
  const { captureResetPasswordToken } = await import('./resetPasswordLink')
  captureResetPasswordToken()
  expect(location.hash).toBe('')
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ user: null, csrfToken: 'csrf' })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ errors: ['This reset link is invalid or expired.'] }), { status: 422 }))
  vi.stubGlobal('fetch', fetcher)
  render(<AuthProvider><SessionApolloProvider><RouterProvider router={createMemoryRouter(appRoutes, { initialEntries: ['/reset-password'] })} /></SessionApolloProvider></AuthProvider>)
  const user = userEvent.setup()
  await user.type(await screen.findByLabelText('New password'), 'a quiet orchard after rain')
  await user.type(screen.getByLabelText('Confirm new password'), 'a quiet orchard after rain')
  await user.click(screen.getByRole('button', { name: 'Reset password' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('invalid or expired')
  expect(fetcher).toHaveBeenLastCalledWith(expect.stringContaining('/auth/password'), expect.objectContaining({ method: 'PUT', body: JSON.stringify({ user: { reset_password_token: 'private-reset-token', password: 'a quiet orchard after rain', password_confirmation: 'a quiet orchard after rain' } }) }))
  expect(screen.getByRole('link', { name: 'Request another reset email' })).toHaveAttribute('href', '/forgot-password')
})

it('keeps password-change success visible after auth and Apollo are refreshed, and broadcasts revocation', async () => {
  const broadcasts: string[] = []
  vi.stubGlobal('BroadcastChannel', class {
    onmessage: (() => void) | null = null
    postMessage(message: string) { broadcasts.push(message) }
    close() {}
  })
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ user: { id: 'account', email: 'user@example.com', name: 'User' }, csrfToken: 'csrf' })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Password changed.' })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ user: null, csrfToken: 'fresh-csrf' })))
  vi.stubGlobal('fetch', fetcher)
  const router = createMemoryRouter(appRoutes, { initialEntries: ['/account/security'] })
  render(<AuthProvider><SessionApolloProvider><RouterProvider router={router} /></SessionApolloProvider></AuthProvider>)
  const user = userEvent.setup()
  await user.type(await screen.findByLabelText('Current password'), 'old legacy password')
  expect(screen.getByRole('heading', { name: 'Account security' })).toBeInTheDocument()
  expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument()
  expect(screen.getByText('user@example.com')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Forgot your current password?' })).toHaveAttribute('href', '/forgot-password')
  expect(screen.queryByRole('link', { name: 'Request another reset email' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Change password' })).toHaveAccessibleDescription(/every device/)
  await user.type(screen.getByLabelText('New password'), 'a quiet orchard after rain')
  await user.type(screen.getByLabelText('Confirm new password'), 'a quiet orchard after rain')
  await user.click(screen.getByRole('button', { name: 'Change password' }))
  expect(await screen.findByRole('heading', { name: 'Password updated' })).toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('Your password has been updated')
  expect(router.state.location.pathname).toBe('/password-updated')
  expect(fetcher).toHaveBeenNthCalledWith(2, expect.stringContaining('/auth/password/change'), expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ user: { current_password: 'old legacy password', password: 'a quiet orchard after rain', password_confirmation: 'a quiet orchard after rain' } }) }))
  expect(fetcher.mock.calls.map(([url]) => url)).not.toContain(expect.stringContaining('/auth/sign_out'))
  expect(broadcasts).toEqual(['changed'])
  expect(screen.queryByLabelText('Current password')).not.toBeInTheDocument()
})

it('shows current-password and policy errors, blocks duplicate submits and allows network retries', async () => {
  let complete!: (response: Response) => void
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ user: { id: 'account', email: 'user@example.com', name: 'User' }, csrfToken: 'csrf' })))
    .mockImplementationOnce(() => new Promise<Response>((resolve) => { complete = resolve }))
    .mockRejectedValueOnce(new TypeError('offline'))
    .mockResolvedValueOnce(new Response(JSON.stringify({ errors: ['Current password is invalid', 'Password confirmation must match'] }), { status: 422 }))
  vi.stubGlobal('fetch', fetcher)
  render(<AuthProvider><SessionApolloProvider><RouterProvider router={createMemoryRouter(appRoutes, { initialEntries: ['/account/security'] })} /></SessionApolloProvider></AuthProvider>)
  const user = userEvent.setup()
  await user.type(await screen.findByLabelText('Current password'), 'wrong')
  await user.type(screen.getByLabelText('New password'), 'a quiet orchard after rain')
  await user.type(screen.getByLabelText('Confirm new password'), 'a quiet orchard after rain')
  await user.dblClick(screen.getByRole('button', { name: 'Change password' }))
  expect(fetcher).toHaveBeenCalledTimes(2)
  expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled()
  // The workspace also has an empty AI-task alert region; target the password form's errors.
  const passwordSection = within(screen.getByRole('region', { name: 'Change your password' }))
  complete(new Response(JSON.stringify({ errors: ['Too many requests. Try again later.'] }), { status: 429 }))
  expect(await passwordSection.findByRole('alert')).toHaveTextContent('Too many requests')
  await user.click(screen.getByRole('button', { name: 'Change password' }))
  expect(await passwordSection.findByRole('alert')).toHaveTextContent('Could not reach the server')
  await user.click(screen.getByRole('button', { name: 'Change password' }))
  expect(await passwordSection.findByRole('alert')).toHaveTextContent('Current password is invalid')
  expect(screen.getByLabelText('Current password')).toHaveAttribute('aria-invalid', 'true')
  expect(screen.getByLabelText('Confirm new password')).toHaveAttribute('aria-invalid', 'true')
  expect(passwordSection.getByRole('alert').parentElement).toHaveFocus()
  expect(screen.getByLabelText('New password')).toHaveAttribute('autocomplete', 'new-password')
  expect(screen.getByLabelText('New password')).not.toHaveAttribute('maxlength')
})

it('refreshes successful public recovery without switching an unrelated signed-in account', async () => {
  history.replaceState(null, '', '/reset-password#reset_password_token=private-reset-token')
  const { captureResetPasswordToken } = await import('./resetPasswordLink')
  captureResetPasswordToken()
  const signedIn = { user: { id: 'other', email: 'other@example.com', name: 'Other' }, csrfToken: 'csrf' }
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(signedIn)))
    .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Password reset.' })))
    .mockResolvedValueOnce(new Response(JSON.stringify(signedIn)))
  vi.stubGlobal('fetch', fetcher)
  render(<AuthProvider><SessionApolloProvider><RouterProvider router={createMemoryRouter(appRoutes, { initialEntries: ['/reset-password'] })} /></SessionApolloProvider></AuthProvider>)
  const user = userEvent.setup()
  await user.type(await screen.findByLabelText('New password'), 'a quiet orchard after rain')
  await user.type(screen.getByLabelText('Confirm new password'), 'a quiet orchard after rain')
  await user.click(screen.getByRole('button', { name: 'Reset password' }))
  expect(await screen.findByRole('heading', { name: 'Password updated' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Continue with your signed-in account' })).toHaveAttribute('href', '/library')
})

it('clears an expired account session and shows a sign-in notice after change returns 401', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ user: { id: 'account', email: 'user@example.com', name: 'User' }, csrfToken: 'csrf' })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ errors: ['Sign in again'] }), { status: 401 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ user: null, csrfToken: 'fresh-csrf' })))
  vi.stubGlobal('fetch', fetcher)
  render(<AuthProvider><SessionApolloProvider><RouterProvider router={createMemoryRouter(appRoutes, { initialEntries: ['/account/security'] })} /></SessionApolloProvider></AuthProvider>)
  const user = userEvent.setup()
  await user.type(await screen.findByLabelText('Current password'), 'old password')
  await user.type(screen.getByLabelText('New password'), 'a quiet orchard after rain')
  await user.type(screen.getByLabelText('Confirm new password'), 'a quiet orchard after rain')
  await user.click(screen.getByRole('button', { name: 'Change password' }))
  expect(await screen.findByText('Your session expired. Sign in again to change your password.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
})
