/** Checks that the workspace shows the right section and tab for each page, and that old bookmarks still land. */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { expect, it, vi } from 'vitest'
import { AppLayout } from './AppLayout'
import { RedirectToPath } from './RedirectToPath'

const signOut = vi.fn()
vi.mock('@/features/auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'owner', email: 'owner@example.test', name: null }, signOut }) }))
vi.mock('@/features/ai-tasks/TaskNotifications', () => ({ TaskNotifications: () => null }))

function renderWorkspace(url: string) {
  const router = createMemoryRouter([
    { element: <AppLayout />, children: [{ path: '*', element: <p>Page body</p> }] },
  ], { initialEntries: [url] })
  render(<RouterProvider router={router} />)
  return router
}

it('selects the parent section and tab on a detail page', () => {
  renderWorkspace('/jobs/42/resume')
  const main = screen.getByRole('navigation', { name: 'Main navigation' })
  expect(within(main).getByRole('link', { name: 'Jobs' })).toHaveAttribute('aria-current', 'page')
  expect(within(main).getByRole('link', { name: 'Library' })).not.toHaveAttribute('aria-current')
  const tabs = screen.getByRole('navigation', { name: 'Jobs pages' })
  expect(within(tabs).getByRole('link', { name: 'Saved jobs' })).toHaveAttribute('aria-current', 'page')
  expect(within(tabs).getByRole('link', { name: 'Find jobs' })).toHaveAttribute('href', '/jobs/find')
})

it('prefers the most specific tab', () => {
  renderWorkspace('/library/import/task-1')
  const tabs = screen.getByRole('navigation', { name: 'Library pages' })
  expect(within(tabs).getByRole('link', { name: 'Import resume' })).toHaveAttribute('aria-current', 'page')
  expect(within(tabs).getByRole('link', { name: 'Career library' })).not.toHaveAttribute('aria-current')
})

it('keeps resumes under Jobs until they move into the job workspace', () => {
  renderWorkspace('/resumes/resume-1')
  expect(within(screen.getByRole('navigation', { name: 'Jobs pages' })).getByRole('link', { name: 'Resumes' })).toHaveAttribute('aria-current', 'page')
})

it('offers account security, theme, and sign out from the account menu', async () => {
  renderWorkspace('/practice/questions')
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Account menu' }))
  expect(screen.getByRole('menuitem', { name: 'Account security' })).toHaveAttribute('href', '/account/security')
  expect(screen.getByRole('menuitem', { name: /Switch to (dark|light) theme/ })).toBeInTheDocument()
  await user.click(screen.getByRole('menuitem', { name: 'Sign out' }))
  expect(signOut).toHaveBeenCalled()
})

it('redirects an old bookmark with its id and query string', () => {
  const router = createMemoryRouter([
    { path: '/import/:aiTaskId?', element: <RedirectToPath to="/library/import/:aiTaskId?" /> },
    { path: '/library/import/:aiTaskId?', element: <p>Import page</p> },
  ], { initialEntries: ['/import/task-7?from=email'] })
  render(<RouterProvider router={router} />)
  expect(screen.getByText('Import page')).toBeInTheDocument()
  expect(router.state.location.pathname).toBe('/library/import/task-7')
  expect(router.state.location.search).toBe('?from=email')
})
