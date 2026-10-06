/**
 * Description: The skills section of the career library: chips, add, and edit.
 * Index:
 *   - SkillsSection: grouped skills with the skill form
 */
import { useState } from 'react'
import { LibrarySection } from './LibrarySection'
import { SkillFormDialog } from './SkillFormDialog'
import { SkillList } from './SkillList'
import type { CategorizedSkill } from './groupSkillsByCategory'

/** Lists skills and opens the form to add one or edit one. */
export function SkillsSection({ skills }: { skills: CategorizedSkill[] }) {
  const [editing, setEditing] = useState<CategorizedSkill | 'new' | null>(null)

  return (
    <>
      <LibrarySection sectionId="library.skills" tone="skills" title="Skills" count={skills.length} emptyText="No skills yet." addLabel="Add skill" onAdd={() => setEditing('new')}>
        <SkillList skills={skills} onEdit={setEditing} />
      </LibrarySection>
      <SkillFormDialog open={editing !== null} skill={editing === 'new' ? null : editing} onOpenChange={(open) => !open && setEditing(null)} />
    </>
  )
}
