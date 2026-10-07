/**
 * Description: Review fields for one parsed education entry.
 * Index:
 *   - EducationFields: institution, degree, field of study, dates, description
 */
import { PROSE_TEXT, SHORT_TEXT } from '@/lib/textLimits'
import type { ParsedEducation } from '../parsedResume'
import { DateRangeFields } from './DateRangeFields'
import { TextField } from './TextField'

interface EducationFieldsProps {
  education: ParsedEducation
  onChange: (education: ParsedEducation) => void
}

/** Edits one education entry. */
export function EducationFields({ education, onChange }: EducationFieldsProps) {
  const set = <Key extends keyof ParsedEducation>(key: Key, value: ParsedEducation[Key]) =>
    onChange({ ...education, [key]: value })

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Institution"
          required
          maxLength={SHORT_TEXT}
          value={education.institution}
          onChange={(value) => set('institution', value ?? '')}
        />
        <TextField label="Degree" maxLength={SHORT_TEXT} value={education.degree} onChange={(value) => set('degree', value)} />
        <TextField
          label="Field of study"
          maxLength={SHORT_TEXT}
          value={education.field_of_study}
          onChange={(value) => set('field_of_study', value)}
        />
        <DateRangeFields
          startDate={education.start_date}
          endDate={education.end_date}
          onChange={(dates) => onChange({ ...education, ...dates })}
        />
      </div>
      <TextField label="Description" multiline maxLength={PROSE_TEXT} value={education.description} onChange={(value) => set('description', value)} />
    </div>
  )
}
