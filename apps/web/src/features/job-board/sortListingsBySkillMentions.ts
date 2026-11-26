/** Puts job-board listings with the most saved-skill mentions first.
 *
 * Counts every mention of every saved skill in a listing's description, using the same
 * matching as the skill summary on each row. Listings with equal counts (or no description)
 * keep their search order. Only reorders what is already loaded; it does not fetch anything.
 */
import { skillMentionCount } from '@/features/jobs/skillMentionCounts'
import { stripRecruiterTags } from './listingDisplay'

export function sortListingsBySkillMentions<T extends { description?: string | null }>(
  listings: readonly T[],
  skills: readonly { name: string }[] | null,
): T[] {
  if (!skills?.length) return [...listings]
  return listings
    .map((listing, index) => {
      const description = listing.description ? stripRecruiterTags(listing.description) : ''
      const total = description.trim() ? skills.reduce((sum, skill) => sum + skillMentionCount(description, skill.name), 0) : 0
      return { listing, index, total }
    })
    .sort((a, b) => b.total - a.total || a.index - b.index)
    .map(({ listing }) => listing)
}
