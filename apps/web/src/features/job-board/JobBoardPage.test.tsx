/** Exercise Job Board through its form and GraphQL boundary, without provider traffic. */
import { act, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { Link } from 'react-router'
import { JobsPage } from '@/features/jobs/JobsPage'
import { JOBS_QUERY } from '@/features/jobs/jobsOperations'
import type { MockLink } from '@apollo/client/testing'
import { IMPORT_JOB_BOARD_LISTING_MUTATION, JOB_BOARD_SEARCH_QUERY, JOB_BOARD_LOCATIONS_QUERY, JOB_BOARD_SEARCH_IDEAS_QUERY } from './jobBoardOperations'
import { renderPage } from '@/test/renderPage'
import { setSectionOpen } from '@/lib/openSections'
import type { BoardListing } from './useJobBoardSearch'
import { JobBoardPage } from './JobBoardPage'

it('uses imported title chips without searching or changing selected filters', async () => {
  const user = userEvent.setup()
  const fetched = vi.fn(() => ({ data: { jobBoardSearch: page() } }))
  renderBoard([
    { request: { query: JOB_BOARD_SEARCH_IDEAS_QUERY }, result: { data: { me: { __typename: 'User', id: 'me', jobTitleSuggestions: ['Backend engineer', 'API developer'] } } } },
    { request: { query: JOB_BOARD_SEARCH_QUERY, variables: searchVariables('Backend engineer', true) }, result: fetched },
  ])
  await user.selectOptions(screen.getByRole('combobox', { name: 'Remote arrangement' }), 'remote')
  await user.click(await screen.findByRole('button', { name: 'Backend engineer' }))
  expect(screen.getByRole('textbox', { name: 'Keyword or job title' })).toHaveValue('Backend engineer')
  expect(screen.getByRole('textbox', { name: 'Keyword or job title' })).toHaveFocus()
  expect(screen.getByRole('combobox', { name: 'Remote arrangement' })).toHaveValue('remote')
  expect(screen.queryByRole('button', { name: 'Software engineer' })).not.toBeInTheDocument()
  expect(fetched).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Search jobs' }))
  await screen.findByRole('heading', { name: 'Platform Engineer' })
  expect(fetched).toHaveBeenCalledTimes(1)
})

it.each([false, true])('keeps default chips when suggestions are unavailable (error: %s)', async (fails) => {
  renderBoard([{
    request: { query: JOB_BOARD_SEARCH_IDEAS_QUERY },
    ...(fails ? { error: new Error('Unavailable') } : { result: { data: { me: { __typename: 'User', id: 'me', jobTitleSuggestions: [] } } } }),
  }])
  expect(await screen.findByRole('button', { name: 'Software engineer' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Search jobs' })).toBeDisabled()
})

it('starts with a keyword invitation without requesting listings', async () => {
  const fetched = vi.fn(() => ({ data: { jobBoardSearch: page() } }))
  renderBoard([{ request: { query: JOB_BOARD_SEARCH_QUERY, variables: searchVariables() }, result: fetched, delay: 0 }])
  expect(screen.getByRole('textbox', { name: 'Keyword or job title' })).toHaveValue('')
  expect(screen.getByRole('heading', { name: 'Find a role worth your next step.' })).toBeInTheDocument()
  expect(screen.queryByText(/Loading/)).not.toBeInTheDocument()
  await act(() => new Promise((resolve) => setTimeout(resolve, 50)))
  expect(fetched).not.toHaveBeenCalled()
})

it('starts with optional career-library reranking switched off', () => {
  renderBoard()
  expect(screen.getByRole('checkbox', { name: 'Rerank using my career library' })).not.toBeChecked()
})

it('searches a submitted keyword and displays a retrieved listing', async () => {
  const user = userEvent.setup()
  const result = vi.fn(() => ({ data: { jobBoardSearch: page([listing('one', 'Platform Engineer')]) } }))
  renderBoard([{ request: { query: JOB_BOARD_SEARCH_QUERY, variables: searchVariables() }, result }])
  await search(user)
  expect(await screen.findByRole('heading', { name: 'Platform Engineer' })).toBeInTheDocument()
  expect(screen.getByText('Acme')).toBeInTheDocument()
  expect(screen.getByText('United States')).toBeInTheDocument()
  expect(screen.getByText(/Retrieved/)).toBeInTheDocument()
  expect(result).toHaveBeenCalledTimes(1)
})

it('submits multiple experience levels and preserves them on pagination despite unsent changes', async () => {
  const user = userEvent.setup()
  const first = vi.fn(() => ({ data: { jobBoardSearch: page([listing('one', 'First role')], { nextCursor: 'next' }) } }))
  renderBoard([
    { request: { query: JOB_BOARD_SEARCH_QUERY, variables: searchVariables('engineer', false, null, ['EN', 'SE']) }, result: first },
    queryMock(searchVariables('engineer', false, 'next', ['EN', 'SE']), page([listing('two', 'Second role')])),
  ])
  await user.click(screen.getByRole('checkbox', { name: 'Entry level' }))
  await user.click(screen.getByRole('checkbox', { name: 'Senior' }))
  expect(first).not.toHaveBeenCalled()
  await search(user)
  await screen.findByRole('heading', { name: 'First role' })
  expect(screen.getByText(/For “engineer”/)).toHaveTextContent('Entry level, Senior')
  await user.click(screen.getByRole('checkbox', { name: 'Mid level' }))
  expect(screen.getByText(/For “engineer”/)).not.toHaveTextContent('Mid level')
  await user.click(screen.getByRole('button', { name: 'Next page' }))
  await screen.findByRole('heading', { name: 'Second role' })
})

it('shows loaded roles as numbered pages and fetches the next batch from the last page', async () => {
  const user = userEvent.setup()
  const batch = (prefix: string) => Array.from({ length: 20 }, (_, index) => listing(`${prefix}${index}`, `${prefix} role ${index}`))
  renderBoard([
    queryMock(searchVariables(), page(batch('a'), { nextCursor: 'next' })),
    queryMock(searchVariables('engineer', false, 'next'), page(batch('b'))),
  ])
  await search(user)
  await screen.findByRole('heading', { name: 'a role 0' })
  expect(screen.getByRole('button', { name: 'Page 1' })).toHaveAttribute('aria-current', 'page')
  expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'Next page' }))
  expect(await screen.findByRole('heading', { name: 'b role 0' })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'a role 0' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Page 2' })).toHaveAttribute('aria-current', 'page')
  expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'Page 1' }))
  expect(screen.getByRole('heading', { name: 'a role 0' })).toBeInTheDocument()
})

it('retries selected experience levels after the draft selection changes', async () => {
  const user = userEvent.setup()
  renderBoard([
    queryMock(searchVariables('engineer', false, null, ['EX']), page([], { retrievedAt: null, errors: ['Try later.'] })),
    queryMock(searchVariables('engineer', false, null, ['EX']), page([listing()])),
  ])
  await user.click(screen.getByRole('checkbox', { name: 'Executive' }))
  await search(user)
  await screen.findByText('Try later.')
  await user.click(screen.getByRole('checkbox', { name: 'Executive' }))
  await user.click(screen.getByRole('button', { name: 'Try again' }))
  await screen.findByRole('heading', { name: 'Platform Engineer' })
  expect(screen.getByText(/For “engineer”/)).toHaveTextContent('Executive')
})

it('clears selected levels back to an unrestricted search', async () => {
  const user = userEvent.setup()
  renderBoard([queryMock()])
  await user.click(screen.getByRole('checkbox', { name: 'Senior' }))
  await user.click(screen.getByRole('checkbox', { name: 'Senior' }))
  await search(user)
  await screen.findByRole('heading', { name: 'Platform Engineer' })
  expect(screen.getByText(/For “engineer”/)).toHaveTextContent('All experience levels')
})

function listing(id = 'one', title = 'Platform Engineer'): Omit<BoardListing, '__typename' | 'savedJob'> & { __typename: 'JobBoardListing'; savedJob: ({ id: string; __typename: 'Job' }) | null } {
  return { __typename: 'JobBoardListing' as const, id, title, company: 'Acme', location: 'United States', description: 'Build useful tools.', hasRemote: true, remoteType: null, published: null, employmentType: null, salaryText: null, salaryCurrency: null, savedJob: null }
}
function page(listings = [listing()], overrides: Record<string, unknown> = {}) {
  return { __typename: 'JobBoardSearchPage', listings, nextCursor: null, retrievedAt: '2026-10-19T00:00:00Z', stale: false, errors: [], ...overrides }
}
function searchVariables(keyword = 'engineer', remoteOnly = false, cursor: string | null = null, experienceLevels: string[] = []) {
  return { keyword, remoteOnly, cursor, experienceLevels }
}
function renderBoard(mocks: MockLink.MockedResponse[] = []) {
  setSectionOpen('job-board:filters', true)
  return renderPage({ path: '/jobs/find', url: '/jobs/find', element: <JobBoardPage />, mocks, extraRoutes: [{ path: '/jobs/:id', element: <p>Saved job page</p> }] })
}
it('collapses filters, remembers the choice, and keeps their values and count', async () => {
  const user = userEvent.setup()
  renderBoard()
  setSectionOpen('job-board:filters', false)
  const toggle = await screen.findByRole('button', { name: /^Filters/ })
  await user.click(toggle)
  expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await user.selectOptions(screen.getByRole('combobox', { name: 'Date posted' }), '7d')
  await user.click(toggle)
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByRole('combobox', { name: 'Date posted' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Filters (1)' })).toBeInTheDocument()
  await user.click(toggle)
  expect(screen.getByRole('combobox', { name: 'Date posted' })).toHaveValue('7d')
})
async function search(user: ReturnType<typeof userEvent.setup>, keyword = 'engineer') {
  const input = screen.getByRole('textbox', { name: 'Keyword or job title' })
  await user.clear(input)
  await user.type(input, keyword)
  await user.click(screen.getByRole('button', { name: 'Search jobs' }))
}

it('uses the remote filter and opaque cursor, appending unique listings in order', async () => {
  const user = userEvent.setup()
  renderBoard([
    queryMock(searchVariables('engineer', true), page([listing('one', 'First role')], { nextCursor: 'opaque/+==' })),
    queryMock(searchVariables('engineer', true, 'opaque/+=='), page([listing('one', 'First role'), listing('two', 'Second role')])),
  ])
  await user.selectOptions(screen.getByRole('combobox', { name: 'Remote arrangement' }), 'remote')
  await search(user)
  await screen.findByRole('heading', { name: 'First role' })
  await user.click(screen.getByRole('button', { name: 'Next page' }))
  await screen.findByRole('heading', { name: 'Second role' })
  expect(screen.getAllByRole('heading', { level: 2 }).map((item) => item.textContent)).toEqual(['First role', 'Second role'])
  expect(screen.queryByRole('button', { name: 'Next page' })).not.toBeInTheDocument()
})

function queryMock(variables = searchVariables(), resultPage = page(), extra: Record<string, unknown> = {}): MockLink.MockedResponse {
  return { request: { query: JOB_BOARD_SEARCH_QUERY, variables }, result: { data: { jobBoardSearch: resultPage } }, ...extra }
}

it('shows stale results with their retrieval time and retries that page', async () => {
  const user = userEvent.setup()
  renderBoard([
    queryMock(searchVariables(), page([listing()], { stale: true, errors: ['Search is unavailable.'], retrievedAt: '2026-10-17T00:00:00Z' })),
    queryMock(searchVariables(), page([listing('two', 'Fresh role')])),
  ])
  await search(user)
  await screen.findByRole('heading', { name: 'Platform Engineer' })
  expect(screen.getByText(/Showing older results/)).toBeInTheDocument()
  expect(screen.getByText('Search is unavailable.')).toBeInTheDocument()
  expect(screen.getByRole('time')).toHaveAttribute('datetime', '2026-10-17T00:00:00Z')
  await user.click(screen.getByRole('button', { name: 'Retry results' }))
  await screen.findByRole('heading', { name: 'Fresh role' })
  expect(screen.queryByText(/Showing older results/)).not.toBeInTheDocument()
})

it('retries a total failure using the submitted search even if the form has changed', async () => {
  const user = userEvent.setup()
  renderBoard([
    queryMock(searchVariables(), page([], { retrievedAt: null, errors: ['Search unavailable.'] })),
    queryMock(searchVariables(), page([])),
  ])
  await search(user)
  expect(await screen.findByText('Search unavailable.')).toBeInTheDocument()
  await user.type(screen.getByRole('textbox', { name: 'Keyword or job title' }), ' changed')
  await user.click(screen.getByRole('button', { name: 'Try again' }))
  expect(await screen.findByText('No matches. Try another keyword or broaden your filters.')).toBeInTheDocument()
  expect(screen.queryByText('Search unavailable.')).not.toBeInTheDocument()
})

it('keeps earlier pages on pagination failure and retries only the failed cursor', async () => {
  const user = userEvent.setup()
  renderBoard([
    queryMock(searchVariables(), page([listing('one', 'First role')], { nextCursor: 'page-two' })),
    { request: { query: JOB_BOARD_SEARCH_QUERY, variables: searchVariables('engineer', false, 'page-two') }, error: new Error('Offline') },
    queryMock(searchVariables('engineer', false, 'page-two'), page([listing('two', 'Second role')])),
  ])
  await search(user)
  await screen.findByRole('heading', { name: 'First role' })
  await user.click(screen.getByRole('button', { name: 'Next page' }))
  await screen.findByText('Could not load jobs. Please try again.')
  expect(screen.getByRole('heading', { name: 'First role' })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Try again' }))
  await screen.findByRole('heading', { name: 'Second role' })
  expect(screen.getByRole('heading', { name: 'First role' })).toBeInTheDocument()
})

it.each(['response', 'failure'])('ignores an older search %s after a new search completes', async (kind) => {
  const user = userEvent.setup()
  const oldResult = vi.fn(() => ({ data: { jobBoardSearch: page([listing('old', 'Old role')]) } }))
  const oldError = new Error('Old request failed')
  renderBoard([
    kind === 'response'
      ? { request: { query: JOB_BOARD_SEARCH_QUERY, variables: searchVariables() }, result: oldResult, delay: 600 }
      : { request: { query: JOB_BOARD_SEARCH_QUERY, variables: searchVariables() }, error: oldError, delay: 600 },
    queryMock(searchVariables('designer'), page([listing('new', 'New role')])),
  ])
  await search(user)
  expect(screen.getByRole('status')).toHaveTextContent('Loading jobs')
  await search(user, 'designer')
  await screen.findByRole('heading', { name: 'New role' })
  await act(() => new Promise((resolve) => setTimeout(resolve, 650)))
  expect(screen.getByRole('heading', { name: 'New role' })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Old role' })).not.toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  if (kind === 'response') expect(oldResult).toHaveBeenCalledOnce()
})

it('newly submitted searches clear old pagination and blank input never sends a query', async () => {
  const user = userEvent.setup()
  renderBoard([
    queryMock(searchVariables(), page([listing('old', 'Old role')], { nextCursor: 'old-cursor' })),
    queryMock(searchVariables('designer'), page([listing('new', 'New role')]), { delay: 150 }),
  ])
  await user.type(screen.getByRole('textbox', { name: 'Keyword or job title' }), '   ')
  expect(screen.getByRole('button', { name: 'Search jobs' })).toBeDisabled()
  await search(user)
  await screen.findByRole('heading', { name: 'Old role' })
  await search(user, 'designer')
  expect(screen.queryByRole('heading', { name: 'Old role' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Next page' })).not.toBeInTheDocument()
  await screen.findByRole('heading', { name: 'New role' })
})

it('retains per-page stale metadata when a newer page loads', async () => {
  const user = userEvent.setup()
  renderBoard([
    queryMock(searchVariables(), page([listing('one', 'First role')], { nextCursor: 'two', stale: true, errors: ['Temporarily unavailable.'], retrievedAt: '2026-10-17T00:00:00Z' })),
    queryMock(searchVariables('engineer', false, 'two'), page([listing('two', 'Second role')])),
  ])
  await search(user)
  await screen.findByRole('heading', { name: 'First role' })
  await user.click(screen.getByRole('button', { name: 'Next page' }))
  await screen.findByRole('heading', { name: 'Second role' })
  expect(screen.getByText(/Showing older results/)).toBeInTheDocument()
  expect(screen.getAllByRole('time').map((time) => time.getAttribute('datetime'))).toEqual(['2026-10-17T00:00:00Z', '2026-10-19T00:00:00Z'])
})

it('discards descendants only after a refreshed page changes the cursor chain', async () => {
  const user = userEvent.setup()
  renderBoard([
    queryMock(searchVariables(), page([listing('one', 'First role')], { nextCursor: 'old-two', stale: true })),
    queryMock(searchVariables('engineer', false, 'old-two'), page([listing('old', 'Old second role')])),
    queryMock(searchVariables(), page([listing('first-new', 'Updated first role')], { nextCursor: 'new-two' })),
    queryMock(searchVariables('engineer', false, 'new-two'), page([listing('new', 'New second role')])),
  ])
  await search(user)
  await screen.findByRole('heading', { name: 'First role' })
  await user.click(screen.getByRole('button', { name: 'Next page' }))
  await screen.findByRole('heading', { name: 'Old second role' })
  await user.click(screen.getByRole('button', { name: 'Retry results' }))
  await screen.findByRole('heading', { name: 'Updated first role' })
  expect(screen.queryByRole('heading', { name: 'Old second role' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Next page' }))
  await screen.findByRole('heading', { name: 'New second role' })
})

it('creates a private job once during a double click and opens it with import warnings', async () => {
  const user = userEvent.setup()
  const imported = vi.fn(() => ({ data: { importJobBoardListing: { __typename: 'ImportListingPayload', job: { __typename: 'Job', id: 'saved-one' }, warnings: ['The application link was omitted.'], errors: [] } } }))
  const { router } = renderBoard([
    queryMock(),
    { request: { query: IMPORT_JOB_BOARD_LISTING_MUTATION, variables: { listingId: 'one' } }, result: imported, delay: 150 },
  ])
  await search(user)
  await screen.findByRole('heading', { name: 'Platform Engineer' })
  await user.dblClick(screen.getByRole('button', { name: 'Save job' }))
  await screen.findByText('Saved job page')
  expect(imported).toHaveBeenCalledOnce()
  expect(router.state.location.pathname).toBe('/jobs/saved-one')
  expect(router.state.location.state).toEqual({ jobBoardImport: { jobId: 'saved-one', warnings: ['The application link was omitted.'] } })
})

it('opens the current user’s existing job without importing and renders descriptions as remembered text disclosures', async () => {
  const user = userEvent.setup()
  renderBoard([queryMock(searchVariables(), page([{ ...listing(), company: null, description: '<img src=x onerror=alert(1)> Role details', savedJob: { __typename: 'Job', id: 'existing' } }]))])
  await search(user)
  await screen.findByRole('heading', { name: 'Platform Engineer' })
  expect(screen.getByText('Unknown company')).toBeInTheDocument()
  expect(screen.getByText('United States')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Open saved job' })).toHaveAttribute('href', '/jobs/existing')
  expect(screen.queryByRole('button', { name: 'Save job' })).not.toBeInTheDocument()
  const details = screen.getByRole('button', { name: 'Description for Platform Engineer' })
  expect(details).toHaveAttribute('aria-expanded', 'false')
  await user.click(details)
  expect(screen.getByText('<img src=x onerror=alert(1)> Role details')).toBeInTheDocument()
  expect(screen.queryByRole('img')).not.toBeInTheDocument()
  await user.click(screen.getByRole('link', { name: 'Open saved job' }))
  await screen.findByText('Saved job page')
})

it.each(['validation', 'network'])('keeps search results after an import %s failure and allows retry', async (kind) => {
  const user = userEvent.setup()
  const failed: MockLink.MockedResponse = kind === 'network'
    ? { request: { query: IMPORT_JOB_BOARD_LISTING_MUTATION, variables: { listingId: 'one' } }, error: new Error('Offline') }
    : { request: { query: IMPORT_JOB_BOARD_LISTING_MUTATION, variables: { listingId: 'one' } }, result: { data: { importJobBoardListing: { __typename: 'ImportListingPayload', job: null, warnings: [], errors: ['Could not save this job. Please try again.'] } } } }
  renderBoard([
    queryMock(), failed,
    { request: { query: IMPORT_JOB_BOARD_LISTING_MUTATION, variables: { listingId: 'one' } }, result: { data: { importJobBoardListing: { __typename: 'ImportListingPayload', job: { __typename: 'Job', id: 'saved-one' }, warnings: [], errors: [] } } } },
  ])
  await search(user)
  await screen.findByRole('heading', { name: 'Platform Engineer' })
  await user.click(screen.getByRole('button', { name: 'Save job' }))
  await screen.findByText('Could not save this job. Please try again.')
  expect(screen.getByRole('heading', { name: 'Platform Engineer' })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Save job' }))
  await screen.findByText('Saved job page')
})

it('refreshes an already visited private Jobs list after creating a listing', async () => {
  const user = userEvent.setup()
  renderPage({
    path: '/jobs', url: '/jobs', element: <><Link to="/jobs/find">Find opportunities</Link><JobsPage /></>,
    extraRoutes: [
      { path: '/jobs/find', element: <JobBoardPage /> },
      { path: '/jobs/:id', element: <Link to="/jobs">Return to saved jobs</Link> },
    ],
    mocks: [
      { request: { query: JOBS_QUERY }, result: { data: { jobs: [] } } },
      queryMock(),
      { request: { query: IMPORT_JOB_BOARD_LISTING_MUTATION, variables: { listingId: 'one' } }, result: { data: { importJobBoardListing: { __typename: 'ImportListingPayload', job: { __typename: 'Job', id: 'saved-one' }, warnings: [], errors: [] } } } },
      { request: { query: JOBS_QUERY }, result: { data: { jobs: [{ __typename: 'Job', id: 'saved-one', title: 'Platform Engineer', company: 'Acme', location: 'United States', stage: 'UNAPPLIED', createdAt: '2026-10-19T00:00:00Z' }] } } },
    ],
  })
  await screen.findByText(/No jobs yet/)
  await user.click(screen.getByRole('link', { name: 'Find opportunities' }))
  await search(user)
  await screen.findByRole('heading', { name: 'Platform Engineer' })
  await user.click(screen.getByRole('button', { name: 'Save job' }))
  await user.click(await screen.findByRole('link', { name: 'Return to saved jobs' }))
  expect(await screen.findByRole('link', { name: /Platform Engineer/ })).toHaveAttribute('href', '/jobs/saved-one')
})

it('keeps every loaded page when a stale refresh fails and when its cursor stays the same', async () => {
  const user = userEvent.setup()
  renderBoard([
    queryMock(searchVariables(), page([listing('one', 'First role')], { nextCursor: 'two', stale: true })),
    queryMock(searchVariables('engineer', false, 'two'), page([listing('two', 'Second role')])),
    { request: { query: JOB_BOARD_SEARCH_QUERY, variables: searchVariables() }, error: new Error('Offline') },
    queryMock(searchVariables(), page([listing('one', 'Updated role')], { nextCursor: 'two' })),
  ])
  await search(user)
  await screen.findByRole('heading', { name: 'First role' })
  await user.click(screen.getByRole('button', { name: 'Next page' }))
  await screen.findByRole('heading', { name: 'Second role' })
  await user.click(screen.getByRole('button', { name: 'Retry results' }))
  await screen.findByText('Could not load jobs. Please try again.')
  expect(screen.getByRole('heading', { name: 'First role' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Second role' })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Try again' }))
  await screen.findByRole('heading', { name: 'Updated role' })
  expect(screen.getByRole('heading', { name: 'Second role' })).toBeInTheDocument()
})


it('submits all provider filters and keeps their snapshot for pagination and retry', async () => {
  const user = userEvent.setup()
  const filters = { maxAge: '7d', stateId: 5332921, remoteType: 'fully_remote', employmentTypes: ['FULL_TIME', 'CONTRACT'], minimumSalary: 100000, includeUndisclosedSalaries: false, companyName: 'Acme', sortBy: 'relevance' }
  const firstVariables = { ...searchVariables('engineer', true), filters }
  const nextVariables = { ...firstVariables, cursor: 'next' }
  renderBoard([
    { request: { query: JOB_BOARD_LOCATIONS_QUERY, variables: { query: 'California' } }, result: { data: { jobBoardLocations: { __typename: 'JobBoardLocationsPage', locations: [{ __typename: 'JobBoardLocation', kind: 'state', providerId: 5332921, label: 'California, US' }], errors: [] } } } },
    queryMock(firstVariables, page([listing('one', 'First role')], { nextCursor: 'next' })),
    { request: { query: JOB_BOARD_SEARCH_QUERY, variables: nextVariables }, error: new Error('Offline') },
    queryMock(nextVariables, page([listing('two', 'Second role')])),
  ])
  await user.selectOptions(screen.getByRole('combobox', { name: 'Date posted' }), '7d')
  await user.selectOptions(screen.getByRole('combobox', { name: 'Remote arrangement' }), 'fully_remote')
  await user.selectOptions(screen.getByRole('combobox', { name: 'Sort by' }), 'relevance')
  await user.click(screen.getByRole('checkbox', { name: 'Full-time' }))
  await user.click(screen.getByRole('checkbox', { name: 'Contract' }))
  await user.type(screen.getByRole('textbox', { name: 'US city or state' }), 'California')
  await user.type(screen.getByRole('textbox', { name: 'Keyword or job title' }), 'engineer')
  expect(screen.getByRole('button', { name: 'Search jobs' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'Find locations' }))
  await user.click(await screen.findByRole('radio', { name: /California, US/ }))
  await user.click(screen.getByRole('button', { name: 'More filters' }))
  await user.type(screen.getByRole('textbox', { name: 'Company' }), 'Acme')
  await user.type(screen.getByRole('spinbutton', { name: 'Minimum salary' }), '100000')
  await user.click(screen.getByRole('checkbox', { name: 'Include undisclosed salaries' }))
  await user.click(screen.getByRole('button', { name: 'Search jobs' }))
  await screen.findByRole('heading', { name: 'First role' })
  expect(screen.getByText(/For “engineer”/)).toHaveTextContent('California, US · Fully remote · Past 7 days')
  expect(screen.getByText(/For “engineer”/)).toHaveTextContent('Company: Acme')
  await user.selectOptions(screen.getByRole('combobox', { name: 'Date posted' }), '30d')
  await user.selectOptions(screen.getByRole('combobox', { name: 'Sort by' }), 'published')
  await user.click(screen.getByRole('checkbox', { name: 'Full-time' }))
  await user.clear(screen.getByRole('textbox', { name: 'Company' }))
  await user.click(screen.getByRole('button', { name: 'Clear location' }))
  await user.click(screen.getByRole('button', { name: 'Next page' }))
  await screen.findByText('Could not load jobs. Please try again.')
  await user.click(screen.getByRole('button', { name: 'Try again' }))
  await screen.findByRole('heading', { name: 'Second role' })
  expect(screen.getByText(/For “engineer”/)).toHaveTextContent('Most relevant')
})

it('hides only owned saved results while preserving pagination and an accurate empty state', async () => {
  const user = userEvent.setup()
  const saved = { ...listing('saved', 'Saved role'), savedJob: { __typename: 'Job' as const, id: 'owned' } }
  renderBoard([
    queryMock(searchVariables(), page([saved], { nextCursor: 'next' })),
    queryMock(searchVariables('engineer', false, 'next'), page([listing('new', 'New role')])),
  ])
  await search(user)
  await screen.findByRole('heading', { name: 'Saved role' })
  await user.click(screen.getByRole('checkbox', { name: 'Hide already saved' }))
  expect(screen.queryByRole('heading', { name: 'Saved role' })).not.toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('All loaded roles are already saved.')
  expect(screen.getByText('0 shown · 1 loaded · 1 saved hidden')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Next page' }))
  await screen.findByRole('heading', { name: 'New role' })
  await user.click(screen.getByRole('checkbox', { name: 'Hide already saved' }))
  expect(screen.getByRole('heading', { name: 'Saved role' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'New role' })).toBeInTheDocument()
})

it('shows salary, employment, remote restrictions and a valid posting date', async () => {
  const user = userEvent.setup()
  renderBoard([queryMock(searchVariables(), page([{ ...listing(), remoteType: 'remote_country', employmentType: 'CONTRACT', salaryText: '$60 per hour', salaryCurrency: 'USD', published: '2026-10-26T00:00:00Z' }]))])
  await search(user)
  await screen.findByRole('heading', { name: 'Platform Engineer' })
  expect(screen.getByText('$60 per hour · USD')).toBeInTheDocument()
  expect(screen.getByText('Remote — country restricted', { selector: 'span' })).toBeInTheDocument()
  expect(screen.getAllByText('Contract')).toHaveLength(2)
  expect(screen.getAllByRole('time').some((item) => item.getAttribute('datetime') === '2026-10-26T00:00:00Z')).toBe(true)
})

it('retries a failed location lookup and lets users clear an unmatched place', async () => {
  const user = userEvent.setup()
  const request = { query: JOB_BOARD_LOCATIONS_QUERY, variables: { query: 'Boston' } }
  renderBoard([
    { request, result: { data: { jobBoardLocations: { __typename: 'JobBoardLocationsPage', locations: [], errors: ['Location service unavailable.'] } } } },
    { request, result: { data: { jobBoardLocations: { __typename: 'JobBoardLocationsPage', locations: [], errors: [] } } } },
    queryMock(),
  ])
  await user.type(screen.getByRole('textbox', { name: 'US city or state' }), 'Boston')
  await user.click(screen.getByRole('button', { name: 'Find locations' }))
  await screen.findByText('Location service unavailable.')
  await user.click(screen.getByRole('button', { name: 'Find locations' }))
  await screen.findByText('No US locations found. Try a fuller city or state name.')
  await user.clear(screen.getByRole('textbox', { name: 'US city or state' }))
  await search(user)
  await screen.findByRole('heading', { name: 'Platform Engineer' })
})

it('ignores location results for text that has changed', async () => {
  const user = userEvent.setup()
  renderBoard([{ request: { query: JOB_BOARD_LOCATIONS_QUERY, variables: { query: 'Boston' } }, delay: 250,
    result: { data: { jobBoardLocations: { __typename: 'JobBoardLocationsPage', locations: [{ __typename: 'JobBoardLocation', kind: 'city', providerId: 4930956, label: 'Boston, MA, US' }], errors: [] } } } }])
  const input = screen.getByRole('textbox', { name: 'US city or state' })
  await user.type(input, 'Boston')
  await user.click(screen.getByRole('button', { name: 'Find locations' }))
  await user.clear(input)
  await user.type(input, 'Austin')
  await act(() => new Promise((resolve) => setTimeout(resolve, 300)))
  expect(screen.queryByRole('radio')).not.toBeInTheDocument()
  expect(input).toHaveValue('Austin')
})

it('keeps an invalid salary visible and blocks submission after advanced filters are collapsed', async () => {
  const user = userEvent.setup()
  renderBoard()
  await user.type(screen.getByRole('textbox', { name: 'Keyword or job title' }), 'engineer')
  await user.click(screen.getByRole('button', { name: 'More filters' }))
  await user.type(screen.getByRole('spinbutton', { name: 'Minimum salary' }), '-1')
  await user.click(screen.getByRole('button', { name: 'More filters (1)' }))
  expect(screen.getByRole('alert')).toHaveTextContent('Enter a whole-number minimum salary')
  expect(screen.getByRole('button', { name: 'Search jobs' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'More filters (1)' }))
  await user.clear(screen.getByRole('spinbutton', { name: 'Minimum salary' }))
  expect(screen.getByRole('button', { name: 'Search jobs' })).toBeEnabled()
})
