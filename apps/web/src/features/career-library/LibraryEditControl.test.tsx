/** Follow an individual edit through actual GraphQL mocks and task subscription updates. */
import { render, screen, waitFor } from '@testing-library/react'
import { MockedProvider } from '@apollo/client/testing/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'
import { AI_TASK_UPDATED_SUBSCRIPTION } from '@/features/ai-tasks/aiTaskOperations'
import { renderPage } from '@/test/renderPage'
import { LibraryEditControl } from './LibraryEditControl'
import { ACCEPT_LIBRARY_EDIT_MUTATION, LIBRARY_EDIT_QUERY, START_LIBRARY_EDIT_MUTATION } from './libraryEditOperations'

const target = { kind: 'experience_highlight', recordId: 'h1' }
const query = { query: LIBRARY_EDIT_QUERY, variables: target }
const task = { __typename: 'AiTask' as const, id: 'edit-1', status: 'COMPLETED' as const,
  result: { text: 'Migrated the billing API with the platform team.', color: 'yellow', reason: 'Add an outcome if known.' },
  input: {}, pendingQuestions: [], errorMessage: null, acceptedAt: null }
const subscription = (value: { id: string } & Record<string, unknown> = task) => ({ request: { query: AI_TASK_UPDATED_SUBSCRIPTION, variables: { id: value.id } },
  result: { data: { aiTaskUpdated: { ...value, taskType: 'IMPROVE_LIBRARY_ENTRY', createdAt: '2026-10-25T00:00:00Z', job: null } } } })
const element = <LibraryEditControl {...target} currentText="Helped with migration" sourceRevision="same" />

it('opens saved work and accepts only its server-owned proposal', async () => {
  renderPage({ path: '/', url: '/', element, mocks: [
    { request: query, result: { data: { libraryEdit: { __typename: 'LibraryEdit', stale: false, aiTask: task } } } },
    subscription(),
    { request: { query: ACCEPT_LIBRARY_EDIT_MUTATION, variables: { aiTaskId: task.id } }, result: { data: {
      acceptLibraryEdit: { __typename: 'AcceptLibraryEditPayload', errors: [], aiTask: { ...task, acceptedAt: '2026-10-25T00:00:01Z' } },
    } } },
  ] })
  await userEvent.click(screen.getByRole('button', { name: 'Improve with AI' }))
  expect(await screen.findByText('Migrated the billing API with the platform team.')).toBeInTheDocument()
  expect(screen.getByText('Helped with migration')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Accept revision' }))
  expect(await screen.findByText('Saved to your library.')).toBeInTheDocument()
})

it('restores a pending question and submits a skip as a single continuation', async () => {
  const waiting = { ...task, status: 'NEEDS_USER_INPUT' as const, result: null,
    pendingQuestions: [{ id: 'q1', question: 'Which part did you handle?' }] }
  const next = { ...task, id: 'edit-2' }
  renderPage({ path: '/', url: '/', element, mocks: [
    { request: query, result: { data: { libraryEdit: { __typename: 'LibraryEdit', stale: false, aiTask: waiting } } } },
    subscription(waiting),
    { request: { query: START_LIBRARY_EDIT_MUTATION, variables: { ...target, feedback: '', skip: true, previousTaskId: 'edit-1' } },
      result: { data: { startLibraryEdit: { __typename: 'StartLibraryEditPayload', aiTask: next, errors: [] } } } },
    subscription(next),
  ] })
  await userEvent.click(screen.getByRole('button', { name: 'Improve with AI' }))
  expect(await screen.findByText('Which part did you handle?')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Skip question' }))
  expect(await screen.findByText('Migrated the billing API with the platform team.')).toBeInTheDocument()
  expect(screen.queryByText('Which part did you handle?')).not.toBeInTheDocument()
})

it('allows another edit after reopening an accepted draft, with optional initial feedback', async () => {
  const accepted = { ...task, acceptedAt: '2026-10-25T00:00:01Z' }
  const next = { ...task, id: 'edit-new' }
  renderPage({ path: '/', url: '/', element, mocks: [
    { request: query, result: { data: { libraryEdit: { __typename: 'LibraryEdit', stale: true, aiTask: accepted } } } },
    subscription(accepted),
    { request: { query: START_LIBRARY_EDIT_MUTATION, variables: { ...target, feedback: '', skip: false, previousTaskId: null } },
      result: { data: { startLibraryEdit: { __typename: 'StartLibraryEditPayload', aiTask: next, errors: [] } } } },
    subscription(next),
  ] })
  await userEvent.click(screen.getByRole('button', { name: 'Improve with AI' }))
  await userEvent.click(await screen.findByRole('button', { name: 'Start another edit' }))
  expect(screen.getByLabelText('What would you like to improve? (optional)')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Generate revision' }))
  expect(await screen.findByText('Proposed revision')).toBeInTheDocument()
})

it('disables acceptance immediately when the visible source changes, even if refresh fails', async () => {
  const fresh = { ...task, id: 'fresh-edit' }
  const mocks = [
    { request: query, result: { data: { libraryEdit: { __typename: 'LibraryEdit', stale: false, aiTask: task } } } },
    subscription(),
    { request: query, error: new Error('offline after edit') },
    { request: { query: START_LIBRARY_EDIT_MUTATION, variables: { ...target, feedback: '', skip: false, previousTaskId: null } },
      result: { data: { startLibraryEdit: { __typename: 'StartLibraryEditPayload', aiTask: fresh, errors: [] } } } },
    subscription(fresh),
  ]
  const view = (source: string) => <MockedProvider mocks={mocks}><LibraryEditControl {...target} currentText={source} sourceRevision={source} /></MockedProvider>
  const { rerender } = render(view('before'))
  await userEvent.click(screen.getByRole('button', { name: 'Improve with AI' }))
  expect(await screen.findByRole('button', { name: 'Accept revision' })).toBeEnabled()
  rerender(view('after'))
  expect(screen.getByRole('button', { name: 'Accept revision' })).toBeDisabled()
  expect(await screen.findByText('Could not refresh this edit. Reload to continue.')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Start from current text' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Accept revision' })).toBeEnabled())
})
