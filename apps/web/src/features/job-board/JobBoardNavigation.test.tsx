/** The real route table protects Job Board and gives it a distinct navigation location. */
import { render, screen } from '@testing-library/react'
import { MockedProvider } from '@apollo/client/testing/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import { appRoutes } from '@/appRoutes'
import { AuthProvider } from '@/features/auth/AuthProvider'
import type { SessionUser } from '@/features/auth/authApi'

afterEach(() => vi.unstubAllGlobals())

function renderRoutes(user: SessionUser | null = null) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (!url.endsWith('/auth/session')) throw new Error(`Unexpected request: ${url}`)
    return new Response(JSON.stringify({ user, csrfToken: 'test-csrf' }))
  }))
  const router = createMemoryRouter(appRoutes, { initialEntries: ['/job-board'] })
  render(<AuthProvider><MockedProvider><RouterProvider router={router} /></MockedProvider></AuthProvider>)
  return router
}

it('sends a signed-out Job Board visit to sign in', async () => {
  const router = renderRoutes()
  await screen.findByRole('button', { name: 'Sign in' })
  expect(router.state.location.pathname).toBe('/sign-in')
  expect(router.state.location.state).toEqual({ from: '/job-board' })
})

it('shows a separate active Job Board link for signed-in users', async () => {
  renderRoutes({ id: 'job-board-reader', email: 'reader@example.test', name: 'Reader' })
  await screen.findByRole('heading', { name: 'Job Board' })
  expect(screen.getByRole('link', { name: 'Job Board' })).toHaveAttribute('aria-current', 'page')
  expect(screen.getByRole('link', { name: 'Jobs' })).not.toHaveAttribute('aria-current')
  expect(screen.getByRole('link', { name: 'Jobs' })).toHaveAttribute('href', '/jobs')
  expect(screen.getByText('Find a role worth your next step.')).toBeInTheDocument()
})
