/** Counts literal saved skill names in one description; no aliases or inferred skills. */
export function skillMentionCount(description: string, skillName: string): number {
  if (!skillName.trim()) return 0
  return [...description.matchAll(mentionPattern(skillName))].length
}

// Job boards count every skill against every listing, so compile each skill's pattern once.
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
  mentionPatterns.set(skillName, pattern)
  return pattern
}
