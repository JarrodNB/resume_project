/** Edit saved resume sections and preview their current content before saving.
 * Drafts live above collapsible cards so closing a section keeps unsaved edits.
 * Deletion requires confirmation; the route chooses where to return afterward.
 * PDF and DOCX downloads use a saved snapshot; unsaved edits stay preview-only.
 * Save status tracks the submitted snapshot, so edits made during a save stay unsaved.
 */
import { useMemo, useRef, useState } from 'react'
import { ErrorAlert } from '@/components/ErrorAlert'
import { downloadResumeDocx, downloadResumePdf } from './resumeDownload'
import { Button } from '@/components/ui/button'
import { DeleteResumeDialog } from '@/features/resumes/DeleteResumeDialog'
import { useDeleteResume } from '@/features/resumes/useDeleteResume'
import { SectionCard } from '@/components/SectionCard'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ResumeEditorActions } from './ResumeEditorActions'
import { ResumeUnsavedChanges } from './ResumeUnsavedChanges'
import { SectionFields } from './SectionFields'
import { ResumePdfPreview } from './ResumePdfPreview'
import { buildResumePdfModel } from './resumePdfModel'
import { asSectionType, SECTION_TITLES } from './sectionOrder'
import { contentFromSectionDraft, sectionDraftFromContent, type SectionDraft } from './tailorDraft'
import { useUpdateResume } from './useUpdateResume'

interface SavedResumeSection {
  id: string
  sectionType: string
  title: string
  position: number
  content: unknown
}

/** Edits one saved resume. Preview shows the current draft at actual size. */
export function SavedResumeEditor({ resumeId, title = '', targetPageCount = 2, sections, jobId, onDeleted }: { resumeId: string; title?: string; targetPageCount?: number; sections: SavedResumeSection[]; jobId?: string; onDeleted: () => void }) {
  const editable = useMemo(() => editableSections(sections), [sections])
  const [drafts, setDrafts] = useState<SectionDraft[]>(() => editable.map((section) => sectionDraftFromContent(section.sectionType, section.content)))
  const [savedSnapshot, setSavedSnapshot] = useState(() => JSON.stringify(drafts))
  const [savedModel, setSavedModel] = useState(() => buildResumePdfModel(editable))
  const deleted = useRef(false)
  const exporting = useRef(false)
  const [exportPending, setExportPending] = useState<'PDF' | 'DOCX' | null>(null)
  const [exportError, setExportError] = useState<string[]>([])
  const snapshot = JSON.stringify(drafts)
  const dirty = snapshot !== savedSnapshot
  const [previewOpen, setPreviewOpen] = useState(false)
  const { saveSections, errors, pending } = useUpdateResume(resumeId)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const deletion = useDeleteResume(resumeId, jobId)

  async function confirmDelete() {
    if (await deletion.deleteResume()) {
      deleted.current = true
      onDeleted()
    }
  }
  const model = buildResumePdfModel(
    editable.map((section, index) => ({
      sectionType: section.sectionType,
      title: section.title,
      content: contentFromSectionDraft(drafts[index] ?? sectionDraftFromContent(section.sectionType, section.content)),
    })),
  )

  async function save() {
    if (pending) return
    if (await saveSections(editable.map((section, index) => ({ id: section.id, content: contentFromSectionDraft(drafts[index]) })))) {
      setSavedSnapshot(snapshot)
      setSavedModel(model)
    }
  }

  async function download(format: 'PDF' | 'DOCX') {
    if (dirty || pending || deletion.pending || exporting.current) return
    exporting.current = true
    setExportPending(format)
    setExportError([])
    // Later edits build a different model and cannot change this saved snapshot.
    try {
      await (format === 'PDF' ? downloadResumePdf : downloadResumeDocx)(savedModel, title)
    } catch {
      setExportError([`Could not download the ${format}. Please try again.`])
    } finally {
      exporting.current = false
      setExportPending(null)
    }
  }

  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">Target: {targetPageCount} {targetPageCount === 1 ? 'page' : 'pages'}</p>
      <ResumeUnsavedChanges dirty={dirty} discarded={deleted} />
      <ResumeEditorActions pending={pending} dirty={dirty} disabled={deletion.pending || !!exportPending} errors={errors} onPreview={() => setPreviewOpen(true)} onSave={() => void save()}>
        <Button type="button" variant="destructive" disabled={pending || deletion.pending || !!exportPending} onClick={() => setDeleteOpen(true)}>Delete resume</Button>
        {(['PDF', 'DOCX'] as const).map((format) => (
          <Button key={format} type="button" variant="outline" disabled={dirty || pending || deletion.pending || !!exportPending} onClick={() => void download(format)}>
            {exportPending === format ? `Preparing ${format}…` : `Download ${format}`}
          </Button>
        ))}
      </ResumeEditorActions>
      {dirty && <p className="text-sm text-muted-foreground">Save your changes to download</p>}
      <ErrorAlert messages={exportError} title="Couldn't download this resume" />
      <DeleteResumeDialog open={deleteOpen} onOpenChange={setDeleteOpen} onConfirm={() => void confirmDelete()} pending={deletion.pending} errors={deletion.errors} />
      {editable.map((section, index) => (
        <SectionCard key={section.id} tone={section.sectionType} title={section.title} sectionId={`saved-resume.${resumeId}.${section.id}`}>
          <SectionFields
            draft={drafts[index]}
            onChange={(next) => setDrafts(drafts.map((draft, position) => (position === index ? next : draft)))}
          />
        </SectionCard>
      ))}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="flex h-[min(68rem,calc(100svh-2rem))] w-[54rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden sm:max-w-[54rem]">
          <DialogHeader className="w-full pr-8">
            <DialogTitle>Preview</DialogTitle>
            <DialogDescription>Preview includes unsaved edits. Save your changes before downloading.</DialogDescription>
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
