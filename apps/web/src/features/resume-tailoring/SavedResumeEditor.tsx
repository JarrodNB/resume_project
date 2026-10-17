/**
 * Edits saved sections and tracks whether feedback still describes the draft.
 * Preview draws the current draft; only an explicit save writes it.
 */
import { useMemo, useState } from 'react'
import { ErrorAlert } from '@/components/ErrorAlert'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { SectionFields } from './SectionFields'
import { ResumePdfPreview } from './ResumePdfPreview'
import { buildResumePdfModel } from './resumePdfModel'
import { asSectionType, SECTION_TITLES } from './sectionOrder'
import { contentFromSectionDraft, sectionDraftFromContent, type SectionDraft } from './tailorDraft'
import { useUpdateResume } from './useUpdateResume'
import { AtsReport } from './AtsReport'
import { useAtsReport } from './useAtsReport'
import { useResumePdfExport } from './useResumePdfExport'

interface SavedResumeSection {
  id: string
  sectionType: string
  title: string
  position: number
  content: unknown
}

/** Edits one saved resume. Preview shows the current draft at actual size. */
export function SavedResumeEditor({ resumeId, sections }: { resumeId: string; sections: SavedResumeSection[] }) {
  const editable = useMemo(() => editableSections(sections), [sections])
  const [drafts, setDrafts] = useState<SectionDraft[]>(() => editable.map((section) => sectionDraftFromContent(section.sectionType, section.content)))
  const [savedDrafts, setSavedDrafts] = useState(() => JSON.stringify(drafts))
  const [refreshingReport, setRefreshingReport] = useState(false)
  const dirty = JSON.stringify(drafts) !== savedDrafts
  const ats = useAtsReport(resumeId)
  const pdfExport = useResumePdfExport(resumeId, ats.receive)
  const [previewOpen, setPreviewOpen] = useState(false)
  const { saveSections, errors, pending } = useUpdateResume(resumeId)
  const model = buildResumePdfModel(
    editable.map((section, index) => ({
      sectionType: section.sectionType,
      title: section.title,
      content: contentFromSectionDraft(drafts[index] ?? sectionDraftFromContent(section.sectionType, section.content)),
    })),
  )

  async function save() {
    const submittedDrafts = JSON.stringify(drafts)
    if (await saveSections(editable.map((section, index) => ({ id: section.id, content: contentFromSectionDraft(drafts[index]) })))) {
      setSavedDrafts(submittedDrafts)
      setRefreshingReport(true)
      await ats.refresh()
      setRefreshingReport(false)
    }
  }

  return (
    <div className="grid gap-4">
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => setPreviewOpen(true)}>
          Preview
        </Button>
        <Button type="button" disabled={dirty || pending || refreshingReport || pdfExport.pending} onClick={() => { if (!dirty && !pending && !refreshingReport) void pdfExport.exportPdf(model, ats.report) }}>
          {pdfExport.pending ? 'Exporting PDF…' : 'Export PDF'}
        </Button>
      </div>
      {(dirty || pending || refreshingReport) && <p>Save resume before exporting. Wait for saving to finish.</p>}
      {pdfExport.status && <p role="status">{pdfExport.status}</p>}
      <ErrorAlert messages={pdfExport.errors} title="PDF export or check needs attention" />
      {editable.map((section, index) => (
        <section key={section.id} className="grid gap-3 rounded-lg border p-4">
          <h2 className="font-medium">{section.title}</h2>
          <SectionFields
            draft={drafts[index]}
            onChange={(next) => setDrafts(drafts.map((draft, position) => (position === index ? next : draft)))}
          />
        </section>
      ))}
      <ErrorAlert messages={errors} title="Couldn't save this resume" />
      <Button type="button" disabled={pending} onClick={save}>
        Save resume
      </Button>
      <AtsReport resumeId={resumeId} dirty={dirty || refreshingReport} report={ats.report} pending={ats.pending || pending} errors={ats.errors} onRerun={() => { if (!dirty && !pending && !refreshingReport) void ats.rerun() }} />
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="flex h-[min(68rem,calc(100svh-2rem))] w-[54rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden sm:max-w-[54rem]">
          <DialogHeader className="w-full pr-8">
            <DialogTitle>Preview</DialogTitle>
            <DialogDescription>The current draft, as it will export.</DialogDescription>
          </DialogHeader>
          {previewOpen && <ResumePdfPreview model={model} />}
        </DialogContent>
      </Dialog>
    </div>
  )
}

/** Saved sections the review fields know how to edit, in stored order. */
function editableSections(sections: SavedResumeSection[]) {
  return [...sections]
    .sort((left, right) => left.position - right.position)
    .flatMap((section) => {
      const sectionType = asSectionType(section.sectionType.toLowerCase())
      if (!sectionType) return []
      return [{ id: section.id, sectionType, title: section.title || SECTION_TITLES[sectionType], content: section.content }]
    })
}
