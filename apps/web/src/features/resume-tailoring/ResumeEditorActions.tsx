/** Keep view switching, save feedback, and document actions together.
 * Preview is the default view; editing never discards the current draft.
 */
import type { ReactNode } from 'react'
import { Check, Eye, LoaderCircle, PencilLine, Save } from 'lucide-react'
import { ErrorAlert } from '@/components/ErrorAlert'
import { Button } from '@/components/ui/button'
import './resumeWorkspace.css'

export function ResumeEditorActions({ pending, disabled = false, empty = false, dirty, reviewFirst = false, editing, errors, onPreview, onEdit, onSave, children }: {
  pending: boolean
  dirty: boolean
  disabled?: boolean
  empty?: boolean
  reviewFirst?: boolean
  editing: boolean
  errors: string[]
  onPreview: () => void
  onEdit: () => void
  onSave: () => void
  children?: ReactNode
}) {
  return (
    <div className="resume-toolbar">
      <div className="resume-toolbar-heading">
        <div className="grid gap-1">
          {reviewFirst && <p className="font-medium">Your draft is ready to review</p>}
          <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
            {reviewFirst
              ? 'Review the full resume to check that it represents you. Choose Edit sections to make changes.'
              : 'Review your resume, or choose Edit sections to make changes.'}
          </p>
        </div>
        <p role="status" className="resume-save-status">
          {pending ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden /> : !dirty ? <Check className="size-3.5" aria-hidden /> : <span className="size-1.5 rounded-full bg-current" aria-hidden />}
          {pending ? 'Saving your resume…' : dirty ? 'Unsaved changes' : 'All changes saved'}
        </p>
      </div>
      <div className="resume-toolbar-controls">
        <div className="resume-view-switch" role="group" aria-label="Resume view">
          <Button type="button" variant={!editing ? 'secondary' : 'ghost'} aria-pressed={!editing} disabled={disabled || empty} onClick={onPreview}>
            <Eye aria-hidden /> Preview
          </Button>
          <Button type="button" variant={editing ? 'secondary' : 'ghost'} aria-pressed={editing} disabled={pending && reviewFirst} onClick={onEdit}>
            <PencilLine aria-hidden /> Edit sections
          </Button>
        </div>
        <div className="resume-document-actions">
          {children}
          <Button type="button" disabled={pending || disabled || empty} onClick={onSave}>
            {pending ? <LoaderCircle className="animate-spin" aria-hidden /> : <Save aria-hidden />}
            {pending ? 'Saving…' : 'Save resume'}
          </Button>
        </div>
      </div>
      <ErrorAlert messages={errors} title="Couldn't save this resume" />
    </div>
  )
}
