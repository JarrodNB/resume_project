/** Verifies skill summaries and the complete breakdown through the listing's existing preview. */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'
import { MemoryRouter } from 'react-router'
import { renderPage } from '@/test/renderPage'
import { JobBoardListingRow } from './JobBoardListingRow'
import type { BoardListing } from './jobBoardVisit'

const listing: BoardListing = {
  id: 'listing', preferenceSourceDigest: 'digest', title: 'Engineer', company: 'Acme',
  location: null, description: 'SQL Python Rust Docker AWS Python SQL Python.', applicationUrl: null,
  hasRemote: false, remoteType: null, published: null, employmentType: null, salaryText: null, salaryCurrency: null, savedJob: null,
}
const skills = ['Rust', 'Python', 'SQL', 'Docker', 'AWS', 'Java'].map((name, position) => ({
  __typename: 'Skill' as const, id: name, name, position,
}))
function renderListing(description = listing.description) {
  return renderPage({ path: '/', url: '/', element: <ul><JobBoardListingRow listing={{ ...listing, description }} skills={skills} busyId={null} errors={[]} onCreate={() => {}} /></ul> })
}

it('shows the top three and opens all saved skills through the keyboard-accessible overflow control', async () => {
  const user = userEvent.setup()
  renderListing()
  const article = screen.getByRole('article')
  expect(within(article).getByText('5 of 6 saved skills mentioned')).toBeVisible()
  expect(within(article).getAllByRole('listitem').map(item => item.textContent)).toEqual([
    'Python · 3 mentions', 'SQL · 2 mentions', 'Rust · 1 mention',
  ])
  const more = within(article).getByRole('button', { name: '+2 more' })
  more.focus()
  await user.keyboard('{Enter}')
  const dialog = screen.getByRole('dialog')
  expect(within(dialog).queryByRole('list', { name: 'Saved skill mentions' })).not.toBeInTheDocument()
  await user.click(within(dialog).getByRole('button', { name: 'Skill mentions' }))
  const fullList = within(dialog).getByRole('list', { name: 'Saved skill mentions' })
  expect(within(fullList).getAllByRole('listitem').map(item => item.textContent)).toEqual([
    'Rust1 mention', 'Python3 mentions', 'SQL2 mentions', 'Docker1 mention', 'AWS1 mention',
  ])
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(more).toHaveFocus()
})

it.each(['', '   '])('distinguishes unavailable descriptions %j from zero mentions', async description => {
  const user = userEvent.setup()
  renderListing(description)
  expect(screen.getByText('Skill mentions unavailable: no description.')).toBeVisible()
  expect(screen.queryByText(/saved skills mentioned/)).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Engineer' }))
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Skill mentions' }))
  expect(within(screen.getByRole('dialog')).getByText('Skill mentions unavailable: no description.')).toBeVisible()
  expect(screen.queryByText('Not mentioned')).not.toBeInTheDocument()
})

it('labels a valid description with no saved-skill occurrences', () => {
  renderListing('JavaScript developer')
  expect(screen.getByText('No saved skills mentioned')).toBeVisible()
  expect(screen.queryByText(/Java ·/)).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /more/ })).not.toBeInTheDocument()
})


it('returns focus to the title when it opened a preview that also has an overflow trigger', async () => {
  const user = userEvent.setup()
  renderListing()
  const title = screen.getByRole('button', { name: 'Engineer' })
  await user.click(title)
  expect(screen.getByRole('dialog')).toBeVisible()
  await user.keyboard('{Escape}')
  expect(title).toHaveFocus()
})

it('recomputes visible counts when loaded description or saved skills change', () => {
  const view = (description: string, names = skills) => <ul><JobBoardListingRow listing={{ ...listing, description }} skills={names} busyId={null} errors={[]} onCreate={() => {}} /></ul>
  const { rerender } = render(<MemoryRouter>{view('Python')}</MemoryRouter>)
  expect(screen.getByText('Python · 1 mention')).toBeVisible()
  // The row remains in the same page while refreshed inputs arrive from Apollo.
  rerender(<MemoryRouter>{view('Python Python')}</MemoryRouter>)
  expect(screen.getByText('Python · 2 mentions')).toBeVisible()
  rerender(<MemoryRouter>{view('Python Python', [{ ...skills[0], name: 'Java' }])}</MemoryRouter>)
  expect(screen.getByText('No saved skills mentioned')).toBeVisible()
})

it('returns focus to the title if refreshed counts remove the overflow opener while preview is open', async () => {
  const user = userEvent.setup()
  const view = (description: string) => <MemoryRouter><ul><JobBoardListingRow listing={{ ...listing, description }} skills={skills} busyId={null} errors={[]} onCreate={() => {}} /></ul></MemoryRouter>
  const { rerender } = render(view(listing.description))
  await user.click(screen.getByRole('button', { name: '+2 more' }))
  rerender(view('Python'))
  await user.keyboard('{Escape}')
  expect(screen.getByRole('button', { name: 'Engineer' })).toHaveFocus()
})
