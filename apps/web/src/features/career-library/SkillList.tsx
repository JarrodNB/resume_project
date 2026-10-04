/**
 * Description: Skills grouped by category, shown as chips with a delete button.
 * Index:
 *   - SkillList: renders each category with its skills; deleting asks for confirmation
 */
import { useState } from 'react'
import { X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { DeleteEntryDialog } from './DeleteEntryDialog'
import { groupSkillsByCategory, type CategorizedSkill } from './groupSkillsByCategory'
import { useLibraryEntryActions } from './useLibraryEntryActions'

/** Renders each category heading with its skills as chips. */
export function SkillList({ skills }: { skills: CategorizedSkill[] }) {
  const [skillToDelete, setSkillToDelete] = useState<CategorizedSkill | null>(null)
  const { deleteEntry, busy, errors, clearErrors } = useLibraryEntryActions('skill')

  /** Opens the confirmation for a skill, or closes it with null. */
  function confirmDelete(skill: CategorizedSkill | null) {
    clearErrors()
    setSkillToDelete(skill)
  }

  /** Deletes the chosen skill and closes the dialog on success. */
  async function deleteChosenSkill() {
    if (skillToDelete && (await deleteEntry(skillToDelete.id))) setSkillToDelete(null)
  }

  return (
    <div className="grid gap-3">
      {groupSkillsByCategory(skills).map(([category, categorySkills]) => (
        <div key={category} className="grid gap-1.5">
          <p className="text-sm font-medium text-muted-foreground">{category}</p>
          <div className="flex flex-wrap gap-1.5">
            {categorySkills.map((skill) => (
              <Badge key={skill.id} variant="secondary" className="gap-1 pr-1">
                {skill.name}
                <button
                  type="button"
                  className="rounded-full p-0.5 hover:bg-foreground/10"
                  aria-label={`Delete ${skill.name}`}
                  onClick={() => confirmDelete(skill)}
                >
                  <X className="size-3" />
                </button>
              </Badge>
            ))}
          </div>
        </div>
      ))}
      <DeleteEntryDialog
        open={skillToDelete !== null}
        onOpenChange={(open) => !open && confirmDelete(null)}
        entryLabel={skillToDelete?.name ?? ''}
        onConfirm={deleteChosenSkill}
        busy={busy}
        errors={errors}
      />
    </div>
  )
}
