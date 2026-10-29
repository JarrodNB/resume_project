/** Check all loaded roles explicitly; changing how results are displayed never buys new work. */
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { renderPage } from '@/test/renderPage'
import { ApolloProvider, useApolloClient } from '@apollo/client/react'
import { ApolloClient, InMemoryCache } from '@apollo/client'
import { MockLink } from '@apollo/client/testing'
import { MemoryRouter } from 'react-router'
import { CHECK_JOB_BOARD_PREFERENCE_RESULTS, JOB_PREFERENCE_CHECK_SUBSCRIPTION } from './preferenceCheckOperations'
import { JobBoardPage } from './JobBoardPage'
import { JOB_BOARD_SEARCH_QUERY } from './jobBoardOperations'
import { JOB_PREFERENCES_QUERY } from './jobPreferenceOperations'
import type { BoardListing } from './useJobBoardSearch'

type TestListing = BoardListing & { __typename: string; savedJob: { id: string; __typename: string } | null }
function listing(id: string): TestListing {
  return { __typename: 'JobBoardListing', applicationUrl: null, id, preferenceSourceDigest: `digest-${id}`, title: `${id} role`, company: 'Acme', location: 'US', description: 'Role details.', hasRemote: false, remoteType: null, published: null, employmentType: null, salaryText: null, salaryCurrency: null, savedJob: null }
}
const criteria = [
  { __typename: 'JobPreferenceCriterion' as const, id: 'must', text: 'Fully remote', priority: 'must_have' },
  { __typename: 'JobPreferenceCriterion' as const, id: 'nice', text: 'Climate work', priority: 'nice_to_have' },
]
const profile = { __typename: 'JobPreferenceProfile' as const, version: 2, confirmedRevision: 2, draftCriteria: criteria, confirmedCriteria: criteria }
function search(ids = ['conflict', 'unknown', 'match', 'tie'], keyword = 'engineer', cursor: string | null = null, nextCursor: string | null = null) {
  return { request: { query: JOB_BOARD_SEARCH_QUERY, variables: { keyword, remoteOnly: false, experienceLevels: [], cursor } }, result: { data: { jobBoardSearch: { __typename: 'JobBoardSearchPage', listings: ids.map(listing), nextCursor, retrievedAt: '2026-10-29T00:00:00Z', stale: false, errors: [] as string[] } } } }
}
function result(ids = ['conflict', 'unknown', 'match', 'tie']) {
  return { confirmed_revision: 2, listings: ids.map((id) => ({ id, source_digest: `digest-${id}`, truncated: false,
    evidence_passages: [{ passage_id: 'P1', text: 'Exact role evidence.' }],
    criteria: criteria.map((criterion, index) => {
      const status = index === 1 ? 'matching' : id === 'conflict' ? 'conflicting' : id === 'unknown' ? 'unknown' : 'matching'
      return { id: criterion.id, status, reason: status === 'matching' ? 'supported' : status === 'conflicting' ? 'contradicted' : 'not_stated',
        support: status === 'matching' ? { passage_id: 'P1' } : null, contradiction: status === 'conflicting' ? { passage_id: 'P1' } : null }
    }) })) }
}
function check(ids = ['conflict', 'unknown', 'match', 'tie'], extra = {}) {
  return { request: { query: CHECK_JOB_BOARD_PREFERENCE_RESULTS, variables: { confirmedRevision: 2, listings: ids.map((id) => ({ listingId: id, expectedDigest: `digest-${id}` })) } },
    result: { data: { checkJobBoardPreferenceResults: { __typename: 'CheckPreferenceResultsPayload', errors: [], aiTask: { __typename: 'AiTask', id: 'batch-1', status: 'COMPLETED', result: result(ids), errorMessage: null } } } }, ...extra }
}
function preferences() { return { request: { query: JOB_PREFERENCES_QUERY }, result: { data: { jobPreferences: profile } } } }
async function submit(user: ReturnType<typeof userEvent.setup>, keyword = 'engineer') {
  await user.clear(screen.getByRole('textbox', { name: 'Keyword or job title' }))
  await user.type(screen.getByRole('textbox', { name: 'Keyword or job title' }), keyword)
  await user.click(screen.getByRole('button', { name: 'Search jobs' }))
}
function titles() { return screen.getAllByRole('heading', { level: 2 }).map((item) => item.textContent) }

it('checks loaded results in one task and gives must-haves priority with stable ties', async () => {
  const user = userEvent.setup()
  const checked = vi.fn(() => check().result)
  renderPage({ path: '/jobs/find', url: '/jobs/find', element: <JobBoardPage />, mocks: [search(), preferences(), check(undefined, { result: checked })] })
  await submit(user)
  await screen.findByRole('heading', { name: 'conflict role' })
  expect(checked).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Check these results' }))
  await screen.findByText('Loaded roles checked against your confirmed preferences.')
  expect(titles()).toEqual(['match role', 'tie role', 'unknown role', 'conflict role'])
  expect(screen.getByRole('button', { name: 'Check these results' })).toBeDisabled()
  expect(screen.queryByText('Supports: Exact role evidence.')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Preference details for match role' }))
  expect(screen.getAllByText('Supports: Exact role evidence.').length).toBeGreaterThan(0)
  await user.selectOptions(screen.getByRole('combobox', { name: 'Result order' }), 'provider')
  expect(titles()).toEqual(['conflict role', 'unknown role', 'match role', 'tie role'])
  await user.selectOptions(screen.getByRole('combobox', { name: 'Result order' }), 'preferences')
  expect(titles()[0]).toBe('match role')
  expect(checked).toHaveBeenCalledOnce()
})

it('checks every loaded row before local paging and hiding saved rows, without new work on navigation', async () => {
  const user = userEvent.setup()
  const ids = Array.from({ length: 21 }, (_, index) => `role-${index}`)
  const searched = search(ids)
  searched.result.data.jobBoardSearch.listings[0] = { ...listing(ids[0]), savedJob: { __typename: 'Job', id: 'owned' } }
  const checked = vi.fn(() => check(ids).result)
  renderPage({ path: '/jobs/find', url: '/jobs/find', element: <JobBoardPage />, mocks: [searched, preferences(), check(ids, { result: checked })] })
  await submit(user)
  await screen.findByRole('heading', { name: 'role-0 role' })
  await user.click(screen.getByRole('button', { name: 'Check these results' }))
  await screen.findByText('Loaded roles checked against your confirmed preferences.')
  await user.click(screen.getByRole('button', { name: 'Next page' }))
  expect(screen.getByRole('heading', { name: 'role-20 role' })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Previous' }))
  await user.click(screen.getByRole('checkbox', { name: 'Hide already saved' }))
  expect(screen.queryByRole('heading', { name: 'role-0 role' })).not.toBeInTheDocument()
  expect(screen.getByText('Loaded roles checked against your confirmed preferences.')).toBeInTheDocument()
  expect(checked).toHaveBeenCalledOnce()
})

it('invalidates after fetching another provider page and requires an explicit recheck', async () => {
  const user = userEvent.setup()
  const ids = ['match', 'unknown']
  renderPage({ path: '/jobs/find', url: '/jobs/find', element: <JobBoardPage />, mocks: [search(ids, 'engineer', null, 'next'), preferences(), check(ids), search(['new'], 'engineer', 'next')] })
  await submit(user)
  await screen.findByRole('heading', { name: 'match role' })
  await user.click(screen.getByRole('button', { name: 'Check these results' }))
  await screen.findByText('Loaded roles checked against your confirmed preferences.')
  await user.click(screen.getByRole('button', { name: 'Next page' }))
  await screen.findByRole('heading', { name: 'new role' })
  expect(screen.queryByText('Loaded roles checked against your confirmed preferences.')).not.toBeInTheDocument()
  expect(screen.getByText(/Check these results again for a current assessment/)).toBeInTheDocument()
  expect(titles()).toEqual(['match role', 'unknown role', 'new role'])
})

function ProfileChanges() {
  const client = useApolloClient()
  return <>
    <button onClick={() => client.writeQuery({ query: JOB_PREFERENCES_QUERY, data: { jobPreferences: { ...profile, version: 3, draftCriteria: [{ ...criteria[0], text: 'Unconfirmed edit' }] } } })}>Save draft elsewhere</button>
    <button onClick={() => client.writeQuery({ query: JOB_PREFERENCES_QUERY, data: { jobPreferences: { ...profile, version: 4, confirmedRevision: 4 } } })}>Confirm new revision</button>
    <JobBoardPage />
  </>
}

it('keeps completed checks through draft edits but invalidates a new confirmed revision', async () => {
  const user = userEvent.setup()
  renderPage({ path: '/jobs/find', url: '/jobs/find', element: <ProfileChanges />, mocks: [search(), preferences(), check()] })
  await submit(user)
  await screen.findByRole('heading', { name: 'match role' })
  await user.click(screen.getByRole('button', { name: 'Check these results' }))
  await screen.findByText('Loaded roles checked against your confirmed preferences.')
  await user.click(screen.getByRole('button', { name: 'Save draft elsewhere' }))
  expect(screen.getByText('Loaded roles checked against your confirmed preferences.')).toBeInTheDocument()
  expect(titles()[0]).toBe('match role')
  await user.click(screen.getByRole('button', { name: 'Confirm new revision' }))
  expect(screen.queryByText('Loaded roles checked against your confirmed preferences.')).not.toBeInTheDocument()
  expect(screen.getByText(/Check these results again for a current assessment/)).toBeInTheDocument()
  expect(titles()[0]).toBe('conflict role')
})

it('ignores old mutation failures and busy state when a newer search replaces the candidates', async () => {
  const user = userEvent.setup()
  const old = check(undefined, { delay: 180, result: { data: { checkJobBoardPreferenceResults: { __typename: 'CheckPreferenceResultsPayload', errors: ['Old search failed'], aiTask: null } } } })
  renderPage({ path: '/jobs/find', url: '/jobs/find', element: <JobBoardPage />, mocks: [search(), preferences(), old, search(['new'], 'designer')] })
  await submit(user)
  await screen.findByRole('heading', { name: 'match role' })
  await user.click(screen.getByRole('button', { name: 'Check these results' }))
  await submit(user, 'designer')
  await screen.findByRole('heading', { name: 'new role' })
  expect(screen.getByRole('button', { name: 'Check these results' })).toBeEnabled()
  await act(() => new Promise((resolve) => setTimeout(resolve, 220)))
  expect(screen.queryByText('Old search failed')).not.toBeInTheDocument()
  expect(screen.queryByText('Loaded roles checked against your confirmed preferences.')).not.toBeInTheDocument()
})

it('follows a queued batch once and reports failure rather than fake unknown decisions', async () => {
  const user = userEvent.setup()
  const queued = check(undefined, { result: { data: { checkJobBoardPreferenceResults: { __typename: 'CheckPreferenceResultsPayload', errors: [], aiTask: { __typename: 'AiTask', id: 'batch-1', status: 'QUEUED', result: null, errorMessage: null } } } } })
  renderPage({ path: '/jobs/find', url: '/jobs/find', element: <JobBoardPage />, mocks: [search(), preferences(), queued,
    { request: { query: JOB_PREFERENCE_CHECK_SUBSCRIPTION, variables: { id: 'batch-1' } }, result: { data: { aiTaskUpdated: { __typename: 'AiTask', id: 'batch-1', status: 'FAILED', result: null, errorMessage: 'Provider unavailable. Retry this check.' } } } },
  ] })
  await submit(user)
  await screen.findByRole('heading', { name: 'match role' })
  await user.click(screen.getByRole('button', { name: 'Check these results' }))
  expect(await screen.findByText('Provider unavailable. Retry this check.')).toBeInTheDocument()
  expect(screen.queryByText('Unknown')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Check these results' })).toBeEnabled()
})

it('rejects incomplete or duplicate listing outcomes instead of applying partial ordering', async () => {
  const user = userEvent.setup()
  const value = result()
  value.listings[1] = value.listings[0]
  renderPage({ path: '/jobs/find', url: '/jobs/find', element: <JobBoardPage />, mocks: [search(), preferences(), check(undefined, { result: { data: { checkJobBoardPreferenceResults: { __typename: 'CheckPreferenceResultsPayload', errors: [], aiTask: { __typename: 'AiTask', id: 'bad', status: 'COMPLETED', result: value, errorMessage: null } } } } })] })
  await submit(user)
  await screen.findByRole('heading', { name: 'match role' })
  await user.click(screen.getByRole('button', { name: 'Check these results' }))
  expect(await screen.findByText('The check returned incomplete evidence. Please try again.')).toBeInTheDocument()
  expect(titles()[0]).toBe('conflict role')
})

it('rejects a late successful check after refreshing the same listing IDs and source digests', async () => {
  const user = userEvent.setup()
  const stale = search()
  stale.result.data.jobBoardSearch.stale = true
  stale.result.data.jobBoardSearch.errors = ['Refresh unavailable']
  renderPage({ path: '/jobs/find', url: '/jobs/find', element: <JobBoardPage />, mocks: [stale, preferences(), check(undefined, { delay: 180 }), search()] })
  await submit(user)
  await screen.findByRole('heading', { name: 'match role' })
  await user.click(screen.getByRole('button', { name: 'Check these results' }))
  await user.click(screen.getByRole('button', { name: 'Retry results' }))
  await screen.findByRole('heading', { name: 'conflict role' })
  await act(() => new Promise((resolve) => setTimeout(resolve, 220)))
  expect(screen.queryByText('Loaded roles checked against your confirmed preferences.')).not.toBeInTheDocument()
  expect(titles()[0]).toBe('conflict role')
  expect(screen.getByRole('button', { name: 'Check these results' })).toBeEnabled()
})

it('requires confirmed criteria before any batch mutation', async () => {
  const user = userEvent.setup()
  const empty = { request: { query: JOB_PREFERENCES_QUERY }, result: { data: { jobPreferences: { ...profile, confirmedCriteria: [] } } } }
  renderPage({ path: '/jobs/find', url: '/jobs/find', element: <JobBoardPage />, mocks: [search(), empty] })
  await submit(user)
  await screen.findByRole('heading', { name: 'match role' })
  await user.click(screen.getByRole('button', { name: 'Check these results' }))
  expect(await screen.findByText('Confirm your preferences in “What I want next” before checking.')).toBeInTheDocument()
  expect(titles()[0]).toBe('conflict role')
})

it('discloses omitted posting text even when every criterion has supporting evidence', async () => {
  const user = userEvent.setup()
  const value = result(['match'])
  value.listings[0].truncated = true
  renderPage({ path: '/jobs/find', url: '/jobs/find', element: <JobBoardPage />, mocks: [search(['match']), preferences(), check(['match'], { result: { data: { checkJobBoardPreferenceResults: { __typename: 'CheckPreferenceResultsPayload', errors: [], aiTask: { __typename: 'AiTask', id: 'excerpt', status: 'COMPLETED', result: value, errorMessage: null } } } } })] })
  await submit(user)
  await screen.findByRole('heading', { name: 'match role' })
  await user.click(screen.getByRole('button', { name: 'Check these results' }))
  expect(await screen.findByText('Checked an excerpt; some posting text was omitted.')).toBeInTheDocument()
  expect(screen.getByText('2 matching · 0 conflicting · 0 unknown')).toBeInTheDocument()
})

it('ignores an old subscription identity when the same listing IDs belong to a newer check', async () => {
  const user = userEvent.setup()
  const queued = (id: string) => ({ result: { data: { checkJobBoardPreferenceResults: { __typename: 'CheckPreferenceResultsPayload', errors: [], aiTask: { __typename: 'AiTask', id, status: 'QUEUED', result: null, errorMessage: null } } } } })
  renderPage({ path: '/jobs/find', url: '/jobs/find', element: <JobBoardPage />, mocks: [search(), preferences(), check(undefined, queued('batch-1')),
    { request: { query: JOB_PREFERENCE_CHECK_SUBSCRIPTION, variables: { id: 'batch-1' } }, delay: 600, result: { data: { aiTaskUpdated: { __typename: 'AiTask', id: 'batch-1', status: 'COMPLETED', result: result(), errorMessage: null } } } },
    search(undefined, 'designer'), preferences(), check(undefined, queued('batch-2')),
    { request: { query: JOB_PREFERENCE_CHECK_SUBSCRIPTION, variables: { id: 'batch-2' } }, result: { data: { aiTaskUpdated: { __typename: 'AiTask', id: 'batch-1', status: 'COMPLETED', result: result(), errorMessage: null } } } },
  ] })
  await submit(user)
  await screen.findByRole('heading', { name: 'match role' })
  await user.click(screen.getByRole('button', { name: 'Check these results' }))
  await submit(user, 'designer')
  await screen.findByRole('heading', { name: 'conflict role' })
  await user.click(screen.getByRole('button', { name: 'Check these results' }))
  await act(() => new Promise((resolve) => setTimeout(resolve, 30)))
  expect(screen.queryByText('Loaded roles checked against your confirmed preferences.')).not.toBeInTheDocument()
  expect(titles()[0]).toBe('conflict role')
})

it('discards private preference assessments when the signed-in session replaces its client', async () => {
  const user = userEvent.setup()
  const first = new ApolloClient({ cache: new InMemoryCache(), link: new MockLink([search(), preferences(), check()]) })
  const second = new ApolloClient({ cache: new InMemoryCache(), link: new MockLink([
    search(['new-account']),
    { request: { query: JOB_PREFERENCES_QUERY }, result: { data: { jobPreferences: { ...profile, version: 0, confirmedRevision: 0, draftCriteria: [], confirmedCriteria: [] } } } },
  ]) })
  const page = (client: ApolloClient) => <ApolloProvider client={client}><MemoryRouter><JobBoardPage /></MemoryRouter></ApolloProvider>
  const view = render(page(first))
  await submit(user)
  await screen.findByRole('heading', { name: 'match role' })
  await user.click(screen.getByRole('button', { name: 'Check these results' }))
  await screen.findByText('Loaded roles checked against your confirmed preferences.')
  view.rerender(page(second))
  expect(screen.queryByText('Loaded roles checked against your confirmed preferences.')).not.toBeInTheDocument()
  expect(screen.queryByText('Checked against your confirmed preferences.')).not.toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'conflict role' })).not.toBeInTheDocument()
  await screen.findByRole('heading', { name: 'new-account role' })
  expect(screen.getByRole('combobox', { name: 'Result order' })).toHaveValue('provider')
})


it.each([['COMPLETED', '/jobs/saved'], ['QUEUED', '/jobs/saved'], ['QUEUED', '/jobs/find?q=designer']])('restores a %s preference check after visiting %s during its mutation without buying another task', async (status, destination) => {
  const user = userEvent.setup()
  const checked = vi.fn(() => ({ data: { checkJobBoardPreferenceResults: { __typename: 'CheckPreferenceResultsPayload', errors: [], aiTask: {
    __typename: 'AiTask', id: 'batch-1', status, result: status === 'COMPLETED' ? result() : null, errorMessage: null,
  } } } }))
  const { router } = renderPage({ path: '/jobs/find', url: '/jobs/find?q=engineer', element: <JobBoardPage />,
    extraRoutes: [{ path: '/jobs/:id', element: <p>Saved job page</p> }], mocks: [search(), search(['other'], 'designer'), preferences(), check(undefined, { result: checked, delay: 200 }),
      ...(status === 'QUEUED' ? [{ request: { query: JOB_PREFERENCE_CHECK_SUBSCRIPTION, variables: { id: 'batch-1' } }, result: { data: { aiTaskUpdated: { __typename: 'AiTask', id: 'batch-1', status: 'COMPLETED', result: result(), errorMessage: null } } } }] : []),
    ] })
  await screen.findByRole('heading', { name: 'conflict role' })
  await user.click(screen.getByRole('button', { name: 'Check these results' }))
  await screen.findByText('Checking loaded roles against your preferences…')
  await act(() => router.navigate(destination))
  await act(() => new Promise((resolve) => setTimeout(resolve, 250)))
  expect(screen.queryByText('Loaded roles checked against your confirmed preferences.')).not.toBeInTheDocument()
  await act(() => router.navigate(-1))
  await screen.findByText('Loaded roles checked against your confirmed preferences.')
  expect(titles()).toEqual(['match role', 'tie role', 'unknown role', 'conflict role'])
  expect(screen.getByRole('button', { name: 'Check these results' })).toBeDisabled()
  expect(checked).toHaveBeenCalledOnce()
})
