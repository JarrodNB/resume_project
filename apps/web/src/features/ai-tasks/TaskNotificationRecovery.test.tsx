/** Exercises recovery and tab coordination through rendered notices and GraphQL transport. */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ApolloClient, ApolloLink, InMemoryCache, Observable } from '@apollo/client'
import { ApolloProvider } from '@apollo/client/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { TaskNotifications } from './TaskNotifications'

function event(sequence: number, status = 'COMPLETED') {
  return { sequence, __typename: 'AiTaskOutcome', id: `outcome-${sequence}`, taskId: 'same-task', status,
    title: `Task ${sequence} ${status.toLowerCase()}`, destination: '/library', completedAt: '2026-10-26T00:00:00Z' }
}

function server(events = [event(1)], pageSize = 100) {
  const observers: Array<{ next: (value: ApolloLink.Result) => void; error: (error: Error) => void }> = []
  let paused = false
  let queryFailure = false
  const pending: Array<() => void> = []
  const queries = vi.fn()
  const link = new ApolloLink((operation) => new Observable((observer) => {
    if (operation.operationName === 'TaskOutcome') { observers.push(observer); return }
    queries(operation.variables)
    if (queryFailure) { queryFailure = false; observer.error(new Error('temporarily unavailable')); return }
    const rows = events.filter((item) => BigInt(item.sequence) > BigInt(operation.variables.after) && BigInt(item.sequence) <= BigInt(operation.variables.through)).sort((a, b) => a.sequence - b.sequence)
    const page = rows.slice(0, pageSize)
    const maximum = Math.max(0, ...events.map((item) => item.sequence))
    const respond = () => {
      observer.next({ data: { taskOutcomes: { __typename: 'AiTaskOutcomePage', cursor: rows.length > pageSize ? String(page.at(-1)!.sequence) : String(Math.min(maximum, Number(operation.variables.through))), hasMore: rows.length > pageSize, outcomes: page } } })
      observer.complete()
    }
    if (paused) pending.push(respond)
    else respond()
  }))
  const client = new ApolloClient({ link, cache: new InMemoryCache() })
  return { client, queries, events, failNextQuery() { queryFailure = true }, subscriptions: () => observers.length, pause() { paused = true }, resume() { paused = false; pending.splice(0).forEach((respond) => respond()) }, fail() { observers.forEach((observer) => observer.error(new Error('disconnected'))) }, emit(cursor: string, outcome: ReturnType<typeof event> | null = null) {
    act(() => observers.forEach((observer) => observer.next({ data: { aiTaskFinished: { __typename: 'AiTaskOutcomeFeed', cursor, outcome } } })))
  } }
}

function mount(source: ReturnType<typeof server>, initialCursor = '0', owner = 'owner-1') {
  const router = createMemoryRouter([{ path: '*', element: <TaskNotifications userId={owner} initialCursor={initialCursor} /> }])
  const view = render(<ApolloProvider client={source.client}><RouterProvider router={router} /></ApolloProvider>)
  fireEvent.click(within(view.container).getByRole('button', { name: 'Notifications' }))
  return view
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('recovers a fast completion between bootstrap and subscription registration', async () => {
  const source = server()
  mount(source)
  source.emit('1')
  expect(await screen.findByText('Task 1 completed')).toBeInTheDocument()
  expect(source.queries).toHaveBeenCalledWith({ after: '0', through: '1' })
})


it('does not replay history on first use and recovers reconnects in ordered pages', async () => {
  const source = server([event(1), event(2, 'FAILED'), event(3)], 1)
  mount(source, '1')
  source.emit('1')
  await waitFor(() => expect(localStorage.getItem('careergrind.taskOutcomes.owner-1')).toBe('1'))
  expect(screen.queryByText('Task 1 completed')).not.toBeInTheDocument()
  source.emit('3') // A new initial subscription message after reconnect.
  expect(await screen.findByText('Task 2 failed')).toBeInTheDocument()
  expect(await screen.findByText('Task 3 completed')).toBeInTheDocument()
  expect(source.queries).toHaveBeenCalledWith({ after: '2', through: '3' })
  expect(screen.queryByText('Task 1 completed')).not.toBeInTheDocument()
})

it('queries the complete range when live broadcasts arrive out of order', async () => {
  const source = server([event(1, 'FAILED'), event(2)])
  mount(source)
  source.emit('0')
  source.emit('2', event(2))
  expect(await screen.findByText('Task 1 failed')).toBeInTheDocument()
  expect(await screen.findByText('Task 2 completed')).toBeInTheDocument()
  source.emit('1', event(1, 'FAILED'))
  await act(async () => { await Promise.resolve() })
  expect(screen.getAllByText('Task 1 failed')).toHaveLength(1)
})

it('retains hidden outcomes across refresh and delivers them on becoming visible', async () => {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
  const source = server()
  const first = mount(source)
  source.emit('1')
  await waitFor(() => expect(localStorage.getItem('careergrind.taskOutcomes.owner-1')).toBe('0'))
  expect(screen.queryByText('Task 1 completed')).not.toBeInTheDocument()
  expect(source.queries).not.toHaveBeenCalled()
  first.unmount()
  mount(source, '1') // Fresh bootstrap would otherwise baseline past the unseen outcome.
  source.emit('1')
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  act(() => document.dispatchEvent(new Event('visibilitychange')))
  expect(await screen.findByText('Task 1 completed')).toBeInTheDocument()
})

it('delivers an occurrence once across two visible tabs using the shared owner lock', async () => {
  let tail = Promise.resolve()
  const request = vi.fn((_name: string, callback: () => Promise<void>) => {
    const next = tail.then(callback)
    tail = next.catch(() => {})
    return next
  })
  vi.stubGlobal('navigator', { locks: { request } })
  const first = server()
  const second = server()
  mount(first)
  mount(second)
  first.emit('1')
  second.emit('1')
  await waitFor(() => expect(localStorage.getItem('careergrind.taskOutcomes.owner-1')).toBe('1'))
  expect(screen.getAllByText('New notification: Task 1 completed')).toHaveLength(1)
  expect(request).toHaveBeenCalled()
})

it('falls back safely for malformed or unavailable storage and keeps accounts isolated', async () => {
  localStorage.setItem('careergrind.taskOutcomes.owner-1', '{broken')
  localStorage.setItem('careergrind.taskOutcomes.someone-else', '999')
  const source = server()
  mount(source)
  source.emit('1')
  expect(await screen.findByText('Task 1 completed')).toBeInTheDocument()
  expect(localStorage.getItem('careergrind.taskOutcomes.someone-else')).toBe('999')
})

it('keeps live delivery and duplicate prevention working when storage throws', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
  const source = server()
  mount(source)
  source.emit('1')
  expect(await screen.findByText('Task 1 completed')).toBeInTheDocument()
  source.emit('1', event(1))
  await act(async () => { await Promise.resolve() })
  expect(screen.getAllByText('New notification: Task 1 completed')).toHaveLength(1)
})


it('does not replay dismissed notices when reads work but storage writes fail', async () => {
  localStorage.setItem('careergrind.taskOutcomes.owner-1', '0')
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
  const source = server([event(1), event(2)])
  mount(source)
  source.emit('1')
  await screen.findByText('Task 1 completed')
  await userEvent.setup().click(screen.getByRole('button', { name: 'Dismiss Task 1 completed' }))
  source.emit('2')
  await screen.findByText('Task 2 completed')
  expect(source.queries).toHaveBeenLastCalledWith({ after: '1', through: '2' })
  expect(screen.queryByText('Task 1 completed')).not.toBeInTheDocument()
})

it('ignores old account queries that finish after the host unmounts', async () => {
  const source = server()
  source.pause()
  const mounted = mount(source)
  source.emit('1')
  await waitFor(() => expect(source.queries).toHaveBeenCalled())
  mounted.unmount()
  act(() => source.resume())
  expect(screen.queryByText('Task 1 completed')).not.toBeInTheDocument()
  expect(localStorage.getItem('careergrind.taskOutcomes.owner-1')).toBe('0')
})

it('recovers events arriving during a catch-up request without skipping the live tail', async () => {
  const source = server([event(1), event(2)])
  source.pause()
  mount(source)
  source.emit('1')
  await waitFor(() => expect(source.queries).toHaveBeenCalledTimes(1))
  source.emit('2', event(2))
  act(() => source.resume())
  expect(await screen.findByText('Task 1 completed')).toBeInTheDocument()
  expect(await screen.findByText('Task 2 completed')).toBeInTheDocument()
  expect(localStorage.getItem('careergrind.taskOutcomes.owner-1')).toBe('2')
})

it('validates a future checkpoint and resumes new outcomes without historical replay', async () => {
  localStorage.setItem('careergrind.taskOutcomes.owner-1', '999999')
  const source = server()
  mount(source, '1')
  source.emit('1')
  await waitFor(() => expect(localStorage.getItem('careergrind.taskOutcomes.owner-1')).toBe('1'))
  expect(screen.queryByText('Task 1 completed')).not.toBeInTheDocument()
  source.events.push(event(2))
  source.emit('2', event(2))
  expect(await screen.findByText('Task 2 completed')).toBeInTheDocument()
})

it('reopens a terminally errored subscription on online without polling', async () => {
  const source = server()
  mount(source)
  source.emit('0')
  await act(async () => { await Promise.resolve() })
  await act(async () => source.fail())
  act(() => window.dispatchEvent(new Event('online')))
  await waitFor(() => expect(source.subscriptions()).toBe(2))
  source.emit('1')
  expect(await screen.findByText('Task 1 completed')).toBeInTheDocument()
})


it('preserves a valid sibling-tab checkpoint newer than a stale handshake', async () => {
  localStorage.setItem('careergrind.taskOutcomes.owner-1', '2')
  const source = server([event(1), event(2)])
  mount(source, '1')
  source.emit('1')
  await waitFor(() => expect(source.queries).toHaveBeenCalledWith({ after: '2', through: '2' }))
  expect(localStorage.getItem('careergrind.taskOutcomes.owner-1')).toBe('2')
  expect(screen.getByText('You’re all caught up')).toBeInTheDocument()
})

it('leaves an in-flight hidden outcome recoverable instead of acknowledging it', async () => {
  const source = server()
  source.pause()
  mount(source)
  source.emit('1')
  await waitFor(() => expect(source.queries).toHaveBeenCalledTimes(1))
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
  await act(async () => source.resume())
  expect(localStorage.getItem('careergrind.taskOutcomes.owner-1')).toBe('0')
  expect(screen.queryByText('Task 1 completed')).not.toBeInTheDocument()
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  act(() => document.dispatchEvent(new Event('visibilitychange')))
  expect(await screen.findByText('Task 1 completed')).toBeInTheDocument()
})

it('retains the checkpoint on query failure and retries on online without polling', async () => {
  const source = server()
  source.failNextQuery()
  mount(source)
  source.emit('1')
  await waitFor(() => expect(source.queries).toHaveBeenCalledTimes(1))
  expect(localStorage.getItem('careergrind.taskOutcomes.owner-1')).toBe('0')
  expect(screen.queryByText('Task 1 completed')).not.toBeInTheDocument()
  act(() => window.dispatchEvent(new Event('online')))
  expect(await screen.findByText('Task 1 completed')).toBeInTheDocument()
})
