/** Checks task outcome notices through the persistent signed-in layout and real subscription. */
import { act, render, screen, waitFor, within } from '@testing-library/react'
import { ApolloClient, ApolloLink, InMemoryCache, Observable } from '@apollo/client'
import { ApolloProvider } from '@apollo/client/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { AuthContext, type AuthContextValue } from '@/features/auth/authContext'
import { AppLayout } from '@/components/AppLayout'

const auth: AuthContextValue = {
  user: { id: 'user-1', email: 'test@example.com', name: 'Test' }, csrfToken: 'csrf', taskOutcomeCursor: '0',
  signIn: vi.fn(), signUp: vi.fn(), signOut: vi.fn(), expireSession: vi.fn(),
}

function outcome(overrides = {}) {
  return { __typename: 'AiTaskOutcome', id: 'outcome-1', taskId: 'task-1', status: 'COMPLETED',
    title: 'Gap analysis completed', destination: '/jobs/job-1', completedAt: '2026-10-26T00:00:00Z', ...overrides }
}

function renderNotices() {
  const observers: Array<{ next: (value: ApolloLink.Result) => void }> = []
  const outcomes = new Map<string, { cursor: string; value: ReturnType<typeof outcome> }>()
  const transport = new ApolloLink((operation) => new Observable((observer) => {
    if (operation.operationName === 'TaskOutcome') { observers.push(observer); return }
    const rows = [...outcomes.values()].filter((item) => BigInt(item.cursor) > BigInt(operation.variables.after) && BigInt(item.cursor) <= BigInt(operation.variables.through))
    observer.next({ data: { taskOutcomes: { __typename: 'AiTaskOutcomePage', cursor: operation.variables.through, hasMore: false, outcomes: rows.map((item) => item.value) } } })
    observer.complete()
  }))
  const link = { simulateResult(payload: { result: { data: { aiTaskFinished: { cursor: string; outcome: ReturnType<typeof outcome> | null; __typename: string } } } }) {
    const feed = payload.result.data.aiTaskFinished
    if (feed.outcome) outcomes.set(feed.outcome.id, { cursor: feed.cursor, value: feed.outcome })
    observers.forEach((observer) => observer.next(payload.result))
  } }
  const client = new ApolloClient({ cache: new InMemoryCache(), link: transport })
  const router = createMemoryRouter([{ element: <AppLayout />, children: [
    { path: '/jobs/:id', element: <p>Current job page</p> },
    { path: '/library', element: <p>Library page</p> },
  ] }], { initialEntries: ['/jobs/job-1'] })
  const tree = (session: AuthContextValue) => <AuthContext value={session}><ApolloProvider client={client}><RouterProvider router={router} /></ApolloProvider></AuthContext>
  const rendered = render(tree(auth))
  return { link, router, client, changeSession: (session: AuthContextValue) => rendered.rerender(tree(session)) }
}

function emit(link: ReturnType<typeof renderNotices>['link'], value = outcome(), cursor = '1') {
  act(() => link.simulateResult({ result: { data: { aiTaskFinished: {
    __typename: 'AiTaskOutcomeFeed', cursor, outcome: value,
  } } } }))
}

it('announces new outcomes without opening the inbox or moving focus, then marks them read on open', async () => {
  const { link } = renderNotices()
  const user = userEvent.setup()
  const focused = screen.getByRole('link', { name: 'Library' })
  focused.focus()
  emit(link)
  expect(await screen.findByRole('button', { name: 'Notifications, 1 unread' })).toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('New notification: Gap analysis completed')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(focused).toHaveFocus()
  await user.click(screen.getByRole('button', { name: 'Notifications, 1 unread' }))
  expect(screen.getByRole('link', { name: /Gap analysis completed View result/ })).toHaveAttribute('href', '/jobs/job-1')
  await user.keyboard('{Escape}')
  expect(screen.getByRole('button', { name: 'Notifications' })).toHaveFocus()
  emit(link, outcome({ id: 'outcome-2', title: 'Resume tailoring completed' }), '2')
  expect(await screen.findByRole('button', { name: 'Notifications, 1 unread' })).toBeInTheDocument()
})

it('announces a failure after navigation and supports keyboard dismissal in the inbox', async () => {
  const { link, router } = renderNotices()
  await act(() => router.navigate('/library'))
  emit(link, outcome({ id: 'failure-1', status: 'FAILED', title: 'Gap analysis failed' }))
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('New notification: Gap analysis failed'))
  await userEvent.setup().click(screen.getByRole('button', { name: 'Notifications, 1 unread' }))
  const inbox = screen.getByRole('dialog')
  expect(within(inbox).getByRole('link', { name: /Review task/ })).toHaveAttribute('href', '/jobs/job-1')
  within(inbox).getByRole('button', { name: 'Dismiss Gap analysis failed' }).focus()
  await userEvent.setup().keyboard('{Enter}')
  expect(within(inbox).queryByText('Gap analysis failed')).not.toBeInTheDocument()
  expect(within(inbox).getByText('You’re all caught up')).toBeInTheDocument()
  expect(inbox).toHaveFocus()
})

it('ignores duplicate outcomes and adds a new outcome after a retry of the same task', async () => {
  const { link } = renderNotices()
  emit(link)
  await screen.findByRole('button', { name: 'Notifications, 1 unread' })
  emit(link)
  await userEvent.setup().click(screen.getByRole('button', { name: 'Notifications, 1 unread' }))
  expect(screen.getAllByText('Gap analysis completed')).toHaveLength(1)
  await userEvent.setup().click(screen.getByRole('button', { name: 'Dismiss Gap analysis completed' }))
  emit(link)
  emit(link, outcome({ id: 'new-outcome', title: 'Gap analysis failed', status: 'FAILED' }), '2')
  expect(await screen.findByText('Gap analysis failed')).toBeInTheDocument()
  expect(screen.queryByText('Gap analysis completed')).not.toBeInTheDocument()
})

it('opens the result, closes the inbox, and removes the notice', async () => {
  const { link, router } = renderNotices()
  emit(link, outcome({ destination: '/library' }))
  await userEvent.setup().click(await screen.findByRole('button', { name: 'Notifications, 1 unread' }))
  await userEvent.setup().click(screen.getByRole('link', { name: /View result/ }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/library'))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  await userEvent.setup().click(screen.getByRole('button', { name: 'Notifications' }))
  expect(screen.getByText('You’re all caught up')).toBeInTheDocument()
})

it('clears the inbox and its unread count when another account takes over or signs out', async () => {
  const { link, changeSession } = renderNotices()
  emit(link)
  await screen.findByRole('button', { name: 'Notifications, 1 unread' })
  changeSession({ ...auth, user: { id: 'user-2', email: 'other@example.com', name: 'Other' } })
  await userEvent.setup().click(screen.getByRole('button', { name: 'Notifications' }))
  expect(screen.getByText('You’re all caught up')).toBeInTheDocument()
  changeSession({ ...auth, user: null })
  expect(screen.queryByRole('button', { name: /Notifications/ })).not.toBeInTheDocument()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})
