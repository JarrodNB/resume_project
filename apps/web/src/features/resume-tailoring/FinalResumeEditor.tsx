/**
 * Review and edit the finished resume before saving it once. Sections start collapsed.
 * Edits and inclusion choices stay together; excluded summary text survives first save. Unsaved drafts warn before navigation;
 * The full resume appears first; the editing view retains all draft choices.
 * Controls pause during the first save because success switches to the saved editor.
 */
import { useState } from 'react'
import { CircleAlert } from 'lucide-react'
import { CollapseToggle } from '@/components/CollapseToggle'
import { SECTION_TONES } from '@/components/sectionTones'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { cn } from '@/lib/utils'
import { useOpenSection } from '@/components/useOpenSection'
import { Button } from '@/components/ui/button'
import { SummaryInclusionControl } from './SummaryInclusionControl'
import { ResumeEditorActions } from './ResumeEditorActions'
import { ResumeUnsavedChanges } from './ResumeUnsavedChanges'
import { SectionFields } from './SectionFields'
import { ResumePdfPreview } from './ResumePdfPreview'
import { buildResumePdfModel } from './resumePdfModel'
import { SECTION_TITLES } from './sectionOrder'
import type { TailorSection } from './parseTailorTask'
import { contentFromSectionDraft, sectionDraftFromContent, type SectionDraft } from './tailorDraft'

interface FinalResumeEditorProps {
  jobId: string
  sections: TailorSection[]
  includeSummary?: boolean
  warnings: string[]
  pending: boolean
  errors: string[]
  onSave: (sections: { section_type: string; title: string; content: unknown }[], includeSummary?: boolean) => Promise<boolean> | boolean | void
}

/** Lets the user edit the whole draft, then save it once. */
export function FinalResumeEditor({ jobId, sections, includeSummary = true, warnings, pending, errors, onSave }: FinalResumeEditorProps) {
  const [drafts, setDrafts] = useState(() => sections.map((section) => ({
    ...section,
    draft: sectionDraftFromContent(section.sectionType, section.content),
    included: section.sectionType !== 'summary' || includeSummary,
  })))

  const [emptySummaryIncluded, setEmptySummaryIncluded] = useState(includeSummary)
  const [editing, setEditing] = useState(false)
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(null)
  const snapshot = JSON.stringify({ drafts, emptySummaryIncluded })
  const dirty = snapshot !== savedSnapshot
  const selected = drafts.filter((section) => section.included).map((section) => ({
    sectionType: section.sectionType,
    title: section.title || SECTION_TITLES[section.sectionType],
    content: contentFromSectionDraft(section.draft),
  }))

  const summaryIncluded = drafts.find((section) => section.sectionType === 'summary')?.included ?? emptySummaryIncluded

  async function save() {
    if (selected.length === 0 || pending) return
    const retained = drafts.filter((section) => section.included || section.sectionType === 'summary').map((section) => ({
      section_type: section.sectionType,
      title: section.title || SECTION_TITLES[section.sectionType],
      content: contentFromSectionDraft(section.draft),
    }))
    if (await onSave(retained, summaryIncluded)) setSavedSnapshot(snapshot)
  }

  return (
    <div className="resume-editor">
      <ResumeUnsavedChanges dirty={dirty} />
      <ResumeEditorActions reviewFirst pending={pending} dirty={dirty} editing={editing} empty={selected.length === 0} errors={errors} onPreview={() => setEditing(false)} onEdit={() => setEditing(true)} onSave={() => void save()} />
      {warnings.length > 0 && (
        <Alert>
          <CircleAlert aria-hidden />
          <AlertTitle>Draft notes</AlertTitle>
          <AlertDescription>{warnings.map((warning) => <p key={warning}>{warning}</p>)}</AlertDescription>
        </Alert>
      )}
      {editing && <SummaryInclusionControl checked={summaryIncluded} disabled={pending} onChange={(checked) => {
        setEmptySummaryIncluded(checked)
        setDrafts((current) => current.map((section) => section.sectionType === 'summary' ? { ...section, included: checked } : section))
      }} />}
      {editing && <fieldset disabled={pending} className="resume-section-list">
        {drafts.map((section, index) => (
          <FinalSection
            key={section.sectionType}
            sectionId={`resume.${jobId}.${section.sectionType}`}
            title={section.title || SECTION_TITLES[section.sectionType]}
            draft={section.draft}
            included={section.included}
            onToggleIncluded={() => setDrafts((current) => current.map((draft, position) => position === index ? { ...draft, included: !draft.included } : draft))}
            onChange={(next) => setDrafts((current) => current.map((draft, position) => (position === index ? { ...draft, draft: next } : draft)))}
          />
        ))}
      </fieldset>}
      {selected.length === 0 && <p className="text-sm text-muted-foreground">Include at least one section to preview or save your resume.</p>}
      {!editing && selected.length > 0 && (
        <div className="resume-preview-stage">
          <ResumePdfPreview model={buildResumePdfModel(selected)} />
        </div>
      )}
    </div>
  )
}

/** One finished section. The fields unmount while it is collapsed; the draft lives above. */
function FinalSection({
  sectionId,
  title,
  draft,
  onChange,
  included,
  onToggleIncluded,
}: {
  sectionId: string
  title: string
  draft: SectionDraft
  included: boolean
  onToggleIncluded: () => void
  onChange: (next: SectionDraft) => void
}) {
  const { open, toggle, panelId } = useOpenSection(sectionId)
  const tone = SECTION_TONES[draft.kind]

  return (
    <Card className={cn('resume-section gap-0 py-0 shadow-none', tone.card)}>
      <CardHeader className={cn('px-5 py-4', tone.header, included && open && 'border-b')}>
        <div className="flex flex-wrap items-center gap-3">
          {included ? (
            <CollapseToggle className="min-w-0 flex-1 basis-40" open={open} panelId={panelId} onToggle={toggle}>
              <tone.Icon className={cn('size-4 shrink-0', tone.icon)} aria-hidden />
              <h2 className="text-base font-medium">{title}</h2>
            </CollapseToggle>
          ) : <h2 className="flex-1 font-medium">{title}</h2>}
          {draft.kind !== 'summary' && <Button type="button" variant="ghost" aria-label={`${included ? 'Exclude' : 'Include'} ${title}`} onClick={onToggleIncluded}>
            {included ? 'Exclude' : 'Include'}
          </Button>}
        </div>
      </CardHeader>
      {!included && <p className="px-5 pb-4 text-sm text-muted-foreground">Excluded from this resume. Your edits are kept.</p>}
      {included && open && (
        <CardContent id={panelId} className="px-5 py-5">
          <SectionFields draft={draft} onChange={onChange} />
        </CardContent>
      )}
    </Card>
  )
}
