/**
 * Description: Every finished section, editable, with Save. This is the last step before the
 * resume is stored.
 * Index:
 *   - FinalResumeEditor: the stack of sections and the save button
 */
import { useState } from 'react'
import { ErrorAlert } from '@/components/ErrorAlert'
import { Button } from '@/components/ui/button'
import { SectionFields } from './SectionFields'
import { SECTION_TITLES } from './sectionOrder'
import type { TailorSection } from './parseTailorTask'
import { contentFromSectionDraft, sectionDraftFromContent, type SectionDraft } from './tailorDraft'

interface FinalResumeEditorProps {
  sections: TailorSection[]
  warnings: string[]
  pending: boolean
  errors: string[]
  onSave: (sections: { section_type: string; title: string; content: unknown }[]) => void
}

/** Lets the user edit the whole draft, then save it once. */
export function FinalResumeEditor({ sections, warnings, pending, errors, onSave }: FinalResumeEditorProps) {
  const [drafts, setDrafts] = useState<SectionDraft[]>(() => sections.map((section) => sectionDraftFromContent(section.sectionType, section.content)))

  function save() {
    onSave(
      sections.map((section, index) => ({
        section_type: section.sectionType,
        title: section.title || SECTION_TITLES[section.sectionType],
        content: contentFromSectionDraft(drafts[index]),
      })),
    )
  }

  return (
    <div className="grid gap-4">
      {warnings.map((warning) => (
        <p key={warning} className="text-sm text-muted-foreground">
          {warning}
        </p>
      ))}
      {sections.map((section, index) => (
        <section key={section.sectionType} className="grid gap-3 rounded-lg border p-4">
          <h2 className="font-medium">{section.title || SECTION_TITLES[section.sectionType]}</h2>
          <SectionFields draft={drafts[index]} onChange={(next) => setDrafts(drafts.map((draft, position) => (position === index ? next : draft)))} />
        </section>
      ))}
      <ErrorAlert messages={errors} title="Couldn't save this resume" />
      <Button type="button" disabled={pending} onClick={save}>
        Save resume
      </Button>
    </div>
  )
}
