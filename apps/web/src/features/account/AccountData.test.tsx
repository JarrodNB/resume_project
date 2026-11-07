/** Exercises the data export and password-confirmed account deletion through real auth state. */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { afterEach, expect, it, vi } from 'vitest'
import { appRoutes } from '@/appRoutes'
import { AuthProvider } from '@/features/auth/AuthProvider'
import { SessionApolloProvider } from '@/graphql/SessionApolloProvider'

const signedIn = { user: { id: 'account', email: 'user@example.com', name: 'User' }, csrfToken: 'csrf' }
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

function renderAccountPage(fetcher: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('fetch', fetcher)
  const router = createMemoryRouter(appRoutes, { initialEntries: ['/account/security'] })
  render(<AuthProvider><SessionApolloProvider><RouterProvider router={router} /></SessionApolloProvider></AuthProvider>)
  return router
}

it('deletes the account only after the current password, then shows a public confirmation', async () => {
  const broadcasts: string[] = []
  vi.stubGlobal('BroadcastChannel', class {
    onmessage: (() => void) | null = null
    postMessage(message: string) { broadcasts.push(message) }
    close() {}
  })
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(signedIn)))
    .mockResolvedValueOnce(new Response(JSON.stringify({ errors: ['Current password is incorrect'] }), { status: 422 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Deleted' })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ user: null, csrfToken: 'fresh-csrf' })))
  const router = renderAccountPage(fetcher)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'Delete account…' }))
  const dialog = screen.getByRole('dialog', { name: 'Delete your account?' })
  expect(within(dialog).getByRole('button', { name: 'Delete account' })).toBeDisabled()

  await user.type(within(dialog).getByLabelText('Current password'), 'wrong password')
  await user.click(within(dialog).getByRole('button', { name: 'Delete account' }))
  expect(await within(dialog).findByText('Current password is incorrect')).toBeInTheDocument()
  expect(router.state.location.pathname).toBe('/account/security')

  await user.clear(within(dialog).getByLabelText('Current password'))
  await user.type(within(dialog).getByLabelText('Current password'), 'a quiet orchard after rain')
  await user.click(within(dialog).getByRole('button', { name: 'Delete account' }))
  expect(await screen.findByRole('heading', { name: 'Account deleted' })).toBeInTheDocument()
  expect(router.state.location.pathname).toBe('/account-deleted')
  expect(fetcher).toHaveBeenNthCalledWith(3, expect.stringContaining('/auth/account'), expect.objectContaining({
    method: 'DELETE', headers: expect.objectContaining({ 'X-CSRF-Token': 'csrf' }),
    body: JSON.stringify({ user: { current_password: 'a quiet orchard after rain' } }),
  }))
  expect(broadcasts).toEqual(['changed'])
})

it('downloads the export as a JSON file', async () => {
  const exportData = { format_version: 1, account: { email: 'user@example.com' } }
  const fetcher = vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith('/auth/session')
    ? signedIn : { data: { accountExport: exportData } })))
  const createObjectURL = vi.fn((_blob: Blob) => 'blob:export')
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }))
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  renderAccountPage(fetcher)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'Download my data' }))
  await vi.waitFor(() => expect(click).toHaveBeenCalled())
  const anchor = click.mock.contexts[0] as HTMLAnchorElement
  expect(anchor.download).toMatch(/^careergrind-export-\d{4}-\d{2}-\d{2}\.json$/)
  expect(JSON.parse(await createObjectURL.mock.calls[0][0].text())).toEqual(exportData)
  expect(fetcher).toHaveBeenCalledWith(expect.stringContaining('/graphql'), expect.anything())
})

it('shows the privacy policy and terms without signing in', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ user: null, csrfToken: 'csrf' }))))
  render(<AuthProvider><SessionApolloProvider><RouterProvider router={createMemoryRouter(appRoutes, { initialEntries: ['/privacy'] })} /></SessionApolloProvider></AuthProvider>)
  expect(await screen.findByRole('heading', { name: 'Privacy policy' })).toBeInTheDocument()
  expect(screen.getByText(/deleted 30 days after we finish reading them/)).toBeInTheDocument()
  await userEvent.setup().click(screen.getByRole('link', { name: 'Terms' }))
  expect(await screen.findByRole('heading', { name: 'Terms of service' })).toBeInTheDocument()
})
