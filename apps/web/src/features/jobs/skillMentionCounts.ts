/** Counts literal saved skill names in one description; no aliases or inferred skills. */
export function skillMentionCount(description: string, skillName: string): number {
  if (!skillName.trim()) return 0
  const literal = skillName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // Letters, digits, marks, and programming suffixes belong to the same name.
  // Dots/hyphens join names internally, but a sentence-ending dot is a delimiter.
  const nameCharacter = String.raw`[\p{L}\p{N}\p{M}_+#]`
  const before = `(?<!${nameCharacter})(?<!${nameCharacter}[.-])`
  const after = `(?!${nameCharacter}|[.-]${nameCharacter})`
  return [...description.matchAll(new RegExp(`${before}${literal}${after}`, 'giu'))].length
}
