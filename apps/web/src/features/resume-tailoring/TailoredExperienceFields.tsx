/** Edit one employment block without assigning its shared achievements to a title.
 * The same fields serve draft and saved resumes; role identity and evidence IDs survive edits.
 */
import { useId } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { TextField } from '@/features/resume-import/review/TextField'
import { DateRangeFields } from '@/features/resume-import/review/DateRangeFields'
import { HighlightsField } from '@/features/resume-import/review/HighlightsField'
import { PROSE_TEXT, SHORT_TEXT } from '@/lib/textLimits'
import type { TailoredExperience, TailoredRole } from './tailoredExperience'

export function TailoredExperienceFields({ experience, onChange }: { experience: TailoredExperience; onChange: (value: TailoredExperience) => void }) {
  return <div className="grid min-w-0 gap-6">
    <div className="grid gap-4 sm:grid-cols-2">
      <TextField label="Company" required maxLength={SHORT_TEXT} value={experience.company} onChange={(value) => onChange({ ...experience, company: value ?? '' })} />
      <TextField label="Location" maxLength={SHORT_TEXT} value={experience.location} onChange={(value) => onChange({ ...experience, location: value })} />
    </div>
    {experience.roles.map((role, index) => <RoleFields key={role.key} role={role} index={index} onChange={(next) => onChange({ ...experience, roles: experience.roles.map((item) => item.key === role.key ? next : item) })} />)}
    <TextField label="Experience description" multiline maxLength={PROSE_TEXT} value={experience.description} onChange={(value) => onChange({ ...experience, description: value })} />
    <fieldset className="grid min-w-0 gap-2" aria-label="Shared highlights">
      {experience.roles.length > 1 && <legend className="mb-2 text-sm font-medium">Shared across these roles</legend>}
      <HighlightsField experienceKey={experience.key} highlights={experience.highlights} onChange={(highlights) => onChange({ ...experience, highlights: highlights.map((highlight) => ({ ...highlight, sourceIds: 'sourceIds' in highlight && Array.isArray(highlight.sourceIds) ? highlight.sourceIds : [] })) })} />
    </fieldset>
  </div>
}

function RoleFields({ role, index, onChange }: { role: TailoredRole; index: number; onChange: (value: TailoredRole) => void }) {
  const currentId = useId()
  return <fieldset aria-label={`Role ${index + 1}`} className="grid min-w-0 gap-4">
    <div className="grid gap-4 sm:grid-cols-2">
      <TextField label="Title" required maxLength={SHORT_TEXT} value={role.title} onChange={(title) => onChange({ ...role, title: title ?? '' })} />
      <DateRangeFields startDate={role.start_date} endDate={role.end_date} endDisabled={role.is_current} onChange={(dates) => onChange({ ...role, ...dates })} />
    </div>
    <div className="flex items-center gap-2">
      <Checkbox id={currentId} checked={role.is_current} onCheckedChange={(checked) => onChange({ ...role, is_current: checked === true, end_date: null })} />
      <Label htmlFor={currentId}>I currently work here</Label>
    </div>
    <TextField label="Role description" multiline maxLength={PROSE_TEXT} value={role.description} onChange={(description) => onChange({ ...role, description })} />
    <HighlightsField experienceKey={role.key} label="Role highlights" highlights={role.highlights} onChange={(highlights) => onChange({ ...role, highlights: highlights.map((highlight) => ({ ...highlight, sourceIds: 'sourceIds' in highlight && Array.isArray(highlight.sourceIds) ? highlight.sourceIds : [] })) })} />
  </fieldset>
}
