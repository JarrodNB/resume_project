/**
 * Description: The saved resume as editable section fields. Preview opens the current
 * draft as a PDF at actual size. Save writes that draft.
 * Index:
 *   - SavedResumeEditor: the editor and its preview dialog
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
  const [previewOpen, setPreviewOpen] = useState(false)
  const { saveSections, errors, pending } = useUpdateResume(resumeId)
  const model = buildResumePdfModel(
    editable.map((section, index) => ({
      sectionType: section.sectionType,
      title: section.title,
      content: contentFromSectionDraft(drafts[index] ?? sectionDraftFromContent(section.sectionType, section.content)),
    })),
  )

  function save() {
    void saveSections(editable.map((section, index) => ({ id: section.id, content: contentFromSectionDraft(drafts[index]) })))
  }

  return (
    <div className="grid gap-4">
      <div className="flex justify-end">
        <Button type="button" variant="outline" onClick={() => setPreviewOpen(true)}>
          Preview
        </Button>
      </div>
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
