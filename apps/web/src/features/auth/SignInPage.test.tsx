/**
 * Description: Sign-in flow: a successful sign-in stores the token and returns to the requested
 * page; a failed one shows the server's message.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import { AuthProvider } from './AuthProvider'
import { readAuthToken, saveAuthToken } from './authTokenStorage'
import { RequireAuth, RequireSignedOut } from './RequireAuth'
import { SignInPage } from './SignInPage'

function renderApp(initialUrl: string) {
  const router = createMemoryRouter(
    [
      { element: <RequireSignedOut />, children: [{ path: '/sign-in', element: <SignInPage /> }] },
      {
        element: <RequireAuth />,
        children: [
          { path: '/', element: <p>Home page</p> },
          { path: '/library', element: <p>Library page</p> },
        ],
      },
    ],
    { initialEntries: [initialUrl] },
  )
  render(
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>,
  )
}

async function submitCredentials(password: string) {
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('Email'), 'ada@example.com')
  await user.type(screen.getByLabelText('Password'), password)
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
}

afterEach(() => vi.unstubAllGlobals())

it('redirects to sign-in, then back to the requested page once signed in', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { headers: { Authorization: 'Bearer jwt-1' } })))
  renderApp('/library')

  await submitCredentials('password123')

  expect(await screen.findByText('Library page')).toBeInTheDocument()
  expect(readAuthToken()).toBe('jwt-1')
})

it('sends users who are already signed in to the home page', async () => {
  saveAuthToken('existing-jwt')
  renderApp('/sign-in')
  expect(await screen.findByText('Home page')).toBeInTheDocument()
})

it('shows the error message when sign-in fails', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Invalid Email or password.' }), { status: 401 })),
  )
  renderApp('/sign-in')

  await submitCredentials('wrong')

  expect(await screen.findByText('Invalid Email or password.')).toBeInTheDocument()
  expect(readAuthToken()).toBeNull()
})
