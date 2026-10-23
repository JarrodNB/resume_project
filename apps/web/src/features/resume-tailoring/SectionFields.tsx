/**
 * Description: The editable fields for one tailored section, reusing the resume-import review
 * fields. Experience highlights and skills can be dragged.
 * Index:
 *   - SectionFields: edits a SectionDraft and reports the new draft
 */
import { DragDropProvider } from '@dnd-kit/react'
import type { Dispatch, SetStateAction } from 'react'
import { CertificationFields } from '@/features/resume-import/review/CertificationFields'
import { ContactFields } from '@/features/resume-import/review/ContactFields'
import { EducationFields } from '@/features/resume-import/review/EducationFields'
import { TailoredExperienceFields } from './TailoredExperienceFields'
import type { TailoredExperience } from './tailoredExperience'
import { ProjectFields } from '@/features/resume-import/review/ProjectFields'
import { SkillsField } from '@/features/resume-import/review/SkillsField'
import { TextField } from '@/features/resume-import/review/TextField'
import { PROSE_TEXT } from '@/lib/textLimits'
import type { ReviewDraft } from '@/features/resume-import/review/reviewDraft'
import { useReviewDragHandlers } from '@/features/resume-import/review/useReviewDragHandlers'
import type { SectionDraft } from './tailorDraft'

interface SectionFieldsProps {
  draft: SectionDraft
  onChange: (draft: SectionDraft) => void
}

/** Edits one section. Drag-and-drop is on only for highlights and skills. */
export function SectionFields({ draft, onChange }: SectionFieldsProps) {
  if (draft.kind === 'experience' || draft.kind === 'skills') {
    return <DraggableSection draft={draft} onChange={onChange} />
  }
  return <PlainSection draft={draft} onChange={onChange} />
}

/** Contact, summary, projects, and education: no dragging. */
function PlainSection({ draft, onChange }: SectionFieldsProps) {
  if (draft.kind === 'contact') {
    return <ContactFields contact={draft.contact} onChange={(contact) => onChange({ kind: 'contact', contact })} />
  }
  if (draft.kind === 'summary') {
    return <TextField label="Summary" multiline maxLength={PROSE_TEXT} value={draft.text} onChange={(text) => onChange({ kind: 'summary', text })} />
  }
  if (draft.kind === 'projects') {
    return (
      <div className="grid gap-6">
        {draft.items.map((project) => (
          <ProjectFields
            key={project.key}
            project={project}
            onChange={(next) => onChange({ kind: 'projects', items: replace(draft.items, project.key, { ...next, key: project.key }) })}
          />
        ))}
      </div>
    )
  }
  if (draft.kind === 'certifications') {
    return (
      <div className="grid gap-6">
        {draft.items.map((certification) => (
          <CertificationFields
            key={certification.key}
            certification={certification}
            onChange={(next) => onChange({ kind: 'certifications', items: replace(draft.items, certification.key, { ...next, key: certification.key }) })}
          />
        ))}
      </div>
    )
  }
  if (draft.kind === 'education') {
    return (
      <div className="grid gap-6">
        {draft.items.map((education) => (
          <EducationFields
            key={education.key}
            education={education}
            onChange={(next) => onChange({ kind: 'education', items: replace(draft.items, education.key, { ...next, key: education.key }) })}
          />
        ))}
      </div>
    )
  }
  return null
}

/** Experience and skills, with the same drag handlers as resume review. */
function DraggableSection({ draft, onChange }: SectionFieldsProps) {
  const reviewDraft = reviewDraftFrom(draft)
  const setReviewDraft: Dispatch<SetStateAction<ReviewDraft>> = (next) => {
    const resolved = typeof next === 'function' ? next(reviewDraft) : next
    onChange(draftFromReview(draft, resolved))
  }
  const dragHandlers = useReviewDragHandlers(reviewDraft, setReviewDraft)

  return (
    <DragDropProvider {...dragHandlers}>
      {draft.kind === 'experience' ? (
        <div className="grid gap-6">
          {draft.items.map((experience) => (
            <TailoredExperienceFields
              key={experience.key}
              experience={experience}
              onChange={(next) => onChange({ kind: 'experience', items: replace(draft.items, experience.key, next) })}
            />
          ))}
        </div>
      ) : (
        draft.kind === 'skills' && <SkillsField skills={draft.items} onChange={(items) => onChange({ kind: 'skills', items })} />
      )}
    </DragDropProvider>
  )
}

/** A stand-in review draft so the shared drag handlers can run. */
function reviewDraftFrom(draft: SectionDraft): ReviewDraft {
  return {
    contact: { full_name: null, email: null, phone: null, location: null, links: [] },
    summary: null,
    experiences: draft.kind === 'experience' ? draft.items.map((item) => ({ ...item, shared_highlights: item.highlights })) : [],
    projects: [],
    educations: [],
    certifications: [],
    skills: draft.kind === 'skills' ? draft.items : [],
    parsing_warnings: [],
  }
}

/** Copies the dragged list back onto the section draft. */
function draftFromReview(draft: SectionDraft, review: ReviewDraft): SectionDraft {
  if (draft.kind === 'experience') return { kind: draft.kind, items: review.experiences.map(({ shared_highlights, ...entry }) => ({ ...entry, highlights: shared_highlights }) as TailoredExperience) }
  if (draft.kind === 'skills') return { kind: draft.kind, items: review.skills }
  return { kind: 'summary', text: '' }
}

/** Replaces the entry with `key`. */
function replace<Item extends { key: string }>(items: Item[], key: string, next: Item): Item[] {
  return items.map((item) => (item.key === key ? next : item))
}
