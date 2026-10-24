/** Keep review, save feedback, and saved-resume actions together above the editor.
 * New drafts lead with full-resume review; saved resumes keep their editing actions.
 */
import type { ReactNode } from 'react'
import { Eye, LoaderCircle, Save } from 'lucide-react'
import { ErrorAlert } from '@/components/ErrorAlert'
import { Button } from '@/components/ui/button'

export function ResumeEditorActions({ pending, disabled = false, dirty, reviewFirst = false, errors, onPreview, onSave, children }: {
  pending: boolean
  dirty: boolean
  disabled?: boolean
  reviewFirst?: boolean
  errors: string[]
  onPreview: () => void
  onSave: () => void
  children?: ReactNode
}) {
  return (
    <div className="grid gap-3 rounded-xl border bg-card p-4 text-card-foreground shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="grid gap-1">
          {reviewFirst && <p className="font-medium">Your draft is ready to review</p>}
          <p className="text-sm text-muted-foreground">
            {reviewFirst
              ? 'Review the full resume to check that it represents you. Edit the Markdown below before saving.'
              : 'Edit your resume Markdown, then preview or save your changes.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {children}
          <Button type="button" variant={reviewFirst ? 'default' : 'outline'} disabled={disabled} onClick={onPreview}>
            <Eye aria-hidden /> {reviewFirst ? 'Review full resume' : 'Preview'}
          </Button>
          <Button type="button" variant={reviewFirst ? 'outline' : 'default'} disabled={pending || disabled} onClick={onSave}>
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
