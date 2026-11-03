/** Checks which resume sections can be dragged: never contact, and only when there is a choice. */
import { render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { ResumeSectionList } from './ResumeSectionList'
import type { TailorSectionType } from './sectionOrder'

function renderList(types: TailorSectionType[]) {
  render(
    <ResumeSectionList
      sections={types}
      idOf={(type) => type}
      typeOf={(type) => type}
      titleOf={(type) => type}
      onReorder={vi.fn()}
      renderSection={(type, dragHandle) => <section aria-label={type}>{dragHandle}</section>}
    />,
  )
}

it('keeps contact first and gives only the other sections a drag handle', () => {
  renderList(['contact', 'summary', 'skills'])

  expect(screen.queryByRole('button', { name: 'Drag contact section' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Drag summary section' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Drag skills section' })).toBeInTheDocument()
  const order = screen.getAllByRole('region').map((region) => region.getAttribute('aria-label'))
  expect(order).toEqual(['contact', 'summary', 'skills'])
})

it('offers no handle when only one section could move', () => {
  renderList(['contact', 'summary'])

  expect(screen.queryByRole('button', { name: /^Drag/ })).not.toBeInTheDocument()
})
