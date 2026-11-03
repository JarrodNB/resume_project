/**
 * Description: Skills grouped by category, shown as chips with a drag handle, edit, and delete.
 * Chips can be dragged to a new place within their category; the page's DragDropProvider saves it.
 * Index:
 *   - SkillList: renders each category with its skills; deleting asks for confirmation
 */
import { useState } from 'react'
import { Pencil, X } from 'lucide-react'
import { SortableItem } from '@/components/dnd/SortableItem'
import { sortableId } from '@/components/dnd/moveItems'
import { DeleteEntryDialog } from './DeleteEntryDialog'
import { groupSkillsByCategory, type CategorizedSkill } from './groupSkillsByCategory'
import { useLibraryEntryActions } from './useLibraryEntryActions'
import { skillDragType } from './useLibraryDragHandlers'

/** Renders each category heading with its skills as chips. */
export function SkillList({ skills, onEdit }: { skills: CategorizedSkill[]; onEdit: (skill: CategorizedSkill) => void }) {
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
    <div className="library-skills">
      {groupSkillsByCategory(skills).map(([category, categorySkills]) => (
        <div key={category} className="library-skill-group">
          <h3>{category}</h3>
          <div className="flex flex-wrap gap-1.5">
            {categorySkills.map((skill, index) => (
              <SortableItem
                key={skill.id}
                id={sortableId('skill', skill.id)}
                index={index}
                type={skillDragType(category)}
                group={category}
                label={skill.name}
                className="library-skill"
              >
                {(dragHandle) => (
                  <>
                    {dragHandle}
                    {skill.name}
                    <button
                      type="button"
                      className="ml-1 rounded-full p-0.5 hover:bg-foreground/10"
                      aria-label={`Edit ${skill.name}`}
                      onClick={() => onEdit(skill)}
                    >
                      <Pencil className="size-3" />
                    </button>
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
