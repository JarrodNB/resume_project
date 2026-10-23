/** Grouped and legacy resume snapshots must survive editing and PDF conversion. */
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SectionFields } from './SectionFields'
import { sectionDraftFromContent, contentFromSectionDraft } from './tailorDraft'
import { buildResumePdfModel } from './resumePdfModel'

const grouped = { company: 'Example', source_experience_id: 'employment', location: 'Remote', description: null,
  highlights: ['Built tools'], highlight_source_ids: [['h1']], roles: [
    { id: 'r1', title: 'Senior Engineer', start_date: '2025-01', end_date: null, is_current: true, description: 'Led the team', highlights: ['Led migrations'], highlight_source_ids: [['h2']] },
    { id: 'r2', title: 'Engineer', start_date: '2020-01', end_date: '2024-12', is_current: false, description: null, highlights: [] },
  ] }

describe('grouped tailored experience', () => {
  it('round trips shared and scoped achievements and provenance without merging entries', () => {
    const content = contentFromSectionDraft(sectionDraftFromContent('experience', { items: [grouped, grouped] }))
    const items = content.items as typeof grouped[]
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject(grouped)
    expect(JSON.stringify(items)).not.toContain('"key":')
  })
  it('normalizes old flat snapshots into one editable role without mutating the source', () => {
    const old = { company: 'Example', title: 'Engineer', start_date: '2020-01', end_date: '2024-12', highlights: ['Built tools'] }
    const draft = sectionDraftFromContent('experience', { items: [old] })
    const items = contentFromSectionDraft(draft).items as typeof grouped[]
    expect(items[0].roles[0]).toMatchObject({ title: 'Engineer', start_date: '2020-01' })
    expect(items[0].highlights).toEqual(['Built tools'])
    expect(old).not.toHaveProperty('roles')
  })
  it('prints one company with titles and dates and one shared list', () => {
    const model = buildResumePdfModel([{ sectionType: 'experience', title: 'Experience', content: { items: [grouped] } }])
    const entry = model.blocks[0].entries[0]
    expect(entry.heading).toBe('Example')
    expect(entry.bullets).toEqual(['Built tools'])
    expect(entry.roles?.map((role) => role.heading)).toEqual(['Senior Engineer', 'Engineer'])
    expect(entry.roles?.[0].bullets).toEqual(['Led migrations'])
    expect(entry.roles?.[1].dates).toContain('2024')
  })
  it('edits nested titles and shared bullets through the same fields used by both editors', () => {
    let draft = sectionDraftFromContent('experience', { items: [grouped] })
    const { rerender } = render(<SectionFields draft={draft} onChange={change} />)
    function change(next: typeof draft) { draft = next; rerender(<SectionFields draft={draft} onChange={change} />) }
    const role = screen.getByRole('group', { name: 'Role 1' })
    fireEvent.change(within(role).getByLabelText(/Title/), { target: { value: 'Staff Engineer' } })
    fireEvent.change(within(screen.getByRole('group', { name: 'Shared highlights' })).getByLabelText('Highlights 1'), { target: { value: 'Built better tools' } })
    const items = contentFromSectionDraft(draft).items as typeof grouped[]
    expect(items[0].roles[0].title).toBe('Staff Engineer')
    expect(items[0].highlights).toEqual(['Built better tools'])
    expect(items[0].highlight_source_ids).toEqual([['h1']])
    expect(items[0].roles[0].highlights).toEqual(['Led migrations'])
  })
})
