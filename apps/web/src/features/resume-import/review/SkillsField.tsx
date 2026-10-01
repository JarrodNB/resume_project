/**
 * Description: Review control for parsed skills: removable chips plus an input to add more.
 * Index:
 *   - SkillsField: edits the skill list (new skills have no category)
 */
import { useState, type KeyboardEvent } from 'react'
import { Plus, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { ParsedSkill } from '../parsedResume'

interface SkillsFieldProps {
  skills: ParsedSkill[]
  onChange: (skills: ParsedSkill[]) => void
}

/** Shows skills as chips (with their category, if any); Enter or "Add" appends a new one. */
export function SkillsField({ skills, onChange }: SkillsFieldProps) {
  const [newSkillName, setNewSkillName] = useState('')

  function addSkill() {
    const name = newSkillName.trim()
    if (!name) return
    onChange([...skills, { name, category: null }])
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
          <Badge key={`${skill.name}-${index}`} variant="secondary" className="h-7 gap-1.5 pr-1 text-sm">
            {skill.name}
            {skill.category && <span className="text-muted-foreground">· {skill.category}</span>}
            <button
              type="button"
              aria-label={`Remove ${skill.name}`}
              className="rounded-full p-0.5 hover:bg-foreground/10"
              onClick={() => onChange(skills.filter((_, position) => position !== index))}
            >
              <X className="size-3" />
            </button>
          </Badge>
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
