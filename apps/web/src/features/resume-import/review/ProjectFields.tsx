/**
 * Description: Review fields for one parsed project.
 * Index:
 *   - ProjectFields: name, role, URL, dates, description
 */
import type { ParsedProject } from '../parsedResume'
import { DateRangeFields } from './DateRangeFields'
import { TextField } from './TextField'

interface ProjectFieldsProps {
  project: ParsedProject
  onChange: (project: ParsedProject) => void
}

/** Edits one project. */
export function ProjectFields({ project, onChange }: ProjectFieldsProps) {
  const set = <Key extends keyof ParsedProject>(key: Key, value: ParsedProject[Key]) => onChange({ ...project, [key]: value })

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Name" required value={project.name} onChange={(value) => set('name', value ?? '')} />
        <TextField label="Role" value={project.role} onChange={(value) => set('role', value)} />
        <TextField label="URL" value={project.url} onChange={(value) => set('url', value)} />
        <DateRangeFields
          startDate={project.start_date}
          endDate={project.end_date}
          onChange={(dates) => onChange({ ...project, ...dates })}
        />
      </div>
      <TextField label="Description" multiline value={project.description} onChange={(value) => set('description', value)} />
    </div>
  )
}
