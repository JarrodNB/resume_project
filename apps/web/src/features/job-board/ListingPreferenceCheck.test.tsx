/** Follow explicit checks and criterion evidence through real feature GraphQL operations. */
import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'
import { renderPage } from '@/test/renderPage'
import { ListingPreferenceCheck } from './ListingPreferenceCheck'
import { CHECK_JOB_BOARD_PREFERENCES, JOB_PREFERENCE_CHECK_SUBSCRIPTION } from './preferenceCheckOperations'
import { JOB_PREFERENCES_QUERY } from './jobPreferenceOperations'
import type { BoardListing } from './useJobBoardSearch'

const listing: BoardListing = { id: 'listing-1', preferenceSourceDigest: 'source-digest', title: 'Engineer', company: 'Acme', location: 'US', description: 'Fully remote within the US.', hasRemote: true, remoteType: 'fully_remote', published: null, employmentType: null, salaryText: null, salaryCurrency: null, savedJob: null }
const criterion = { __typename: 'JobPreferenceCriterion' as const, id: 'criterion-1', text: 'Fully remote', priority: 'must_have' }
const profile = { __typename: 'JobPreferenceProfile' as const, version: 2, confirmedRevision: 2, draftCriteria: [criterion], confirmedCriteria: [criterion] }
const outcome = { confirmed_revision: 2, listings: [{ id: listing.id, source_digest: listing.preferenceSourceDigest, criteria: [{ id: criterion.id, status: 'matching', reason: 'supported', support: { passage_id: 'P1', text: 'Fully remote within the US.' }, contradiction: null }] }] }
function query(value = profile) { return { request: { query: JOB_PREFERENCES_QUERY }, result: { data: { jobPreferences: value } } } }
function mutation(status = 'COMPLETED', result: unknown = outcome) {
  return { request: { query: CHECK_JOB_BOARD_PREFERENCES, variables: { listingId: listing.id, expectedDigest: listing.preferenceSourceDigest, confirmedRevision: 2 } },
    result: { data: { checkJobBoardPreferences: { __typename: 'CheckPreferencesPayload', errors: [], aiTask: { __typename: 'AiTask', id: 'check-1', status, result, errorMessage: null } } } } }
}

it('starts only on explicit click and shows source evidence against confirmed priorities', async () => {
  const user = userEvent.setup()
  renderPage({ path: '/jobs/find', url: '/jobs/find', element: <ListingPreferenceCheck listing={listing} scope={{}} />, mocks: [query(), mutation()] })
  expect(screen.queryByText('Matching')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Check preferences for Engineer' }))
  expect(await screen.findByText('Matching')).toBeInTheDocument()
  expect(screen.getByText(/Must-have: Fully remote/)).toBeInTheDocument()
  expect(screen.getByText('Supports: Fully remote within the US.')).toBeInTheDocument()
})

it('follows queued work over a subscription and distinguishes a failed check from unknown', async () => {
  const user = userEvent.setup()
  renderPage({ path: '/jobs/find', url: '/jobs/find', element: <ListingPreferenceCheck listing={listing} scope={{}} />, mocks: [query(), mutation('QUEUED', null),
    { request: { query: JOB_PREFERENCE_CHECK_SUBSCRIPTION, variables: { id: 'check-1' } }, result: { data: { aiTaskUpdated: { __typename: 'AiTask', id: 'check-1', status: 'FAILED', result: null, errorMessage: 'The provider is unavailable. Please retry.' } } } },
  ] })
  await user.click(screen.getByRole('button', { name: 'Check preferences for Engineer' }))
  expect(await screen.findByText('The provider is unavailable. Please retry.')).toBeInTheDocument()
  expect(screen.queryByText('Unknown')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Check preferences for Engineer' })).toBeEnabled()
})

it('requires a confirmed summary before starting paid work', async () => {
  const user = userEvent.setup()
  renderPage({ path: '/jobs/find', url: '/jobs/find', element: <ListingPreferenceCheck listing={listing} scope={{}} />, mocks: [query({ ...profile, confirmedCriteria: [] })] })
  await user.click(screen.getByRole('button', { name: 'Check preferences for Engineer' }))
  expect(await screen.findByText('Confirm your preferences in “What I want next” before checking.')).toBeInTheDocument()
})

it('shows missing posting evidence explicitly as unknown', async () => {
  const user = userEvent.setup()
  const value = { ...outcome, listings: [{ ...outcome.listings[0], criteria: [{ ...outcome.listings[0].criteria[0], status: 'unknown', reason: 'not_stated', support: null }] }] }
  renderPage({ path: '/jobs/find', url: '/jobs/find', element: <ListingPreferenceCheck listing={listing} scope={{}} />, mocks: [query(), mutation('COMPLETED', value)] })
  await user.click(screen.getByRole('button', { name: 'Check preferences for Engineer' }))
  expect(await screen.findByText('Unknown')).toBeInTheDocument()
  expect(screen.getByText('The posting does not establish this condition.')).toBeInTheDocument()
})

import { useState } from 'react'

it('invalidates a completed assessment when the loaded search snapshot changes', async () => {
  function Search() {
    const [scope, setScope] = useState({})
    return <><button onClick={() => setScope({})}>Refresh search snapshot</button><ListingPreferenceCheck listing={listing} scope={scope} /></>
  }
  const user = userEvent.setup()
  renderPage({ path: '/jobs/find', url: '/jobs/find', element: <Search />, mocks: [query(), mutation()] })
  await user.click(screen.getByRole('button', { name: 'Check preferences for Engineer' }))
  await screen.findByText('Matching')
  await user.click(screen.getByRole('button', { name: 'Refresh search snapshot' }))
  expect(screen.queryByText('Matching')).not.toBeInTheDocument()
  expect(screen.getByText('These results or confirmed preferences changed. Check again for a current assessment.')).toBeInTheDocument()
})

it('drops a late failed start from an older search without blocking the new search', async () => {
  function Search() {
    const [scope, setScope] = useState({})
    return <><button onClick={() => setScope({})}>Replace search</button><ListingPreferenceCheck listing={listing} scope={scope} /></>
  }
  const user = userEvent.setup()
  const delayedFailure = { ...mutation(), delay: 100, result: { data: { checkJobBoardPreferences: { __typename: 'CheckPreferencesPayload', errors: ['Old search failed'], aiTask: null } } } }
  renderPage({ path: '/jobs/find', url: '/jobs/find', element: <Search />, mocks: [query(), delayedFailure] })
  await user.click(screen.getByRole('button', { name: 'Check preferences for Engineer' }))
  await user.click(screen.getByRole('button', { name: 'Replace search' }))
  expect(screen.getByRole('button', { name: 'Check preferences for Engineer' })).toBeEnabled()
  await act(() => new Promise((resolve) => setTimeout(resolve, 150)))
  expect(screen.queryByText('Old search failed')).not.toBeInTheDocument()
})
