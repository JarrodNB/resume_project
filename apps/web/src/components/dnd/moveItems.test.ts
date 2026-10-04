/**
 * Description: Tests for the pure drag-and-drop helpers.
 */
import { describe, expect, it } from 'vitest'
import { findItemLocation, idFromSortableId, moveBetweenGroups, reorderList, sortableGroupId, sortableId } from './moveItems'

describe('sortable ids', () => {
  it('prefixes ids with their kind and reads them back', () => {
    expect(sortableId('skill', '4')).toBe('skill:4')
    expect(sortableGroupId('highlights', '12')).toBe('highlights-of:12')
    expect(idFromSortableId('skill:4')).toBe('4')
    expect(idFromSortableId('highlights-of:12')).toBe('12')
  })
})

describe('reorderList', () => {
  it('moves an item forward or backward without changing the input', () => {
    const items = ['a', 'b', 'c', 'd']
    expect(reorderList(items, 0, 2)).toEqual(['b', 'c', 'a', 'd'])
    expect(reorderList(items, 3, 1)).toEqual(['a', 'd', 'b', 'c'])
    expect(items).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('moveBetweenGroups', () => {
  const groups = { jobA: ['a1', 'a2', 'a3'], jobB: ['b1'], jobC: [] as string[] }

  it('reorders within one group', () => {
    expect(moveBetweenGroups(groups, { from: { group: 'jobA', index: 2 }, to: { group: 'jobA', index: 0 } })).toEqual({
      ...groups,
      jobA: ['a3', 'a1', 'a2'],
    })
  })

  it('moves an item into another group, including an empty one', () => {
    expect(moveBetweenGroups(groups, { from: { group: 'jobA', index: 1 }, to: { group: 'jobB', index: 0 } })).toEqual({
      ...groups,
      jobA: ['a1', 'a3'],
      jobB: ['a2', 'b1'],
    })
    expect(moveBetweenGroups(groups, { from: { group: 'jobB', index: 0 }, to: { group: 'jobC', index: 0 } })).toEqual({
      ...groups,
      jobB: [],
      jobC: ['b1'],
    })
  })
})

describe('findItemLocation', () => {
  it('returns the group and index, or null', () => {
    const groups = { jobA: ['a1', 'a2'], jobB: ['b1'] }
    expect(findItemLocation(groups, 'a2')).toEqual({ group: 'jobA', index: 1 })
    expect(findItemLocation(groups, 'b1')).toEqual({ group: 'jobB', index: 0 })
    expect(findItemLocation(groups, 'zz')).toBeNull()
  })
})
