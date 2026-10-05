/**
 * Description: Every finished section, editable, with Save. This is the last step before the
 * resume is stored. Each section starts collapsed; its draft stays in the parent.
 * Index:
 *   - FinalResumeEditor: the stack of sections and the save button
 *   - FinalSection: one collapsible section of the draft
 */
import { useState } from 'react'
import { CollapseToggle } from '@/components/CollapseToggle'
import { ErrorAlert } from '@/components/ErrorAlert'
import { useOpenSection } from '@/components/useOpenSection'
import { Button } from '@/components/ui/button'
import { SectionFields } from './SectionFields'
import { SECTION_TITLES } from './sectionOrder'
import type { TailorSection } from './parseTailorTask'
import { contentFromSectionDraft, sectionDraftFromContent, type SectionDraft } from './tailorDraft'

interface FinalResumeEditorProps {
  jobId: string
  sections: TailorSection[]
  warnings: string[]
  pending: boolean
  errors: string[]
  onSave: (sections: { section_type: string; title: string; content: unknown }[]) => void
}

/** Lets the user edit the whole draft, then save it once. */
export function FinalResumeEditor({ jobId, sections, warnings, pending, errors, onSave }: FinalResumeEditorProps) {
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
        <FinalSection
          key={section.sectionType}
          sectionId={`resume.${jobId}.${section.sectionType}`}
          title={section.title || SECTION_TITLES[section.sectionType]}
          draft={drafts[index]}
          onChange={(next) => setDrafts(drafts.map((draft, position) => (position === index ? next : draft)))}
        />
      ))}
      <ErrorAlert messages={errors} title="Couldn't save this resume" />
      <Button type="button" disabled={pending} onClick={save}>
        Save resume
      </Button>
    </div>
  )
}

/** One finished section. The fields unmount while it is collapsed; the draft lives above. */
function FinalSection({
  sectionId,
  title,
  draft,
  onChange,
}: {
  sectionId: string
  title: string
  draft: SectionDraft
  onChange: (next: SectionDraft) => void
}) {
  const { open, toggle, panelId } = useOpenSection(sectionId)

  return (
    <section className="grid gap-3 rounded-lg border p-4">
      <CollapseToggle open={open} panelId={panelId} onToggle={toggle}>
        <h2 className="font-medium">{title}</h2>
      </CollapseToggle>
      {open && (
        <div id={panelId}>
          <SectionFields draft={draft} onChange={onChange} />
        </div>
      )}
    </section>
  )
}
