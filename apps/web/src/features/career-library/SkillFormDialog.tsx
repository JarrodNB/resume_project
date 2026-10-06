/**
 * Description: Dialog that adds a skill or edits its name and category.
 * Index:
 *   - SkillFormDialog: opens the form for a skill, or a blank one when skill is null
 */
import { useState } from 'react'
import { CREATE_SKILL_MUTATION, UPDATE_SKILL_MUTATION } from './careerLibrarySaveMutations'
import { EntryFormDialog } from './EntryFormDialog'
import { blankToNull } from './libraryFormValues'
import { LibraryField } from './LibraryField'
import type { CategorizedSkill } from './groupSkillsByCategory'
import { useSaveLibraryRecord } from './useSaveLibraryRecord'

interface SkillFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  skill: CategorizedSkill | null
}

/** Shows the skill form while `open` is true. */
export function SkillFormDialog({ open, onOpenChange, skill }: SkillFormDialogProps) {
  if (!open) return null
  return <SkillForm key={skill?.id ?? 'new'} skill={skill} onClose={() => onOpenChange(false)} />
}

/** The skill fields and the save action. */
function SkillForm({ skill, onClose }: { skill: CategorizedSkill | null; onClose: () => void }) {
  const { save, busy, errors } = useSaveLibraryRecord()
  const [name, setName] = useState(skill?.name ?? '')
  const [category, setCategory] = useState(skill?.category ?? '')

  /** Creates or updates the skill. An empty category clears it. */
  async function submit() {
    const saved = await save(skill ? UPDATE_SKILL_MUTATION : CREATE_SKILL_MUTATION, {
      ...(skill ? { id: skill.id } : {}),
      attributes: { name: name.trim(), category: blankToNull(category) },
    })
    if (saved) onClose()
  }

  return (
    <EntryFormDialog
      open
      onOpenChange={(next) => !next && onClose()}
      title={skill ? 'Edit skill' : 'Add skill'}
      description="The name has to be unique in your library. Category is optional."
      onSubmit={submit}
      busy={busy}
      errors={errors}
    >
      <LibraryField label="Name" required value={name} onChange={setName} />
      <LibraryField label="Category" value={category} onChange={setCategory} />
    </EntryFormDialog>
  )
}
