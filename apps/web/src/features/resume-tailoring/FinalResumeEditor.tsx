/** Review and edit a complete Markdown draft before its one permitted save. */
import { useState } from 'react'
import { CircleAlert } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ResumeEditorActions } from './ResumeEditorActions'
import { ResumeUnsavedChanges } from './ResumeUnsavedChanges'
import { ResumePdfPreview } from './ResumePdfPreview'

/** The preview renders the current editor value; saving submits that same value. */
export function FinalResumeEditor({ markdown, warnings, pending, errors, onSave }: {
  markdown: string
  warnings: string[]
  pending: boolean
  errors: string[]
  onSave: (markdown: string) => Promise<boolean> | boolean | void
}) {
  const [draft, setDraft] = useState(markdown)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [saved, setSaved] = useState(false)

  async function save() {
    if (!draft.trim() || pending) return
    if (await onSave(draft)) setSaved(true)
  }

  return <div className="grid gap-4">
    <ResumeUnsavedChanges dirty={!saved} />
    <ResumeEditorActions reviewFirst pending={pending} dirty={!saved} disabled={!draft.trim()} errors={errors} onPreview={() => setPreviewOpen(true)} onSave={() => void save()} />
    {warnings.length > 0 && <Alert><CircleAlert aria-hidden /><AlertTitle>Draft notes</AlertTitle><AlertDescription>{warnings.map((warning) => <p key={warning}>{warning}</p>)}</AlertDescription></Alert>}
    <label className="font-medium" htmlFor="resume-markdown">Resume Markdown</label>
    <textarea id="resume-markdown" aria-label="Resume Markdown" className="min-h-96 w-full rounded-md border bg-background p-4 font-mono text-sm" value={draft} disabled={pending} maxLength={40000} onChange={(event) => setDraft(event.target.value)} />
    <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
      <DialogContent className="flex h-[min(68rem,calc(100svh-2rem))] w-[54rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden sm:max-w-[54rem]">
        <DialogHeader><DialogTitle>Preview</DialogTitle><DialogDescription>Preview includes unsaved edits. Save your resume before downloading.</DialogDescription></DialogHeader>
        {previewOpen && <ResumePdfPreview model={draft} />}
      </DialogContent>
    </Dialog>
  </div>
}
