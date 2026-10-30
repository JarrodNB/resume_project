/** Validate complete native probabilities and rank by confirmed preference priorities. */
import type { JobPreferencesQuery } from '@/graphql/generated/graphql'
import type { BoardListing } from './jobBoardVisit'

type Profile = JobPreferencesQuery['jobPreferences']
export type CriterionDecision = { id: string; probability: number }
export type ListingAssessment = { decisions: CriterionDecision[]; truncated: boolean }
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const exactKeys = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))

/** Reject partial, stale or nonnumeric results; probabilities are independent, not a distribution. */
export function boardPreferenceDecisions(result: unknown, listings: BoardListing[], profile: Profile): Map<string, ListingAssessment> | null {
  if (!record(result) || !exactKeys(result, ['confirmed_revision', 'listings']) || result.confirmed_revision !== profile.confirmedRevision
    || profile.confirmedCriteria.length < 1 || profile.confirmedCriteria.length > 10 || !Array.isArray(result.listings) || result.listings.length !== listings.length) return null
  const values = new Map<string, ListingAssessment>()
  for (let index = 0; index < listings.length; index++) {
    const item = result.listings[index]
    const listing = listings[index]
    if (!record(item) || !exactKeys(item, ['id', 'source_digest', 'truncated', 'criteria']) || item.id !== listing.id
      || item.source_digest !== listing.preferenceSourceDigest || typeof item.truncated !== 'boolean'
      || !Array.isArray(item.criteria) || item.criteria.length !== profile.confirmedCriteria.length) return null
    const decisions: CriterionDecision[] = []
    for (let criterionIndex = 0; criterionIndex < item.criteria.length; criterionIndex++) {
      const decision = item.criteria[criterionIndex]
      if (!record(decision) || !exactKeys(decision, ['id', 'probability']) || decision.id !== profile.confirmedCriteria[criterionIndex].id
        || typeof decision.probability !== 'number' || !Number.isFinite(decision.probability) || decision.probability < 0 || decision.probability > 1) return null
      decisions.push({ id: decision.id as string, probability: decision.probability })
    }
    if (values.has(listing.id)) return null
    values.set(listing.id, { decisions, truncated: item.truncated })
  }
  return values
}

/** Highest mean must-have probability first, then nice-to-have mean; provider order breaks ties. */
export function orderByPreferences(listings: BoardListing[], assessments: Map<string, ListingAssessment>, profile: Profile) {
  const priorities = new Map(profile.confirmedCriteria.map((criterion) => [criterion.id, criterion.priority]))
  const score = (id: string, priority: string) => {
    const decisions = assessments.get(id)?.decisions.filter((item) => priorities.get(item.id) === priority) ?? []
    return decisions.length ? decisions.reduce((total, item) => total + item.probability, 0) / decisions.length : 0
  }
  return listings.map((listing, index) => ({ listing, index, must: score(listing.id, 'must_have'), nice: score(listing.id, 'nice_to_have') }))
    .sort((a, b) => b.must - a.must || b.nice - a.nice || a.index - b.index)
    .map(({ listing }) => listing)
}
