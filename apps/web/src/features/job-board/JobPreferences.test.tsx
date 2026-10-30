/** Preference editing is explicit, private, and separate from confirmed criteria. */
import { screen } from '@testing-library/react'
import { beforeEach, expect, it } from 'vitest'
import userEvent from '@testing-library/user-event'
import { setSectionOpen } from '@/lib/openSections'
import { JobPreferences } from './JobPreferences'
import { JOB_PREFERENCES_QUERY, SAVE_JOB_PREFERENCE_DRAFT, CONFIRM_JOB_PREFERENCES, CLEAR_JOB_PREFERENCES } from './jobPreferenceOperations'

beforeEach(() => localStorage.clear())
import { renderPage } from '@/test/renderPage'
import { JobBoardPage } from './JobBoardPage'

it('offers preferences in a collapsed section without requesting data', () => {
  renderPage({ path: '/jobs/find', url: '/jobs/find', element: <JobBoardPage /> })
  expect(screen.getByRole('button', { name: 'What I want next' })).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByRole('button', { name: 'Add preference' })).not.toBeInTheDocument()
})

it('saves an editable draft before explicitly confirming it', async () => {
  const user = userEvent.setup()
  setSectionOpen('job-preferences', true)
  const criterion = { __typename: 'JobPreferenceCriterion' as const, id: 'criterion-1', text: 'Fully remote', priority: 'must_have' }
  const empty = { __typename: 'JobPreferenceProfile' as const, version: 0, confirmedRevision: 0, draftCriteria: [], confirmedCriteria: [] }
  const draft = { ...empty, version: 1, draftCriteria: [criterion] }
  const confirmed = { ...draft, version: 2, confirmedRevision: 2, confirmedCriteria: [criterion] }
  renderPage({ path: '/jobs/find', url: '/jobs/find', element: <JobPreferences />, mocks: [
    { request: { query: JOB_PREFERENCES_QUERY }, result: { data: { jobPreferences: empty } } },
    { request: { query: SAVE_JOB_PREFERENCE_DRAFT, variables: { expectedVersion: 0, criteria: [{ text: 'Fully remote', priority: 'must_have' }] } }, result: { data: { saveJobPreferenceDraft: { __typename: 'SaveDraftPayload', profile: draft, errors: [] } } } },
    { request: { query: CONFIRM_JOB_PREFERENCES, variables: { expectedVersion: 1 } }, result: { data: { confirmJobPreferences: { __typename: 'ConfirmPayload', profile: confirmed, errors: [] } } } },
  ] })
  await user.click(await screen.findByRole('button', { name: 'Add preference' }))
  expect(screen.queryByRole('textbox', { name: 'Tell me what you want next' })).not.toBeInTheDocument()
  await user.type(screen.getByRole('textbox', { name: 'Preference 1' }), 'Fully remote')
  expect(screen.getByRole('button', { name: 'Confirm saved preferences' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'Save draft' }))
  expect(await screen.findByText('Draft saved. Confirm it when it reflects what you want.')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Confirm saved preferences' }))
  expect(await screen.findByText('Confirmed preferences are ready to reuse in later searches.')).toBeInTheDocument()
  expect(screen.getByRole('list', { name: 'Confirmed preferences' })).toHaveTextContent('Fully remote')
})

it('reopens a confirmed summary and clears only the current profile revision', async () => {
  const user = userEvent.setup()
  setSectionOpen('job-preferences', true)
  const criterion = { __typename: 'JobPreferenceCriterion' as const, id: 'criterion-1', text: 'Climate work', priority: 'nice_to_have' }
  const profile = { __typename: 'JobPreferenceProfile' as const, version: 2, confirmedRevision: 2, draftCriteria: [criterion], confirmedCriteria: [criterion] }
  const cleared = { ...profile, version: 3, confirmedRevision: 3, draftCriteria: [], confirmedCriteria: [] }
  renderPage({ path: '/jobs/find', url: '/jobs/find', element: <JobPreferences />, mocks: [
    { request: { query: JOB_PREFERENCES_QUERY }, result: { data: { jobPreferences: profile } } },
    { request: { query: CLEAR_JOB_PREFERENCES, variables: { expectedVersion: 2 } }, result: { data: { clearJobPreferences: { __typename: 'ClearPayload', profile: cleared, errors: [] } } } },
  ] })
  expect(await screen.findByRole('textbox', { name: 'Preference 1' })).toHaveValue('Climate work')
  expect(screen.getByRole('combobox', { name: 'Priority 1' })).toHaveValue('nice_to_have')
  expect(screen.getByRole('list', { name: 'Confirmed preferences' })).toHaveTextContent('Nice-to-have')
  await user.click(screen.getByRole('button', { name: 'Clear all preferences' }))
  expect(await screen.findByText('No confirmed preferences. Checks stay off until you confirm what you want.')).toBeInTheDocument()
  expect(screen.queryByRole('textbox', { name: 'Preference 1' })).not.toBeInTheDocument()
})

it('preserves unsaved edits on a stale-save error and allows explicit reload', async () => {
  const user = userEvent.setup()
  setSectionOpen('job-preferences', true)
  const profile = { __typename: 'JobPreferenceProfile' as const, version: 0, confirmedRevision: 0, draftCriteria: [], confirmedCriteria: [] }
  const current = { ...profile, version: 2, confirmedRevision: 2, draftCriteria: [{ __typename: 'JobPreferenceCriterion' as const, id: 'latest', text: 'Latest preference', priority: 'must_have' }], confirmedCriteria: [] }
  renderPage({ path: '/jobs/find', url: '/jobs/find', element: <JobPreferences />, mocks: [
    { request: { query: JOB_PREFERENCES_QUERY }, result: { data: { jobPreferences: profile } } },
    { request: { query: SAVE_JOB_PREFERENCE_DRAFT, variables: { expectedVersion: 0, criteria: [{ text: 'My edit', priority: 'must_have' }] } }, result: { data: { saveJobPreferenceDraft: { __typename: 'SaveDraftPayload', profile: null, errors: ['Preferences changed. Reload them before saving or confirming.'] } } } },
    { request: { query: JOB_PREFERENCES_QUERY }, result: { data: { jobPreferences: current } } },
  ] })
  await user.click(await screen.findByRole('button', { name: 'Add preference' }))
  await user.type(screen.getByRole('textbox', { name: 'Preference 1' }), 'My edit')
  await user.click(screen.getByRole('button', { name: 'Save draft' }))
  expect(await screen.findByText('Preferences changed. Reload them before saving or confirming.')).toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: 'Preference 1' })).toHaveValue('My edit')
  await user.click(screen.getByRole('button', { name: 'Reload preferences' }))
  expect(await screen.findByDisplayValue('Latest preference')).toBeInTheDocument()
})

it('keeps editing bounded and requires nonblank preference text', async () => {
  const user = userEvent.setup()
  setSectionOpen('job-preferences', true)
  const profile = { __typename: 'JobPreferenceProfile' as const, version: 0, confirmedRevision: 0, draftCriteria: [], confirmedCriteria: [] }
  renderPage({ path: '/jobs/find', url: '/jobs/find', element: <JobPreferences />, mocks: [
    { request: { query: JOB_PREFERENCES_QUERY }, result: { data: { jobPreferences: profile } } },
  ] })
  const add = await screen.findByRole('button', { name: 'Add preference' })
  for (let i = 0; i < 10; i++) await user.click(add)
  expect(add).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'Remove preference 1' }))
  expect(add).toBeEnabled()
})
