/** The real route table protects job search and shows it as the Find jobs tab under Jobs. */
import { render, screen, within } from '@testing-library/react'
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
  const router = createMemoryRouter(appRoutes, { initialEntries: ['/jobs/find'] })
  render(<AuthProvider><MockedProvider><RouterProvider router={router} /></MockedProvider></AuthProvider>)
  return router
}

it('sends a signed-out job search visit to sign in', async () => {
  const router = renderRoutes()
  await screen.findByRole('button', { name: 'Sign in' })
  expect(router.state.location.pathname).toBe('/sign-in')
  expect(router.state.location.state).toEqual({ from: '/jobs/find' })
})

it('selects the Find jobs tab inside Jobs for signed-in users', async () => {
  renderRoutes({ id: 'job-board-reader', email: 'reader@example.test', name: 'Reader' })
  await screen.findByRole('heading', { name: 'Find jobs', level: 1 })
  const tabs = screen.getByRole('navigation', { name: 'Jobs pages' })
  expect(within(tabs).getByRole('link', { name: 'Find jobs' })).toHaveAttribute('aria-current', 'page')
  expect(within(tabs).getByRole('link', { name: 'Saved jobs' })).toHaveAttribute('href', '/jobs')
  expect(within(screen.getByRole('navigation', { name: 'Main navigation' })).getByRole('link', { name: 'Jobs' })).toHaveAttribute('aria-current', 'page')
  expect(screen.getByText('Find a role worth your next step.')).toBeInTheDocument()
})
