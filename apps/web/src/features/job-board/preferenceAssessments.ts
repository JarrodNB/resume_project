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
    const listing = listings[index]
    const assessment = parseListingAssessment(result.listings[index], listing, profile.confirmedCriteria)
    if (!assessment || values.has(listing.id)) return null
    values.set(listing.id, assessment)
  }
  return values
}

/** Parse one listing only when its source and complete ordered criteria still match. */
function parseListingAssessment(value: unknown, listing: BoardListing, criteria: Profile['confirmedCriteria']): ListingAssessment | null {
  if (!record(value) || !exactKeys(value, ['id', 'source_digest', 'truncated', 'criteria']) || value.id !== listing.id
    || value.source_digest !== listing.preferenceSourceDigest || typeof value.truncated !== 'boolean'
    || !Array.isArray(value.criteria) || value.criteria.length !== criteria.length) return null
  const decisions: CriterionDecision[] = []
  for (let index = 0; index < value.criteria.length; index++) {
    const decision = value.criteria[index]
    const criterion = criteria[index]
    if (!record(decision) || !exactKeys(decision, ['id', 'probability']) || decision.id !== criterion.id
      || typeof decision.probability !== 'number' || !Number.isFinite(decision.probability) || decision.probability < 0 || decision.probability > 1) return null
    decisions.push({ id: criterion.id, probability: decision.probability })
  }
  return { decisions, truncated: value.truncated }
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
