/**
 * Description: The import notice can be dismissed, hides on its own, and is not restored from
 * navigation state after that state is cleared (what a refresh would load).
 */
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { renderPage } from '@/test/renderPage'
import { IMPORT_SUMMARY_NOTICE_MS, ImportSummaryNotice } from './ImportSummaryNotice'
import { TRANSIENT_ALERT_EXIT_MS } from '@/components/TransientAlert'

const summaryState = { importSummary: { added: 1, merged: 4 } }

/** Renders the notice as if the library was just opened with this navigation state. */
function renderNotice(historyState: unknown = summaryState) {
  return renderPage({
    path: '/library',
    url: '/library',
    historyState,
    element: <ImportSummaryNotice />,
  })
}

afterEach(() => {
  vi.useRealTimers()
})

it('shows the import counts and drops them from the history entry', async () => {
  window.history.replaceState({ usr: summaryState, key: 'test', idx: 0 }, '', '/library')
  renderNotice()

  expect(screen.getByText('1 entry added, 4 merged into existing entries.')).toBeInTheDocument()
  await waitFor(() => expect(window.history.state.usr).toBeNull())
  expect(screen.getByText('Resume imported')).toBeInTheDocument()
})

it('hides when dismissed', async () => {
  renderNotice()

  await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))

  await waitFor(() => expect(screen.queryByText('Resume imported')).not.toBeInTheDocument())
})

it('hides on its own after a few seconds', async () => {
  vi.useFakeTimers()
  renderNotice()

  expect(screen.getByText('Resume imported')).toBeInTheDocument()
  await act(async () => {
    await vi.advanceTimersByTimeAsync(IMPORT_SUMMARY_NOTICE_MS)
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(TRANSIENT_ALERT_EXIT_MS)
  })

  expect(screen.queryByText('Resume imported')).not.toBeInTheDocument()
})

it('shows nothing when opened without an import summary, as a refresh would', () => {
  renderNotice(null)

  expect(screen.queryByText('Resume imported')).not.toBeInTheDocument()
})
