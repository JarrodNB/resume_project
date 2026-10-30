/** Check cookie/CSRF transport and per-interview snapshots in the real session cache. */
import { gql } from '@apollo/client'
import { afterEach, expect, it, vi } from 'vitest'
import { createApolloClient } from './createApolloClient'
const { disconnect, createConsumer } = vi.hoisted(() => ({ disconnect: vi.fn(), createConsumer: vi.fn() }))
vi.mock('@rails/actioncable', () => ({ createConsumer: createConsumer.mockImplementation(() => ({ disconnect })) }))
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })
const query = gql`query { me { email } }`
it('keeps returned vacancy labels separate across interviews for the same live job', () => {
  const session = createApolloClient({ signedIn: false, csrfToken: 'csrf', onUnauthorized: vi.fn() })
  const history = gql`query { recentInterviewSessions { id jobContext { id title company } } }`
  session.client.writeQuery({ query: history, data: { recentInterviewSessions: [
    { __typename: 'InterviewSession', id: 'older-interview', jobContext: { __typename: 'InterviewJobContext', id: 'same-job', title: 'Original role', company: 'Original company' } },
    { __typename: 'InterviewSession', id: 'newer-interview', jobContext: { __typename: 'InterviewJobContext', id: 'same-job', title: 'Edited role', company: 'Edited company' } },
  ] } })
  const saved = session.client.readQuery<{ recentInterviewSessions: { jobContext: { title: string; company: string } }[] }>({ query: history })
  expect(saved?.recentInterviewSessions.map(({ jobContext }) => [jobContext.title, jobContext.company])).toEqual([
    ['Original role', 'Original company'], ['Edited role', 'Edited company'],
  ])
  session.dispose()
})
it('retains saved job details when history refreshes only the navigation and labels', () => {
  const session = createApolloClient({ signedIn: false, csrfToken: 'csrf', onUnauthorized: vi.fn() })
  const detail = gql`query { interviewSession(id: "saved") { id jobContext { id title company description } } }`
  const history = gql`query { recentInterviewSessions { id jobContext { id title company } } }`
  const job = { __typename: 'InterviewJobContext', id: 'job', title: 'Saved role', company: 'Saved company' }
  session.client.writeQuery({ query: detail, data: { interviewSession: {
    __typename: 'InterviewSession', id: 'saved', jobContext: { ...job, description: 'Frozen responsibilities.' },
  } } })
  session.client.writeQuery({ query: history, data: { recentInterviewSessions: [
    { __typename: 'InterviewSession', id: 'saved', jobContext: null },
  ] } })
  const saved = session.client.readQuery<{ interviewSession: { jobContext: { id: string | null; description: string } } }>({ query: detail })
  expect(saved?.interviewSession.jobContext).toBeNull()
  session.dispose()
})
it('keeps a deleted job link detached when an older response arrives at the same turn revision', async () => {
  const savedInterview = gql`query { interviewSession(id: "saved") { id revision jobContext { id title company } } }`
  const job = { __typename: 'InterviewJobContext', title: 'Frozen role', company: 'Saved company' }
  const response = (id: string | null) => new Response(JSON.stringify({ data: { interviewSession: {
    __typename: 'InterviewSession', id: 'saved', revision: 1, jobContext: id === null ? null : { ...job, id },
  } } }), { headers: { 'Content-Type': 'application/json' } })
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response(null)).mockResolvedValueOnce(response('deleted-job')))
  const session = createApolloClient({ signedIn: false, csrfToken: 'csrf', onUnauthorized: vi.fn() })
  await session.client.query({ query: savedInterview, fetchPolicy: 'network-only' })
  await session.client.query({ query: savedInterview, fetchPolicy: 'network-only' })
  const saved = session.client.readQuery<{ interviewSession: { revision: number; jobContext: { id: string | null } } }>({ query: savedInterview })
  expect(saved?.interviewSession).toMatchObject({ revision: 1, jobContext: null })
  session.dispose()
})
it('sends credentials and CSRF without exposing a session credential in the socket URL', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { me: { email: 'ada@example.com' } } }), { headers: { 'Content-Type': 'application/json' } }))
  vi.stubGlobal('fetch', fetch)
  const session = createApolloClient({ signedIn: true, csrfToken: 'csrf', onUnauthorized: vi.fn() })
  await session.client.query({ query })
  const options = fetch.mock.calls[0][1]
  expect(options.credentials).toBe('include')
  expect(new Headers(options.headers).get('X-CSRF-Token')).toBe('csrf')
  expect(new Headers(options.headers).get('Authorization')).toBeNull()
  expect(createConsumer).toHaveBeenCalledWith('ws://localhost:3000/cable')
  session.dispose()
  expect(disconnect).toHaveBeenCalledOnce()
  const next = createApolloClient({ signedIn: true, csrfToken: 'new-csrf', onUnauthorized: vi.fn() })
  expect(next.client.readQuery({ query })).toBeNull()
  next.dispose()
})
it('expires auth on an HTTP 401', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } })))
  const onUnauthorized = vi.fn()
  const session = createApolloClient({ signedIn: true, csrfToken: 'csrf', onUnauthorized })
  await expect(session.client.query({ query })).rejects.toThrow()
  expect(onUnauthorized).toHaveBeenCalledOnce()
  session.dispose()
})

it.each([
  [{ code: 'invalid_csrf', errors: ['Invalid CSRF token'] }, true],
  [{ errors: ['Ordinary validation error'] }, false],
])('refreshes session state only for an explicit CSRF rejection', async (body, invalid) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 422, headers: { 'Content-Type': 'application/json' } })))
  const onUnauthorized = vi.fn()
  const session = createApolloClient({ signedIn: true, csrfToken: 'old-csrf', onUnauthorized })
  await expect(session.client.query({ query })).rejects.toThrow()
  expect(onUnauthorized).toHaveBeenCalledTimes(invalid ? 1 : 0)
  session.dispose()
})
