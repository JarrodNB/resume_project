/** Follow optional reranking through the page's real GraphQL operations and result ordering. */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApolloClient, InMemoryCache } from '@apollo/client'
import { ApolloProvider } from '@apollo/client/react'
import { MockLink } from '@apollo/client/testing'
import { MemoryRouter } from 'react-router'
import { expect, it, vi } from 'vitest'
import { renderPage } from '@/test/renderPage'
import { setSectionOpen } from '@/lib/openSections'
import { JobBoardPage } from './JobBoardPage'
import { JOB_BOARD_SEARCH_QUERY, JOB_BOARD_RERANKING_SUBSCRIPTION, RERANK_JOB_BOARD_LISTINGS_MUTATION } from './jobBoardOperations'

function listing(id: string) {
  return { __typename: 'JobBoardListing', id, title: `${id} role`, company: 'Acme', location: 'US', description: 'Build tools.', hasRemote: false, remoteType: null, published: null, employmentType: null, salaryText: null, salaryCurrency: null, savedJob: null }
}
function searchMock(keyword = 'engineer', ids = ['first', 'second'], cursor: string | null = null, nextCursor: string | null = null): MockLink.MockedResponse {
  return {
    request: { query: JOB_BOARD_SEARCH_QUERY, variables: { keyword, remoteOnly: false, experienceLevels: [], cursor } },
    result: { data: { jobBoardSearch: { __typename: 'JobBoardSearchPage', listings: ids.map(listing), nextCursor, retrievedAt: '2026-10-26T00:00:00Z', stale: false, errors: [] } } },
  }
}
function task(id: string, order: string[] | null, errorMessage: string | null = null) {
  return { __typename: 'AiTask', id, status: errorMessage ? 'FAILED' : order ? 'COMPLETED' : 'QUEUED', result: order ? { ranked_listing_ids: order } : null, errorMessage }
}
function rankMock(keyword = 'engineer', ids = ['first', 'second'], order = ['second', 'first'], extra = {}): MockLink.MockedResponse {
  return {
    request: { query: RERANK_JOB_BOARD_LISTINGS_MUTATION, variables: { keyword, listingIds: ids } },
    result: { data: { rerankJobBoardListings: { __typename: 'RerankJobBoardListingsPayload', aiTask: task('rank-1', order), errors: [] } } },
    ...extra,
  }
}
function renderBoard(mocks: MockLink.MockedResponse[]) {
  setSectionOpen('job-board:filters', true)
  return renderPage({ path: '/jobs/find', url: '/jobs/find', element: <JobBoardPage />, mocks })
}
async function search(user: ReturnType<typeof userEvent.setup>, keyword = 'engineer') {
  await user.clear(screen.getByRole('textbox', { name: 'Keyword or job title' }))
  await user.type(screen.getByRole('textbox', { name: 'Keyword or job title' }), keyword)
  await user.click(screen.getByRole('button', { name: 'Search jobs' }))
}
function titles() { return screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent) }
function toggle() { return screen.getByRole('checkbox', { name: 'Rerank using my career library' }) }

it('preserves provider order by default and reuses completed reranking across toggle changes', async () => {
  const user = userEvent.setup()
  const result = vi.fn(() => ({ data: { rerankJobBoardListings: { __typename: 'RerankJobBoardListingsPayload', aiTask: task('rank-1', ['second', 'first']), errors: [] } } }))
  renderBoard([searchMock(), rankMock('engineer', ['first', 'second'], ['second', 'first'], { result })])
  await search(user)
  await screen.findByRole('heading', { name: 'first role' })
  expect(titles()).toEqual(['first role', 'second role'])
  expect(result).not.toHaveBeenCalled()
  await user.click(toggle())
  await screen.findByText('Loaded roles ranked using your career library.')
  expect(titles()).toEqual(['second role', 'first role'])
  await user.click(toggle())
  expect(titles()).toEqual(['first role', 'second role'])
  await user.click(toggle())
  expect(titles()).toEqual(['second role', 'first role'])
  expect(result).toHaveBeenCalledTimes(1)
})

it('follows a queued task until the subscription supplies the completed order', async () => {
  const user = userEvent.setup()
  renderBoard([
    searchMock(),
    rankMock('engineer', ['first', 'second'], [], { result: { data: { rerankJobBoardListings: { __typename: 'RerankJobBoardListingsPayload', aiTask: task('rank-1', null), errors: [] } } } }),
    { request: { query: JOB_BOARD_RERANKING_SUBSCRIPTION, variables: { id: 'rank-1' } }, delay: 100, result: { data: { aiTaskUpdated: task('rank-1', ['second', 'first']) } } },
  ])
  await search(user)
  await screen.findByRole('heading', { name: 'first role' })
  await user.click(toggle())
  await screen.findByText(/Reranking loaded roles/)
  expect(titles()).toEqual(['first role', 'second role'])
  await screen.findByText('Loaded roles ranked using your career library.')
  expect(titles()).toEqual(['second role', 'first role'])
})

it('keeps provider order after a failure and starts work only when explicitly retried', async () => {
  const user = userEvent.setup()
  renderBoard([
    searchMock(), rankMock('engineer', ['first', 'second'], [], { result: { data: { rerankJobBoardListings: { __typename: 'RerankJobBoardListingsPayload', aiTask: null, errors: ['Add career library entries first.'] } } } }), rankMock(),
  ])
  await search(user)
  await screen.findByRole('heading', { name: 'first role' })
  await user.click(toggle())
  await screen.findByText('Add career library entries first.')
  expect(titles()).toEqual(['first role', 'second role'])
  await user.click(screen.getByRole('button', { name: 'Retry reranking' }))
  await screen.findByText('Loaded roles ranked using your career library.')
  expect(titles()).toEqual(['second role', 'first role'])
})

it('does not apply a late mutation from an old search to new results', async () => {
  const user = userEvent.setup()
  renderBoard([
    searchMock(), rankMock('engineer', ['first', 'second'], ['second', 'first'], { delay: 450 }),
    searchMock('designer', ['new-first', 'new-second']), rankMock('designer', ['new-first', 'new-second'], ['new-second', 'new-first']),
  ])
  await search(user)
  await screen.findByRole('heading', { name: 'first role' })
  await user.click(toggle())
  await search(user, 'designer')
  await screen.findByRole('heading', { name: 'new-second role' })
  await waitFor(() => expect(titles()).toEqual(['new-second role', 'new-first role']))
  await act(() => new Promise((resolve) => setTimeout(resolve, 500)))
  expect(titles()).toEqual(['new-second role', 'new-first role'])
})

it('requests a new snapshot after loading more without sending the displayed reranked order', async () => {
  const user = userEvent.setup()
  renderBoard([
    searchMock('engineer', ['first', 'second'], null, 'next'), rankMock(),
    searchMock('engineer', ['third'], 'next'), rankMock('engineer', ['first', 'second', 'third'], ['third', 'second', 'first']),
  ])
  await search(user)
  await screen.findByRole('heading', { name: 'first role' })
  await user.click(toggle())
  await screen.findByText('Loaded roles ranked using your career library.')
  await user.click(screen.getByRole('button', { name: 'Next page' }))
  await waitFor(() => expect(titles()).toEqual(['third role', 'second role', 'first role']))
})

it('ignores completion while disabled and uses the same completed task when re-enabled', async () => {
  const user = userEvent.setup()
  const result = vi.fn(() => ({ data: { rerankJobBoardListings: { __typename: 'RerankJobBoardListingsPayload', aiTask: task('rank-1', ['second', 'first']), errors: [] } } }))
  renderBoard([searchMock(), rankMock('engineer', ['first', 'second'], ['second', 'first'], { result, delay: 150 })])
  await search(user)
  await screen.findByRole('heading', { name: 'first role' })
  await user.click(toggle())
  await user.click(toggle())
  await act(() => new Promise((resolve) => setTimeout(resolve, 200)))
  expect(titles()).toEqual(['first role', 'second role'])
  await user.click(toggle())
  expect(titles()).toEqual(['second role', 'first role'])
  expect(result).toHaveBeenCalledTimes(1)
})

it('rejects incomplete task output and retains provider order', async () => {
  const user = userEvent.setup()
  renderBoard([searchMock(), rankMock('engineer', ['first', 'second'], ['first', 'first'])])
  await user.click(toggle())
  await search(user)
  await screen.findByText('The reranking result was incomplete. Please try again.')
  expect(titles()).toEqual(['first role', 'second role'])
})

it('shows a clear fallback for more than one hundred loaded roles', async () => {
  const user = userEvent.setup()
  renderBoard([searchMock('engineer', Array.from({ length: 101 }, (_, index) => String(index)))])
  await user.click(toggle())
  await search(user)
  await screen.findByText(/Reranking supports up to 100 loaded roles/)
  expect(titles()[0]).toBe('0 role')
})


it('does not start a task for an empty search result', async () => {
  const user = userEvent.setup()
  renderBoard([searchMock('engineer', [])])
  await user.click(toggle())
  await search(user)
  await screen.findByRole('heading', { name: 'No matching roles this time.' })
  expect(screen.queryByText(/Reranking loaded roles/)).not.toBeInTheDocument()
})

it('reuses an in-flight request when the toggle is switched off and on', async () => {
  const user = userEvent.setup()
  const result = vi.fn(() => ({ data: { rerankJobBoardListings: { __typename: 'RerankJobBoardListingsPayload', aiTask: task('rank-1', ['second', 'first']), errors: [] } } }))
  renderBoard([searchMock(), rankMock('engineer', ['first', 'second'], ['second', 'first'], { result, delay: 300 })])
  await search(user)
  await screen.findByRole('heading', { name: 'first role' })
  await user.click(toggle())
  await user.click(toggle())
  await user.click(toggle())
  await screen.findByText('Loaded roles ranked using your career library.')
  expect(result).toHaveBeenCalledTimes(1)
})

it('retains provider order when a running task fails', async () => {
  const user = userEvent.setup()
  renderBoard([
    searchMock(),
    rankMock('engineer', ['first', 'second'], [], { result: { data: { rerankJobBoardListings: { __typename: 'RerankJobBoardListingsPayload', aiTask: task('rank-1', null), errors: [] } } } }),
    { request: { query: JOB_BOARD_RERANKING_SUBSCRIPTION, variables: { id: 'rank-1' } }, result: { data: { aiTaskUpdated: task('rank-1', null, 'Embeddings are not ready yet.') } } },
  ])
  await search(user)
  await screen.findByRole('heading', { name: 'first role' })
  await user.click(toggle())
  await screen.findByText('Embeddings are not ready yet.')
  expect(titles()).toEqual(['first role', 'second role'])
  expect(screen.getByRole('button', { name: 'Retry reranking' })).toBeEnabled()
})

it('keeps provider filters and career ranking when saved results are hidden', async () => {
  const user = userEvent.setup()
  const filters = { maxAge: '7d', sortBy: 'relevance' }
  renderBoard([
    {
      request: { query: JOB_BOARD_SEARCH_QUERY, variables: { keyword: 'engineer', remoteOnly: false, experienceLevels: [], cursor: null, filters } },
      result: { data: { jobBoardSearch: { __typename: 'JobBoardSearchPage', listings: [
        { ...listing('first'), savedJob: { __typename: 'Job', id: 'owned' } }, listing('second'), listing('third'),
      ], nextCursor: null, retrievedAt: '2026-10-27T00:00:00Z', stale: false, errors: [] } } },
    },
    rankMock('engineer', ['first', 'second', 'third'], ['third', 'first', 'second']),
  ])
  await user.selectOptions(screen.getByRole('combobox', { name: 'Date posted' }), '7d')
  await user.selectOptions(screen.getByRole('combobox', { name: 'Sort by' }), 'relevance')
  await search(user)
  await screen.findByRole('heading', { name: 'first role' })
  await user.click(screen.getByRole('checkbox', { name: 'Hide already saved' }))
  await user.click(toggle())
  await screen.findByText('Loaded roles ranked using your career library.')
  expect(titles()).toEqual(['third role', 'second role'])
  await user.click(toggle())
  expect(titles()).toEqual(['second role', 'third role'])
  expect(screen.getByText(/For “engineer”/)).toHaveTextContent('Past 7 days')
  expect(screen.getByText(/For “engineer”/)).toHaveTextContent('Most relevant')
})

it('ranks the submitted keyword while keyword and provider filters have unsent edits', async () => {
  const user = userEvent.setup()
  renderBoard([searchMock(), rankMock()])
  await search(user, '  engineer  ')
  await screen.findByRole('heading', { name: 'first role' })
  await user.clear(screen.getByRole('textbox', { name: 'Keyword or job title' }))
  await user.type(screen.getByRole('textbox', { name: 'Keyword or job title' }), 'designer')
  await user.selectOptions(screen.getByRole('combobox', { name: 'Date posted' }), '24h')
  await user.selectOptions(screen.getByRole('combobox', { name: 'Remote arrangement' }), 'hybrid')
  await user.click(toggle())
  await screen.findByText('Loaded roles ranked using your career library.')
  expect(titles()).toEqual(['second role', 'first role'])
  expect(screen.getByText(/For “engineer”/)).not.toHaveTextContent('Past 24 hours')
  expect(screen.getByText(/For “engineer”/)).not.toHaveTextContent('Hybrid')
})

it('reranks a refreshed page even when the keyword and provider listing IDs stay the same', async () => {
  const user = userEvent.setup()
  const stale = searchMock()
  stale.result = { data: { jobBoardSearch: { __typename: 'JobBoardSearchPage', listings: ['first', 'second'].map(listing), nextCursor: null, retrievedAt: '2026-10-26T00:00:00Z', stale: true, errors: ['Temporarily unavailable.'] } } }
  renderBoard([
    stale, rankMock(), searchMock(),
    rankMock('engineer', ['first', 'second'], ['first', 'second'], { delay: 100 }),
  ])
  await search(user)
  await screen.findByRole('heading', { name: 'first role' })
  await user.click(toggle())
  await screen.findByText('Loaded roles ranked using your career library.')
  expect(titles()).toEqual(['second role', 'first role'])
  await user.click(screen.getByRole('button', { name: 'Retry results' }))
  await screen.findByText(/Reranking loaded roles/)
  expect(titles()).toEqual(['first role', 'second role'])
  await screen.findByText('Loaded roles ranked using your career library.')
  expect(titles()).toEqual(['first role', 'second role'])
})

it('discards private listings, preferences and ordering when the session replaces its Apollo client', async () => {
  const user = userEvent.setup()
  const firstClient = new ApolloClient({ cache: new InMemoryCache(), link: new MockLink([searchMock(), rankMock()]) })
  const secondFetch = vi.fn(() => ({ data: { jobBoardSearch: { __typename: 'JobBoardSearchPage', listings: [listing('new-account')], nextCursor: null, retrievedAt: '2026-10-26T00:00:00Z', stale: false, errors: [] } } }))
  const secondClient = new ApolloClient({ cache: new InMemoryCache(), link: new MockLink([
    { ...searchMock(), result: secondFetch },
  ]) })
  const page = (client: ApolloClient) => <ApolloProvider client={client}><MemoryRouter><JobBoardPage /></MemoryRouter></ApolloProvider>
  const view = render(page(firstClient))
  await search(user)
  await screen.findByRole('heading', { name: 'first role' })
  await user.click(toggle())
  await screen.findByText('Loaded roles ranked using your career library.')
  expect(titles()).toEqual(['second role', 'first role'])
  view.rerender(page(secondClient))
  expect(screen.queryByRole('heading', { name: 'first role' })).not.toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'second role' })).not.toBeInTheDocument()
  expect(toggle()).not.toBeChecked()
  await screen.findByRole('heading', { name: 'new-account role' })
  expect(secondFetch).toHaveBeenCalledTimes(1)
  expect(screen.queryByText('Loaded roles ranked using your career library.')).not.toBeInTheDocument()
})

it('ignores a previous task subscription update after resubmitting the same candidates', async () => {
  const user = userEvent.setup()
  const oldUpdate = vi.fn(() => ({ data: { aiTaskUpdated: task('rank-1', ['second', 'first']) } }))
  renderBoard([
    searchMock(), rankMock(), searchMock('designer'),
    rankMock('designer', ['first', 'second'], [], { result: { data: { rerankJobBoardListings: { __typename: 'RerankJobBoardListingsPayload', aiTask: task('rank-2', null), errors: [] } } } }),
    { request: { query: JOB_BOARD_RERANKING_SUBSCRIPTION, variables: { id: 'rank-2' } }, result: oldUpdate },
  ])
  await search(user)
  await screen.findByRole('heading', { name: 'first role' })
  await user.click(toggle())
  await screen.findByText('Loaded roles ranked using your career library.')
  expect(titles()).toEqual(['second role', 'first role'])
  await search(user, 'designer')
  await waitFor(() => expect(oldUpdate).toHaveBeenCalledOnce())
  expect(titles()).toEqual(['first role', 'second role'])
  expect(screen.queryByText('Loaded roles ranked using your career library.')).not.toBeInTheDocument()
  expect(screen.getByText(/For “designer”/)).toBeInTheDocument()
})


it.each(['completed', 'queued'])('resumes %s reranking after leaving during its mutation without buying another task', async (status) => {
  const ranked = vi.fn(() => ({ data: { rerankJobBoardListings: { __typename: 'RerankJobBoardListingsPayload', aiTask: task('rank-1', status === 'completed' ? ['second', 'first'] : null), errors: [] } } }))
  const { router } = renderPage({ path: '/jobs/find', url: '/jobs/find?q=engineer', element: <JobBoardPage />, extraRoutes: [{ path: '/jobs/:id', element: <p>Saved job page</p> }], mocks: [
    searchMock(), rankMock('engineer', ['first', 'second'], [], { result: ranked, delay: 150 }),
    ...(status === 'queued' ? [{ request: { query: JOB_BOARD_RERANKING_SUBSCRIPTION, variables: { id: 'rank-1' } }, result: { data: { aiTaskUpdated: task('rank-1', ['second', 'first']) } } }] : []),
  ] })
  await screen.findByRole('heading', { name: 'first role' })
  vi.useFakeTimers()
  try {
    fireEvent.click(toggle())
    expect(screen.getByText(/Reranking loaded roles/)).toBeInTheDocument()
    await act(() => router.navigate('/jobs/saved'))
    await act(() => vi.advanceTimersByTimeAsync(200))
    await act(() => router.navigate(-1))
    await act(() => vi.advanceTimersByTimeAsync(100))
    expect(screen.getByText('Loaded roles ranked using your career library.')).toBeInTheDocument()
    expect(titles()).toEqual(['second role', 'first role'])
    expect(toggle()).toBeChecked()
    expect(ranked).toHaveBeenCalledTimes(1)
  } finally {
    vi.useRealTimers()
  }
})
