/**
 * Description: Skills grouped by category, shown as chips.
 * Index:
 *   - SkillList: renders each category with its skills
 */
import { Badge } from '@/components/ui/badge'
import { groupSkillsByCategory, type CategorizedSkill } from './groupSkillsByCategory'

/** Renders each category heading with its skills as chips. */
export function SkillList({ skills }: { skills: CategorizedSkill[] }) {
  return (
    <div className="grid gap-3">
      {groupSkillsByCategory(skills).map(([category, categorySkills]) => (
        <div key={category} className="grid gap-1.5">
          <p className="text-sm font-medium text-muted-foreground">{category}</p>
          <div className="flex flex-wrap gap-1.5">
            {categorySkills.map((skill) => (
              <Badge key={skill.id} variant="secondary">
                {skill.name}
              </Badge>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
