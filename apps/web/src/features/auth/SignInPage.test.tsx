/** Real route guards wait for bootstrap and keep network failure distinct from signed out. */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import { AuthProvider } from './AuthProvider'
import { useAuth } from './useAuth'
import { RequireAuth, RequireSignedOut } from './RequireAuth'
import { SignInPage } from './SignInPage'
import { productStorageKey } from '@/lib/productName'
const signedIn = { user: { id: '1', email: 'ada@example.com', name: 'Ada' }, csrfToken: 'new-csrf' }
const signedOut = { user: null, csrfToken: 'csrf' }
const json = (body: unknown) => new Response(JSON.stringify(body))
function SessionHome() {
  const { signOut } = useAuth()
  return <><p>Home page</p><button onClick={() => { void signOut().catch(() => {}) }}>Sign out</button></>
}
function renderApp(initialUrl: string) {
  const router = createMemoryRouter([
    { element: <RequireSignedOut />, children: [{ path: '/sign-in', element: <SignInPage /> }] },
    { element: <RequireAuth />, children: [{ path: '/', element: <SessionHome /> }, { path: '/library', element: <p>Library page</p> }] },
  ], { initialEntries: [initialUrl] })
  render(<AuthProvider><RouterProvider router={router} /></AuthProvider>)
}
async function submitCredentials(password: string) {
  const user = userEvent.setup()
  await user.type(await screen.findByLabelText('Email'), 'ada@example.com')
  await user.type(screen.getByLabelText('Password'), password)
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
}
afterEach(() => vi.unstubAllGlobals())
it('returns to the requested page after cookie sign-in and clears legacy credentials', async () => {
  localStorage.setItem(productStorageKey('authToken'), 'old-jwt')
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json(signedOut)).mockResolvedValueOnce(json(signedIn)))
  renderApp('/library')
  await submitCredentials('password123')
  expect(await screen.findByText('Library page')).toBeInTheDocument()
  expect(localStorage.getItem(productStorageKey('authToken'))).toBeNull()
})
it('restores a signed-in browser after refresh', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json(signedIn)))
  renderApp('/sign-in')
  expect(await screen.findByText('Home page')).toBeInTheDocument()
})
it('shows credential errors', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json(signedOut)).mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Invalid Email or password.' }), { status: 401 })))
  renderApp('/sign-in')
  await submitCredentials('wrong')
  expect(await screen.findByText('Invalid Email or password.')).toBeInTheDocument()
})
it('does not flash private routes while bootstrap is pending', () => {
  vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})))
  renderApp('/library')
  expect(screen.getByRole('status')).toHaveTextContent('Checking your session')
  expect(screen.queryByText('Library page')).not.toBeInTheDocument()
})
it('offers a retry after bootstrap network failure', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new TypeError('offline')).mockResolvedValueOnce(json(signedIn)))
  renderApp('/library')
  expect(await screen.findByRole('alert')).toHaveTextContent('We couldn’t load Careergrind')
  expect(screen.getByText('Something went wrong on our side. Please try again in a moment.')).toBeInTheDocument()
  expect(screen.queryByLabelText('Email')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
  expect(await screen.findByText('Library page')).toBeInTheDocument()
})
it('drops cached page state and ignores a stale bootstrap after another tab changes sessions', async () => {
  const channels: { onmessage: (() => void) | null }[] = []
  class FakeChannel {
    onmessage: (() => void) | null = null
    constructor() { channels.push(this) }
    close() {}
    postMessage() {}
  }
  vi.stubGlobal('BroadcastChannel', FakeChannel)
  let finishOld!: (value: Response) => void
  vi.stubGlobal('fetch', vi.fn()
    .mockImplementationOnce(() => new Promise<Response>((resolve) => { finishOld = resolve }))
    .mockResolvedValueOnce(json(signedOut)))
  renderApp('/library')
  const { act } = await import('@testing-library/react')
  await act(async () => channels[0].onmessage?.())
  expect(await screen.findByLabelText('Email')).toBeInTheDocument()
  await act(async () => finishOld(json(signedIn)))
  expect(screen.queryByText('Library page')).not.toBeInTheDocument()
})

it('refreshes stale anonymous CSRF state without replaying credentials', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(json(signedOut))
    .mockResolvedValueOnce(new Response(JSON.stringify({ code: 'invalid_csrf', errors: ['Invalid CSRF token'] }), { status: 422 }))
    .mockResolvedValueOnce(json({ ...signedOut, csrfToken: 'fresh-csrf' }))
    .mockResolvedValueOnce(json(signedIn))
  vi.stubGlobal('fetch', fetch)
  renderApp('/sign-in')
  await submitCredentials('a quiet orchard after rain')
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3))
  expect(await screen.findByLabelText('Password')).toHaveValue('')
  await submitCredentials('a quiet orchard after rain')
  expect(await screen.findByText('Home page')).toBeInTheDocument()
  expect(fetch.mock.calls[3][1].headers['X-CSRF-Token']).toBe('fresh-csrf')
})

it('recovers a stale signed-in cookie after a rejected logout without claiming a successful write', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(json(signedIn))
    .mockResolvedValueOnce(new Response(JSON.stringify({ code: 'invalid_csrf', errors: ['Invalid CSRF token'] }), { status: 422 }))
    .mockResolvedValueOnce(json(signedOut))
  vi.stubGlobal('fetch', fetch)
  renderApp('/')
  await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }))
  expect(await screen.findByLabelText('Email')).toBeInTheDocument()
  expect(screen.queryByText('Home page')).not.toBeInTheDocument()
  expect(fetch).toHaveBeenCalledTimes(3)
})
