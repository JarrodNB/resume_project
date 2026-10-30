/** Validate complete batch evidence and derive stable ordering from confirmed priorities. */
import type { JobPreferencesQuery } from '@/graphql/generated/graphql'
import type { BoardListing } from './jobBoardVisit'

type Profile = JobPreferencesQuery['jobPreferences']
export type CriterionDecision = { id: string; status: 'matching' | 'conflicting' | 'unknown'; reason: string;
  support: { passage_id: string; text: string } | null; contradiction: { passage_id: string; text: string } | null }
export type ListingAssessment = { decisions: CriterionDecision[]; truncated: boolean }
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** Expose no partial result when identity, criterion coverage or evidence references are wrong. */
export function boardPreferenceDecisions(result: unknown, listings: BoardListing[], profile: Profile): Map<string, ListingAssessment> | null {
  if (!record(result) || result.confirmed_revision !== profile.confirmedRevision || !Array.isArray(result.listings) || result.listings.length !== listings.length) return null
  const values = new Map<string, ListingAssessment>()
  for (let index = 0; index < listings.length; index++) {
    const item = result.listings[index]
    const listing = listings[index]
    if (!record(item) || item.id !== listing.id || item.source_digest !== listing.preferenceSourceDigest || typeof item.truncated !== 'boolean' || !Array.isArray(item.criteria) || item.criteria.length !== profile.confirmedCriteria.length || !Array.isArray(item.evidence_passages)) return null
    const passages = new Map<string, string>()
    for (const passage of item.evidence_passages) {
      if (!record(passage) || typeof passage.passage_id !== 'string' || typeof passage.text !== 'string' || !passage.text || passages.has(passage.passage_id)) return null
      passages.set(passage.passage_id, passage.text)
    }
    const evidence = (value: unknown) => value === null ? null : record(value) && typeof value.passage_id === 'string' && passages.has(value.passage_id)
      ? { passage_id: value.passage_id, text: passages.get(value.passage_id)! } : undefined
    const decisions: CriterionDecision[] = []
    for (let criterionIndex = 0; criterionIndex < item.criteria.length; criterionIndex++) {
      const decision = item.criteria[criterionIndex]
      if (!record(decision) || decision.id !== profile.confirmedCriteria[criterionIndex].id) return null
      const support = evidence(decision.support)
      const contradiction = evidence(decision.contradiction)
      if (support === undefined || contradiction === undefined) return null
      const status = support && contradiction ? 'unknown' : support ? 'matching' : contradiction ? 'conflicting' : 'unknown'
      const reason = support && contradiction ? 'contradictory_evidence' : support ? 'supported' : contradiction ? 'contradicted' : item.truncated ? 'incomplete_source' : 'not_stated'
      if (decision.status !== status || decision.reason !== reason) return null
      decisions.push({ id: decision.id as string, status, reason, support, contradiction })
    }
    if (values.has(listing.id)) return null
    values.set(listing.id, { decisions, truncated: item.truncated })
  }
  return values
}

/** Deterministic preference order with provider order as the final tie breaker. */
export function orderByPreferences(listings: BoardListing[], assessments: Map<string, ListingAssessment>, profile: Profile) {
  const priorities = new Map(profile.confirmedCriteria.map((criterion) => [criterion.id, criterion.priority]))
  const score = (id: string) => {
    const counts = [0, 0, 0, 0]
    for (const decision of assessments.get(id)?.decisions ?? []) {
      if (priorities.get(decision.id) === 'must_have') {
        if (decision.status === 'conflicting') counts[0]++
        else if (decision.status === 'unknown') counts[1]++
      } else if (decision.status === 'matching') counts[2]--
      else if (decision.status === 'conflicting') counts[3]++
    }
    return counts
  }
  return listings.map((listing, index) => ({ listing, index, score: score(listing.id) }))
    .sort((a, b) => a.score.reduce((difference, value, index) => difference || value - b.score[index], 0) || a.index - b.index)
    .map(({ listing }) => listing)
}
