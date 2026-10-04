/**
 * Description: Review control for parsed skills: draggable, removable chips plus an input to add
 * more. Dropping a dragged chip is handled by the form's DragDropProvider.
 * Index:
 *   - SkillsField: edits the skill list (new skills have no category)
 */
import { useState, type KeyboardEvent } from 'react'
import { Plus, X } from 'lucide-react'
import { SortableItem } from '@/components/dnd/SortableItem'
import { sortableId } from '@/components/dnd/moveItems'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { withDraftKey, type DraftSkill } from './reviewDraft'
import { SKILL_TYPE } from './useReviewDragHandlers'

interface SkillsFieldProps {
  skills: DraftSkill[]
  onChange: (skills: DraftSkill[]) => void
}

/** Shows skills as chips (with their category, if any); Enter or "Add" appends a new one. */
export function SkillsField({ skills, onChange }: SkillsFieldProps) {
  const [newSkillName, setNewSkillName] = useState('')

  function addSkill() {
    const name = newSkillName.trim()
    if (!name) return
    onChange([...skills, withDraftKey({ name, category: null })])
    setNewSkillName('')
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return
    event.preventDefault()
    addSkill()
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-2">
        {skills.length === 0 && <p className="text-sm text-muted-foreground">None found on your resume.</p>}
        {skills.map((skill, index) => (
          <SortableItem
            key={skill.key}
            id={sortableId(SKILL_TYPE, skill.key)}
            index={index}
            type={SKILL_TYPE}
            label={skill.name}
            className="flex h-7 items-center gap-0.5 rounded-full border border-section-skills-accent/30 bg-section-skills pr-1 text-sm"
          >
            {(dragHandle) => (
              <>
                {dragHandle}
                {skill.name}
                {skill.category && <span className="ml-1 text-muted-foreground">· {skill.category}</span>}
                <button
                  type="button"
                  aria-label={`Remove ${skill.name}`}
                  className="ml-1 rounded-full p-0.5 hover:bg-foreground/10"
                  onClick={() => onChange(skills.filter((_, position) => position !== index))}
                >
                  <X className="size-3" />
                </button>
              </>
            )}
          </SortableItem>
        ))}
      </div>
      <div className="flex max-w-sm gap-2">
        <Input
          aria-label="New skill"
          placeholder="Add a skill"
          value={newSkillName}
          onChange={(event) => setNewSkillName(event.target.value)}
          onKeyDown={handleKeyDown}
        />
        <Button type="button" variant="outline" onClick={addSkill}>
          <Plus /> Add
        </Button>
      </div>
    </div>
  )
}
