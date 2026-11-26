import { describe, expect, it } from 'vitest'
import { sortListingsBySkillMentions } from './sortListingsBySkillMentions'

describe('sortListingsBySkillMentions', () => {
  const skills = [{ name: 'React' }, { name: 'SQL' }]
  it('puts the listing with the most mentions first and keeps ties in order', () => {
    const listings = [
      { id: 'none', description: 'Cooking' },
      { id: 'one', description: 'We use React.' },
      { id: 'missing', description: null },
      { id: 'three', description: 'React, react and SQL' },
      { id: 'one-b', description: 'SQL' },
    ]
    expect(sortListingsBySkillMentions(listings, skills).map(l => l.id)).toEqual(['three', 'one', 'one-b', 'none', 'missing'])
  })
  it('keeps the search order without saved skills', () => {
    const listings = [{ id: 'a', description: 'x' }, { id: 'b', description: 'React' }]
    expect(sortListingsBySkillMentions(listings, null).map(l => l.id)).toEqual(['a', 'b'])
    expect(sortListingsBySkillMentions(listings, []).map(l => l.id)).toEqual(['a', 'b'])
  })
})
