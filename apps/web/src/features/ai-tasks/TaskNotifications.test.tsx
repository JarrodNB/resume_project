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

it('announces a successful task even on its current result page', async () => {
  const { link } = renderNotices()
  act(() => link.simulateResult({ result: { data: { aiTaskFinished: {
    __typename: 'AiTaskOutcomeFeed', cursor: '1', outcome: outcome(),
  } } } }))
  expect(await screen.findByText('Gap analysis completed')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'View result' })).toHaveAttribute('href', '/jobs/job-1')
})

it('shows a failure after navigation, without moving focus, and supports keyboard dismissal', async () => {
  const { link, router } = renderNotices()
  await act(() => router.navigate('/library'))
  const focused = screen.getByRole('link', { name: 'Career library' })
  focused.focus()
  act(() => link.simulateResult({ result: { data: { aiTaskFinished: {
    __typename: 'AiTaskOutcomeFeed', cursor: '2', outcome: outcome({ id: 'failure-1', status: 'FAILED', title: 'Gap analysis failed' }),
  } } } }))
  const notice = await screen.findByRole('alert')
  expect(within(notice).getByText('Gap analysis failed')).toBeInTheDocument()
  expect(within(notice).getByRole('link', { name: 'Review task' })).toHaveAttribute('href', '/jobs/job-1')
  expect(focused).toHaveFocus()
  within(notice).getByRole('button', { name: 'Dismiss Gap analysis failed' }).focus()
  await userEvent.setup().keyboard('{Enter}')
  expect(screen.queryByText('Gap analysis failed')).not.toBeInTheDocument()
})

it('ignores baseline snapshots and duplicates but announces a new outcome after retry of the same task', async () => {
  const { link } = renderNotices()
  const emit = (value: ReturnType<typeof outcome> | null, cursor = '1') => {
    act(() => link.simulateResult({ result: { data: { aiTaskFinished: {
      __typename: 'AiTaskOutcomeFeed', cursor, outcome: value,
    } } } }))
  }
  emit(null, '0')
  expect(screen.queryByLabelText('Task notifications')).not.toBeInTheDocument()
  emit(outcome())
  await screen.findByText('Gap analysis completed')
  emit(outcome())
  expect(await screen.findAllByText('Gap analysis completed')).toHaveLength(1)
  await userEvent.setup().click(screen.getByRole('button', { name: 'Dismiss Gap analysis completed' }))
  emit(outcome())
  emit(outcome({ id: 'new-outcome', title: 'Gap analysis failed', status: 'FAILED' }), '2')
  await screen.findByText('Gap analysis failed')
  expect(screen.queryByText('Gap analysis completed')).not.toBeInTheDocument()
})

it('opens the result with its action and removes the notice', async () => {
  const { link, router } = renderNotices()
  act(() => link.simulateResult({ result: { data: { aiTaskFinished: {
    __typename: 'AiTaskOutcomeFeed', cursor: '1', outcome: outcome({ destination: '/library' }),
  } } } }))
  await userEvent.setup().click(await screen.findByRole('link', { name: 'View result' }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/library'))
  expect(screen.queryByText('Gap analysis completed')).not.toBeInTheDocument()
})

it('clears notices on sign-out and when another account takes over', async () => {
  const { link, changeSession } = renderNotices()
  act(() => link.simulateResult({ result: { data: { aiTaskFinished: {
    __typename: 'AiTaskOutcomeFeed', cursor: '1', outcome: outcome(),
  } } } }))
  await screen.findByText('Gap analysis completed')
  changeSession({ ...auth, user: { id: 'user-2', email: 'other@example.com', name: 'Other' } })
  expect(screen.queryByText('Gap analysis completed')).not.toBeInTheDocument()
  changeSession({ ...auth, user: null })
  expect(screen.queryByLabelText('Task notifications')).not.toBeInTheDocument()
})
