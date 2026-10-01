/**
 * Description: Groups skills by category for display.
 * Index:
 *   - CategorizedSkill: the skill fields grouping needs
 *   - groupSkillsByCategory: groups skills, keeping first-seen category order, "Other" last
 */

export interface CategorizedSkill {
  id: string
  name: string
  category?: string | null
}

/** Groups skills by category in first-seen order, with uncategorized skills under "Other" at the end. */
export function groupSkillsByCategory<Skill extends CategorizedSkill>(skills: Skill[]): [string, Skill[]][] {
  const groups = new Map<string, Skill[]>()
  const categorizedFirst = [...skills].sort((a, b) => Number(!a.category) - Number(!b.category))
  for (const skill of categorizedFirst) {
    const category = skill.category ?? 'Other'
    groups.set(category, [...(groups.get(category) ?? []), skill])
  }
  return [...groups.entries()]
}
