/** Counts literal saved skill names for Fit and job-board listings, without inferring aliases.
 * Reuses a bounded set of patterns so skill edits and account switches do not grow the cache forever.
 */
export function skillMentionCount(description: string, skillName: string): number {
  if (!skillName.trim()) return 0
  return [...description.matchAll(mentionPattern(skillName))].length
}

// Reuse patterns across listings. This comfortably holds one user's 80 saved skills.
const MAX_CACHED_PATTERNS = 256
const mentionPatterns = new Map<string, RegExp>()

function mentionPattern(skillName: string): RegExp {
  const cached = mentionPatterns.get(skillName)
  if (cached) return cached
  const literal = skillName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // Letters, digits, marks, and programming suffixes belong to the same name.
  // Dots/hyphens join names internally, but a sentence-ending dot is a delimiter.
  const nameCharacter = String.raw`[\p{L}\p{N}\p{M}_+#]`
  const before = `(?<!${nameCharacter})(?<!${nameCharacter}[.-])`
  const after = `(?!${nameCharacter}|[.-]${nameCharacter})`
  const pattern = new RegExp(`${before}${literal}${after}`, 'giu')
  if (mentionPatterns.size >= MAX_CACHED_PATTERNS) {
    const oldest = mentionPatterns.keys().next().value
    if (oldest !== undefined) mentionPatterns.delete(oldest)
  }
  mentionPatterns.set(skillName, pattern)
  return pattern
}
