/** Probability results retain identity fences and independent numeric values. */
import { expect, it } from 'vitest'
import type { BoardListing } from './jobBoardVisit'
import type { JobPreferencesQuery } from '@/graphql/generated/graphql'
import { boardPreferenceDecisions, orderByPreferences } from './preferenceAssessments'

const criteria = [
  { id: 'one', text: 'Remote', priority: 'must_have' },
  { id: 'two', text: 'Climate', priority: 'nice_to_have' },
]
const profile = { confirmedRevision: 2, confirmedCriteria: criteria } as JobPreferencesQuery['jobPreferences']
const listings = ['a', 'b', 'c'].map((id) => ({ id, preferenceSourceDigest: `digest-${id}` }) as BoardListing)
function result(probabilities = [[0.9, 0.8], [0.9, 0.95], [0.5, 1]]) {
  return { confirmed_revision: 2, listings: listings.map((item, index) => ({ id: item.id, source_digest: item.preferenceSourceDigest,
    truncated: false, criteria: criteria.map((criterion, criterionIndex) => ({ id: criterion.id, probability: probabilities[index][criterionIndex] })) })) }
}

it('retains independent probabilities above a summed one and prioritizes must-have then nice-have means', () => {
  const values = boardPreferenceDecisions(result(), listings, profile)!
  expect(values.get('a')?.decisions.map((item) => item.probability)).toEqual([0.9, 0.8])
  expect(orderByPreferences(listings, values, profile).map((item) => item.id)).toEqual(['b', 'a', 'c'])
  const ties = boardPreferenceDecisions(result([[0.9, 0.8], [0.9, 0.8], [0.5, 1]]), listings, profile)!
  expect(orderByPreferences(listings, ties, profile).map((item) => item.id)).toEqual(['a', 'b', 'c'])
})

it.each([-0.1, 1.1, NaN, Infinity, '0.9', true, null])('rejects non-probability %s without coercion', (probability) => {
  const value = result()
  Object.assign(value.listings[0].criteria[0], { probability })
  expect(boardPreferenceDecisions(value, listings, profile)).toBeNull()
})

it('rejects missing, extra, reordered and unknown criteria, stale digests and old categorical shapes', () => {
  for (const change of [
    (value: ReturnType<typeof result>) => { value.listings[0].criteria.pop() },
    (value: ReturnType<typeof result>) => { value.listings[0].criteria.push({ id: 'extra', probability: 0.9 }) },
    (value: ReturnType<typeof result>) => { value.listings[0].criteria.reverse() },
    (value: ReturnType<typeof result>) => { value.listings[0].criteria[0].id = 'unknown' },
    (value: ReturnType<typeof result>) => { value.listings[0].source_digest = 'stale' },
    (value: ReturnType<typeof result>) => { Object.assign(value.listings[0].criteria[0], { status: 'matching' }) },
  ]) {
    const value = result()
    change(value)
    expect(boardPreferenceDecisions(value, listings, profile)).toBeNull()
  }
})
