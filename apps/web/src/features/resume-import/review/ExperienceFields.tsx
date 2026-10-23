/** Review an employer block with its ordered roles and shared highlights.
 * Each list names its scope, so editing and removing a bullet cannot change its ownership.
 */
import { useId } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { DateRangeFields } from './DateRangeFields'
import { HighlightsField } from './HighlightsField'
import type { DraftExperience, DraftExperienceRole } from './reviewDraft'
import { PROSE_TEXT, SHORT_TEXT } from '@/lib/textLimits'
import { emptyExperienceRole } from '../parsedResume'
import { withDraftKey } from './reviewDraft'
import { Button } from '@/components/ui/button'
import { TextField } from './TextField'

interface ExperienceFieldsProps {
  experience: DraftExperience
  onChange: (experience: DraftExperience) => void
}

/** Edits an employer block without combining it with other blocks for the same company. */
export function ExperienceFields({ experience, onChange }: ExperienceFieldsProps) {
  const set = <Key extends keyof DraftExperience>(key: Key, value: DraftExperience[Key]) =>
    onChange({ ...experience, [key]: value })
  return (
    <div className="grid min-w-0 gap-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Company" required maxLength={SHORT_TEXT} value={experience.company} onChange={(value) => set('company', value ?? '')} />
        <TextField label="Location" maxLength={SHORT_TEXT} value={experience.location} onChange={(value) => set('location', value)} />
      </div>
      <TextField label="Company description" multiline maxLength={PROSE_TEXT} value={experience.description} onChange={(value) => set('description', value)} />
      {experience.roles.map((role, index) => (
        <fieldset key={role.key} className="grid min-w-0 gap-4 border-t pt-4">
          <legend className="px-1 text-sm font-medium">{role.title || 'New role'}</legend>
          <RoleFields role={role} onChange={(updated) => set('roles', experience.roles.map((item) => item.key === role.key ? updated : item))} />
          <Button type="button" variant="ghost" className="justify-self-start" disabled={experience.roles.length === 1 || role.highlights.length > 0}
            aria-describedby={role.highlights.length > 0 && experience.roles.length > 1 ? `role-removal-${role.key}` : undefined}
            aria-label={`Remove role ${index + 1}`} onClick={() => set('roles', experience.roles.filter((item) => item.key !== role.key))}>
            Remove role
          </Button>
          {role.highlights.length > 0 && experience.roles.length > 1 && (
            <p id={`role-removal-${role.key}`} className="text-sm text-muted-foreground">Move or remove this role’s highlights before removing the role.</p>
          )}
        </fieldset>
      ))}
      <Button type="button" variant="outline" className="justify-self-start" disabled={experience.roles.length >= 20}
        onClick={() => set('roles', [...experience.roles, withDraftKey({ ...emptyExperienceRole(), highlights: [] })])}>Add role</Button>
      <div className="grid gap-2 border-t pt-4">
        <p className="text-sm text-muted-foreground">Shared highlights belong to this company block across its roles.</p>
        <HighlightsField experienceKey={experience.key} label="Shared highlights" highlights={experience.shared_highlights} onChange={(highlights) => set('shared_highlights', highlights)} />
      </div>
    </div>
  )
}

/** Edits one role and only the highlights explicitly assigned to it. */
function RoleFields({ role, onChange }: { role: DraftExperienceRole; onChange: (role: DraftExperienceRole) => void }) {
  const currentRoleId = useId()
  const set = <Key extends keyof DraftExperienceRole>(key: Key, value: DraftExperienceRole[Key]) => onChange({ ...role, [key]: value })
  return (
    <div className="grid gap-4">
      <TextField label="Title" required maxLength={SHORT_TEXT} value={role.title} onChange={(value) => set('title', value ?? '')} />
      <DateRangeFields startDate={role.start_date} endDate={role.end_date} endDisabled={role.is_current} onChange={(dates) => onChange({ ...role, ...dates })} />
      <div className="flex items-center gap-2">
        <Checkbox id={currentRoleId} checked={role.is_current} onCheckedChange={(checked) => onChange({ ...role, is_current: checked === true, end_date: null })} />
        <Label htmlFor={currentRoleId}>I currently work in this role</Label>
      </div>
      <TextField label="Role description" multiline maxLength={PROSE_TEXT} value={role.description} onChange={(value) => set('description', value)} />
      <HighlightsField experienceKey={role.key} highlights={role.highlights} onChange={(highlights) => set('highlights', highlights)} />
    </div>
  )
}
