/** Edit one saved Markdown resume. Preview follows edits; exports use the last saved text. */
import { useRef, useState } from 'react'
import { ErrorAlert } from '@/components/ErrorAlert'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DeleteResumeDialog } from '@/features/resumes/DeleteResumeDialog'
import { useDeleteResume } from '@/features/resumes/useDeleteResume'
import { downloadResumeDocx, downloadResumePdf } from './resumeDownload'
import { ResumeEditorActions } from './ResumeEditorActions'
import { ResumePdfPreview } from './ResumePdfPreview'
import { ResumeUnsavedChanges } from './ResumeUnsavedChanges'
import { useUpdateResume } from './useUpdateResume'

/** Keeps the submitted snapshot so edits during a save still count as unsaved. */
export function SavedResumeEditor({ resumeId, title, markdown, jobId, onDeleted }: { resumeId: string; title: string; markdown: string; jobId?: string; onDeleted: () => void }) {
  const [draft, setDraft] = useState(markdown)
  const [saved, setSaved] = useState(markdown)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [exportPending, setExportPending] = useState<'PDF' | 'DOCX' | null>(null)
  const [exportError, setExportError] = useState<string[]>([])
  const deleted = useRef(false)
  const exporting = useRef(false)
  const { saveMarkdown, errors, pending } = useUpdateResume(resumeId)
  const deletion = useDeleteResume(resumeId, jobId)
  const dirty = draft !== saved

  async function save() {
    if (!draft.trim() || pending) return
    const submitted = draft
    if (await saveMarkdown(submitted)) setSaved(submitted)
  }

  async function download(format: 'PDF' | 'DOCX') {
    if (dirty || pending || deletion.pending || exporting.current) return
    exporting.current = true
    setExportPending(format)
    setExportError([])
    try {
      await (format === 'PDF' ? downloadResumePdf : downloadResumeDocx)(saved, title)
    } catch {
      setExportError([`Could not download the ${format}. Please try again.`])
    } finally {
      exporting.current = false
      setExportPending(null)
    }
  }

  async function confirmDelete() {
    if (await deletion.deleteResume()) { deleted.current = true; onDeleted() }
  }

  return <div className="grid gap-4">
    <ResumeUnsavedChanges dirty={dirty} discarded={deleted} />
    <ResumeEditorActions pending={pending} dirty={dirty} disabled={!draft.trim() || deletion.pending || !!exportPending} errors={errors} onPreview={() => setPreviewOpen(true)} onSave={() => void save()}>
      <Button type="button" variant="destructive" disabled={pending || deletion.pending || !!exportPending} onClick={() => setDeleteOpen(true)}>Delete resume</Button>
      {(['PDF', 'DOCX'] as const).map((format) => <Button key={format} type="button" variant="outline" disabled={dirty || pending || deletion.pending || !!exportPending} onClick={() => void download(format)}>{exportPending === format ? `Preparing ${format}…` : `Download ${format}`}</Button>)}
    </ResumeEditorActions>
    {dirty && <p className="text-sm text-muted-foreground">Save your changes to download</p>}
    <ErrorAlert messages={exportError} title="Couldn't download this resume" />
    <DeleteResumeDialog open={deleteOpen} onOpenChange={setDeleteOpen} onConfirm={() => void confirmDelete()} pending={deletion.pending} errors={deletion.errors} />
    <label className="font-medium" htmlFor={`resume-markdown-${resumeId}`}>Resume Markdown</label>
    <textarea id={`resume-markdown-${resumeId}`} aria-label="Resume Markdown" className="min-h-96 w-full rounded-md border bg-background p-4 font-mono text-sm" value={draft} maxLength={40000} onChange={(event) => setDraft(event.target.value)} />
    <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
      <DialogContent className="flex h-[min(68rem,calc(100svh-2rem))] w-[54rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden sm:max-w-[54rem]">
        <DialogHeader><DialogTitle>Preview</DialogTitle><DialogDescription>Preview includes unsaved edits. Save your changes before downloading.</DialogDescription></DialogHeader>
        {previewOpen && <ResumePdfPreview model={draft} />}
      </DialogContent>
    </Dialog>
  </div>
}
