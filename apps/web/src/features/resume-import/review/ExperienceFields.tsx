/**
 * Description: Review fields for one parsed experience (role).
 * Index:
 *   - ExperienceFields: title, company, location, dates, current-role flag, description, highlights
 *     (draggable, also into other roles)
 */
import { useId } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { DateRangeFields } from './DateRangeFields'
import { HighlightsField } from './HighlightsField'
import type { DraftExperience } from './reviewDraft'
import { PROSE_TEXT, SHORT_TEXT } from '@/lib/textLimits'
import { TextField } from './TextField'

interface ExperienceFieldsProps {
  experience: DraftExperience
  onChange: (experience: DraftExperience) => void
}

/** Edits one experience. Marking it current clears the end date. */
export function ExperienceFields({ experience, onChange }: ExperienceFieldsProps) {
  const currentRoleId = useId()
  const set = <Key extends keyof DraftExperience>(key: Key, value: DraftExperience[Key]) =>
    onChange({ ...experience, [key]: value })

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Title" required maxLength={SHORT_TEXT} value={experience.title} onChange={(value) => set('title', value ?? '')} />
        <TextField label="Company" required maxLength={SHORT_TEXT} value={experience.company} onChange={(value) => set('company', value ?? '')} />
        <TextField label="Location" maxLength={SHORT_TEXT} value={experience.location} onChange={(value) => set('location', value)} />
        <DateRangeFields
          startDate={experience.start_date}
          endDate={experience.end_date}
          endDisabled={experience.is_current}
          onChange={(dates) => onChange({ ...experience, ...dates })}
        />
      </div>
      <div className="flex items-center gap-2">
        <Checkbox
          id={currentRoleId}
          checked={experience.is_current}
          onCheckedChange={(checked) => onChange({ ...experience, is_current: checked === true, end_date: null })}
        />
        <Label htmlFor={currentRoleId}>I currently work here</Label>
      </div>
      <TextField label="Description" multiline maxLength={PROSE_TEXT} value={experience.description} onChange={(value) => set('description', value)} />
      <HighlightsField
        experienceKey={experience.key}
        highlights={experience.highlights}
        onChange={(highlights) => set('highlights', highlights)}
      />
    </div>
  )
}
