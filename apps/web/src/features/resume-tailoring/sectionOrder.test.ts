/** Checks section ordering: contact stays first and a default keeps sections a resume lacks. */
import { describe, expect, it } from 'vitest'
import { defaultOrderFromResume, MOVABLE_SECTIONS, sectionsInOrder } from './sectionOrder'

const named = (...types: Parameters<typeof sectionsInOrder>[1]) => types.map((sectionType) => ({ sectionType }))

describe('sectionsInOrder', () => {
  it('follows the order with contact always first, even if the order lists it last', () => {
    const result = sectionsInOrder(named('summary', 'contact', 'skills'), ['skills', 'summary', 'contact'])
    expect(result.map((section) => section.sectionType)).toEqual(['contact', 'skills', 'summary'])
  })

  it('puts sections the order does not list after the rest', () => {
    const result = sectionsInOrder(named('education', 'summary', 'skills'), ['skills', 'summary'])
    expect(result.map((section) => section.sectionType)).toEqual(['skills', 'summary', 'education'])
  })
})

describe('defaultOrderFromResume', () => {
  it('adopts the whole order of a resume with every section', () => {
    const order = ['skills', 'summary', 'experience', 'projects', 'education', 'certifications'] as const
    expect(defaultOrderFromResume(['contact', ...order], MOVABLE_SECTIONS)).toEqual(order)
  })

  it('keeps sections the resume lacks in their default slots', () => {
    expect(defaultOrderFromResume(['contact', 'skills', 'experience'], MOVABLE_SECTIONS))
      .toEqual(['summary', 'skills', 'projects', 'education', 'certifications', 'experience'])
  })
})
