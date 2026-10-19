/** Keep preview, save feedback, and any saved-resume actions together above the editor. */
import type { ReactNode } from 'react'
import { Eye, LoaderCircle, Save } from 'lucide-react'
import { ErrorAlert } from '@/components/ErrorAlert'
import { Button } from '@/components/ui/button'

export function ResumeEditorActions({ pending, disabled = false, dirty, errors, onPreview, onSave, children }: {
  pending: boolean
  dirty: boolean
  disabled?: boolean
  errors: string[]
  onPreview: () => void
  onSave: () => void
  children?: ReactNode
}) {
  return (
    <div className="grid gap-3 rounded-xl border bg-card p-4 text-card-foreground shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Review your sections, then preview or save your changes.</p>
        <div className="flex flex-wrap items-center gap-2">
          {children}
          <Button type="button" variant="outline" disabled={disabled} onClick={onPreview}><Eye aria-hidden /> Preview</Button>
          <Button type="button" disabled={pending || disabled} onClick={onSave}>
            {pending ? <LoaderCircle className="animate-spin" aria-hidden /> : <Save aria-hidden />}
            {pending ? 'Saving…' : 'Save resume'}
          </Button>
        </div>
      </div>
      <p role="status" className="text-sm text-muted-foreground">
        {pending ? 'Saving your resume…' : dirty ? 'Unsaved changes' : 'All changes saved'}
      </p>
      <ErrorAlert messages={errors} title="Couldn't save this resume" />
    </div>
  )
}
