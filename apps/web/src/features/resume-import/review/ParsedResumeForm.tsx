/**
 * Description: Editable review of a parsed resume. The user fixes anything the parser got wrong,
 * then imports the edited version into their career library.
 * Index:
 *   - ParsedResumeForm: form holding the draft ParsedResume; calls `onImport` with the edits
 */
import { useState, type FormEvent } from 'react'
import { ErrorAlert } from '@/components/ErrorAlert'
import { Button } from '@/components/ui/button'
import { emptyEducation, emptyExperience, emptyProject, type ParsedResume } from '../parsedResume'
import { ContactFields } from './ContactFields'
import { EditableList } from './EditableList'
import { EducationFields } from './EducationFields'
import { ExperienceFields } from './ExperienceFields'
import { ParsingWarnings } from './ParsingWarnings'
import { ProjectFields } from './ProjectFields'
import { ReviewSection } from './ReviewSection'
import { SkillsField } from './SkillsField'
import { TextField } from './TextField'

interface ParsedResumeFormProps {
  parsedResume: ParsedResume
  onImport: (parsedResume: ParsedResume) => void
  importing: boolean
  errors: string[]
}

/** Renders every section of the parse as editable fields, with the parser's warnings on top. */
export function ParsedResumeForm({ parsedResume, onImport, importing, errors }: ParsedResumeFormProps) {
  const [draft, setDraft] = useState(parsedResume)
  const set = <Key extends keyof ParsedResume>(key: Key, value: ParsedResume[Key]) =>
    setDraft((current) => ({ ...current, [key]: value }))

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    onImport(draft)
  }

  return (
    <form className="grid gap-6" onSubmit={handleSubmit}>
      <ParsingWarnings warnings={draft.parsing_warnings} />
      <ReviewSection title="Contact">
        <ContactFields contact={draft.contact} onChange={(contact) => set('contact', contact)} />
      </ReviewSection>
      <ReviewSection title="Summary">
        <TextField label="Summary" multiline value={draft.summary} onChange={(summary) => set('summary', summary)} />
      </ReviewSection>
      <ReviewSection title="Experience" description="Highlights are copied word for word from your resume.">
        <EditableList
          items={draft.experiences}
          onChange={(experiences) => set('experiences', experiences)}
          createItem={emptyExperience}
          itemName="experience"
          describeItem={(experience) => [experience.title, experience.company].filter(Boolean).join(' at ')}
          renderItem={(experience, onChange) => <ExperienceFields experience={experience} onChange={onChange} />}
        />
      </ReviewSection>
      <ReviewSection title="Projects">
        <EditableList
          items={draft.projects}
          onChange={(projects) => set('projects', projects)}
          createItem={emptyProject}
          itemName="project"
          describeItem={(project) => project.name}
          renderItem={(project, onChange) => <ProjectFields project={project} onChange={onChange} />}
        />
      </ReviewSection>
      <ReviewSection title="Education">
        <EditableList
          items={draft.educations}
          onChange={(educations) => set('educations', educations)}
          createItem={emptyEducation}
          itemName="education"
          describeItem={(education) => education.institution}
          renderItem={(education, onChange) => <EducationFields education={education} onChange={onChange} />}
        />
      </ReviewSection>
      <ReviewSection title="Skills">
        <SkillsField skills={draft.skills} onChange={(skills) => set('skills', skills)} />
      </ReviewSection>
      <div className="sticky bottom-0 -mx-1 grid gap-3 border-t bg-background/95 px-1 py-4 backdrop-blur">
        <ErrorAlert messages={errors} title="Import failed" />
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">Importing adds these to your career library.</p>
          <Button type="submit" size="lg" disabled={importing}>
            {importing ? 'Importing…' : 'Save to career library'}
          </Button>
        </div>
      </div>
    </form>
  )
}
