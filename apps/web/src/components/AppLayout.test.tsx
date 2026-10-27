/** Checks that the workspace shows the right section and tab for each page, that old bookmarks still land,
 * and that focus mode hides the navigation without remounting the page underneath. */
import { act, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { expect, it, vi } from 'vitest'
import { AppLayout } from './AppLayout'
import { RedirectToPath } from './RedirectToPath'
import { useFocusMode } from './useFocusMode'

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

let focusPageMounts = 0
/** A stand-in live page: counts mounts and keeps local state so a remount would be visible. */
function FocusTogglingPage() {
  const [mountNumber] = useState(() => ++focusPageMounts)
  const [focused, setFocused] = useState(true)
  const [notes, setNotes] = useState('')
  useFocusMode(focused)
  return <div>
    <p>Mount {mountNumber}</p>
    <label>Notes <input value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
    <button type="button" onClick={() => setFocused((value) => !value)}>Toggle focus</button>
  </div>
}

function renderFocusWorkspace() {
  focusPageMounts = 0
  const router = createMemoryRouter([
    { element: <AppLayout />, children: [
      { path: '/practice/interviews/live', element: <FocusTogglingPage /> },
      { path: '*', element: <p>Page body</p> },
    ] },
  ], { initialEntries: ['/practice/interviews/live'] })
  render(<RouterProvider router={router} />)
  return router
}

it('hides navigation in focus mode and offers a way out of the interview room', () => {
  renderFocusWorkspace()
  expect(screen.queryByRole('navigation', { name: 'Main navigation' })).not.toBeInTheDocument()
  expect(screen.queryByRole('navigation', { name: 'Practice pages' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Account menu' })).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Leave interview room' })).toHaveAttribute('href', '/practice/interviews')
})

it('keeps the page mounted, with its state, while focus mode turns off and on', async () => {
  renderFocusWorkspace()
  const user = userEvent.setup()
  await user.type(screen.getByRole('textbox', { name: 'Notes' }), 'half-typed answer')
  await user.click(screen.getByRole('button', { name: 'Toggle focus' }))
  expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument()
  expect(screen.getByRole('navigation', { name: 'Practice pages' })).toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'Leave interview room' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Toggle focus' }))
  expect(screen.queryByRole('navigation', { name: 'Main navigation' })).not.toBeInTheDocument()
  expect(screen.getByText('Mount 1')).toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: 'Notes' })).toHaveValue('half-typed answer')
  expect(focusPageMounts).toBe(1)
})

it('restores navigation after leaving the focused page', async () => {
  const router = renderFocusWorkspace()
  await act(async () => { await router.navigate('/practice/questions') })
  expect(screen.getByText('Page body')).toBeInTheDocument()
  expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument()
  expect(screen.getByRole('navigation', { name: 'Practice pages' })).toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'Leave interview room' })).not.toBeInTheDocument()
})
