/**
 * Description: Tests for grouping skills by category.
 */
import { expect, it } from 'vitest'
import { groupSkillsByCategory } from './groupSkillsByCategory'

it('groups by category in first-seen order, with uncategorized skills last under "Other"', () => {
  const groups = groupSkillsByCategory([
    { id: '1', name: 'Docker', category: null },
    { id: '2', name: 'Ruby', category: 'Languages' },
    { id: '3', name: 'Postgres', category: 'Databases' },
    { id: '4', name: 'Python', category: 'Languages' },
  ])

  expect(groups.map(([category, skills]) => [category, skills.map((skill) => skill.name)])).toEqual([
    ['Languages', ['Ruby', 'Python']],
    ['Databases', ['Postgres']],
    ['Other', ['Docker']],
  ])
})
