/**
 * Description: Skills grouped by category, shown as chips with a drag handle and a delete button.
 * Chips can be dragged to a new place within their category; the page's DragDropProvider saves it.
 * Index:
 *   - SkillList: renders each category with its skills; deleting asks for confirmation
 */
import { useState } from 'react'
import { X } from 'lucide-react'
import { SortableItem } from '@/components/dnd/SortableItem'
import { sortableId } from '@/components/dnd/moveItems'
import { DeleteEntryDialog } from './DeleteEntryDialog'
import { groupSkillsByCategory, type CategorizedSkill } from './groupSkillsByCategory'
import { useLibraryEntryActions } from './useLibraryEntryActions'
import { skillDragType } from './useLibraryDragHandlers'

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
            {categorySkills.map((skill, index) => (
              <SortableItem
                key={skill.id}
                id={sortableId('skill', skill.id)}
                index={index}
                type={skillDragType(category)}
                group={category}
                label={skill.name}
                className="flex h-7 items-center gap-0.5 rounded-full border border-section-skills-accent/30 bg-section-skills pr-1 text-sm"
              >
                {(dragHandle) => (
                  <>
                    {dragHandle}
                    {skill.name}
                    <button
                      type="button"
                      className="ml-1 rounded-full p-0.5 hover:bg-foreground/10"
                      aria-label={`Delete ${skill.name}`}
                      onClick={() => confirmDelete(skill)}
                    >
                      <X className="size-3" />
                    </button>
                  </>
                )}
              </SortableItem>
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
