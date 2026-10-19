/** Edit saved resume sections and preview their current content before saving.
 * Drafts live above collapsible cards so closing a section keeps unsaved edits.
 * Deletion requires confirmation; the route chooses where to return afterward.
 * Save status tracks the submitted snapshot, so edits made during a save stay unsaved.
 */
import { useMemo, useState } from 'react'
import { flushSync } from 'react-dom'
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
export function SavedResumeEditor({ resumeId, sections, jobId, onDeleted }: { resumeId: string; sections: SavedResumeSection[]; jobId?: string; onDeleted: () => void }) {
  const editable = useMemo(() => editableSections(sections), [sections])
  const [drafts, setDrafts] = useState<SectionDraft[]>(() => editable.map((section) => sectionDraftFromContent(section.sectionType, section.content)))
  const [savedSnapshot, setSavedSnapshot] = useState(() => JSON.stringify(drafts))
  const [deleted, setDeleted] = useState(false)
  const snapshot = JSON.stringify(drafts)
  const dirty = !deleted && snapshot !== savedSnapshot
  const [previewOpen, setPreviewOpen] = useState(false)
  const { saveSections, errors, pending } = useUpdateResume(resumeId)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const deletion = useDeleteResume(resumeId, jobId)

  async function confirmDelete() {
    if (await deletion.deleteResume()) {
      flushSync(() => setDeleted(true))
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
    }
  }

  return (
    <div className="grid gap-4">
      <ResumeUnsavedChanges dirty={dirty} />
      <ResumeEditorActions pending={pending} dirty={dirty} disabled={deletion.pending} errors={errors} onPreview={() => setPreviewOpen(true)} onSave={() => void save()}>
        <Button type="button" variant="destructive" disabled={pending || deletion.pending} onClick={() => setDeleteOpen(true)}>Delete resume</Button>
      </ResumeEditorActions>
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
