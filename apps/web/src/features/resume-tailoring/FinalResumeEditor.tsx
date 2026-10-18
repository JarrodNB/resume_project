/**
 * Review and edit the finished resume before saving it once. Sections start collapsed.
 * Their edits and inclusion choices stay together here so hiding a section never loses work.
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
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ResumeEditorActions } from './ResumeEditorActions'
import { SectionFields } from './SectionFields'
import { ResumePdfPreview } from './ResumePdfPreview'
import { buildResumePdfModel } from './resumePdfModel'
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
  const [drafts, setDrafts] = useState(() => sections.map((section) => ({
    ...section,
    draft: sectionDraftFromContent(section.sectionType, section.content),
    included: true,
  })))

  const [previewOpen, setPreviewOpen] = useState(false)
  const selected = drafts.filter((section) => section.included).map((section) => ({
    sectionType: section.sectionType,
    title: section.title || SECTION_TITLES[section.sectionType],
    content: contentFromSectionDraft(section.draft),
  }))

  function save() {
    if (selected.length === 0 || pending) return
    onSave(selected.map(({ sectionType, ...section }) => ({ ...section, section_type: sectionType })))
  }

  return (
    <div className="grid gap-4">
      <ResumeEditorActions pending={pending} disabled={selected.length === 0} errors={errors} onPreview={() => setPreviewOpen(true)} onSave={save} />
      {warnings.length > 0 && (
        <Alert>
          <CircleAlert aria-hidden />
          <AlertTitle>Draft notes</AlertTitle>
          <AlertDescription>{warnings.map((warning) => <p key={warning}>{warning}</p>)}</AlertDescription>
        </Alert>
      )}
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
      {selected.length === 0 && <p className="text-sm text-muted-foreground">Include at least one section to preview or save your resume.</p>}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="flex h-[min(68rem,calc(100svh-2rem))] w-[54rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden sm:max-w-[54rem]">
          <DialogHeader className="w-full pr-8">
            <DialogTitle>Preview</DialogTitle>
            <DialogDescription>The current draft, as it will export.</DialogDescription>
          </DialogHeader>
          {previewOpen && <ResumePdfPreview model={buildResumePdfModel(selected)} />}
        </DialogContent>
      </Dialog>
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
    <Card className={cn('pt-0', tone.card)}>
      <CardHeader className={cn('py-3', tone.header, included && open && 'border-b')}>
        <div className="flex flex-wrap items-center gap-3">
          {included ? (
            <CollapseToggle className="min-w-0 flex-1 basis-40" open={open} panelId={panelId} onToggle={toggle}>
              <tone.Icon className={cn('size-4 shrink-0', tone.icon)} aria-hidden />
              <h2 className="text-lg font-semibold">{title}</h2>
            </CollapseToggle>
          ) : <h2 className="flex-1 font-medium">{title}</h2>}
          <Button type="button" variant="outline" aria-label={`${included ? 'Exclude' : 'Include'} ${title}`} onClick={onToggleIncluded}>
            {included ? 'Exclude' : 'Include'}
          </Button>
        </div>
      </CardHeader>
      {!included && <p className="px-4 text-sm text-muted-foreground">Excluded from this resume. Your edits are kept.</p>}
      {included && open && (
        <CardContent id={panelId}>
          <SectionFields draft={draft} onChange={onChange} />
        </CardContent>
      )}
    </Card>
  )
}
