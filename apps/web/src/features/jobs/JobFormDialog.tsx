/**
 * Adds a job by hand or edits one. Description actions focus that field so users can
 * start typing immediately; normal edits begin at the first field.
 * Index:
 *   - JobFormDialog: opens the form for a job, or a blank one when job is null
 */
import { useId, useRef, useState, type ChangeEvent, type Ref } from 'react'
import { ErrorAlert } from '@/components/ErrorAlert'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { JOB_DESCRIPTION_TEXT, JOB_URL_TEXT, PROSE_TEXT, SHORT_TEXT } from '@/lib/textLimits'
import { jobAttributes, normalizeJobUrl, type JobDraft } from './jobFormValues'
import { CREATE_JOB_MUTATION, UPDATE_JOB_MUTATION } from './jobsOperations'
import { StringListField } from './StringListField'
import { useSaveJob } from './useSaveJob'

interface JobFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  job: JobDraft | null
  onCreated?: (jobId: string) => void
  focusDescription?: boolean
}

/** Shows the job form while `open` is true. Closing throws away unsaved edits. */
export function JobFormDialog({ open, onOpenChange, job, onCreated, focusDescription = false }: JobFormDialogProps) {
  if (!open) return null
  return <JobForm key={job?.id ?? 'new'} job={job} onClose={() => onOpenChange(false)} onCreated={onCreated} focusDescription={focusDescription} />
}

/** The job fields and the save action. Every field is sent. */
function JobForm({ job, onClose, onCreated, focusDescription }: { job: JobDraft | null; onClose: () => void; onCreated?: (jobId: string) => void; focusDescription: boolean }) {
  const descriptionRef = useRef<HTMLTextAreaElement>(null)
  const { save, busy, errors } = useSaveJob()
  const [title, setTitle] = useState(job?.title ?? '')
  const [company, setCompany] = useState(job?.company ?? '')
  const [location, setLocation] = useState(job?.location ?? '')
  const [url, setUrl] = useState(job?.url ?? '')
  const [notes, setNotes] = useState(job?.notes ?? '')
  const [description, setDescription] = useState(job?.description ?? '')
  const [requirements, setRequirements] = useState(job?.requirements ?? [])
  const [responsibilities, setResponsibilities] = useState(job?.responsibilities ?? [])
  const [niceToHaves, setNiceToHaves] = useState(job?.niceToHaves ?? [])

  const [fieldErrors, setFieldErrors] = useState<{ title?: string; url?: string }>({})

  /** Creates or updates the job. A new job opens its page. */
  async function submit() {
    const found: { title?: string; url?: string } = {}
    if (!title.trim()) found.title = 'Enter a job title.'
    const checkedUrl = url.trim() ? normalizeJobUrl(url) : null
    if (url.trim() && !checkedUrl) found.url = 'Enter a web address like https://company.com/jobs/123.'
    setFieldErrors(found)
    if (found.title || found.url) return
    const attributes = jobAttributes({
      title,
      company,
      location,
      url: checkedUrl ?? '',
      notes,
      description,
      requirements,
      responsibilities,
      niceToHaves,
    })
    if (job) {
      const result = await save(UPDATE_JOB_MUTATION, { id: job.id, attributes })
      if (result.ok) onClose()
      return
    }
    const result = await save(CREATE_JOB_MUTATION, { attributes })
    if (result.ok && result.jobId) {
      onClose()
      onCreated?.(result.jobId)
    }
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        className="flex max-h-[calc(100%-2rem)] flex-col overflow-hidden sm:max-w-lg"
        onOpenAutoFocus={(event) => {
          if (focusDescription) {
            event.preventDefault()
            descriptionRef.current?.focus()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{job ? 'Edit job' : 'Add a job'}</DialogTitle>
          <DialogDescription>
            {job
              ? 'Requirement answers stay tied to the wording already saved.'
              : 'Title is required. You can add the company when you know it.'}
          </DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="flex min-h-0 flex-1 flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto px-0.5 pb-1">
          <p className="text-sm text-muted-foreground">Fields marked * are required.</p>
          <JobField label="Title" value={title} onChange={setTitle} required error={fieldErrors.title} maxLength={SHORT_TEXT} />
          <JobField label="Company" value={company} onChange={setCompany} maxLength={SHORT_TEXT} />
          <JobField label="Location" value={location} onChange={setLocation} maxLength={SHORT_TEXT} />
          <JobField label="Link" value={url} onChange={setUrl} error={fieldErrors.url} maxLength={JOB_URL_TEXT} />
          <JobField label="Notes" value={notes} onChange={setNotes} multiline maxLength={PROSE_TEXT} />
          <JobField label="Description" textareaRef={descriptionRef} value={description} onChange={setDescription} multiline maxLength={JOB_DESCRIPTION_TEXT} />
          <StringListField legend="Requirements" addLabel="Add requirement" itemLabel="Requirement" items={requirements} onChange={setRequirements} />
          <StringListField
            legend="Responsibilities"
            addLabel="Add responsibility"
            itemLabel="Responsibility"
            items={responsibilities}
            onChange={setResponsibilities}
          />
          <StringListField legend="Nice to have" addLabel="Add nice to have" itemLabel="Nice to have" items={niceToHaves} onChange={setNiceToHaves} />
          <ErrorAlert title="Couldn't save" messages={errors} />
          </div>
          <DialogFooter className="shrink-0">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** A labelled input or textarea. */
function JobField({
  label,
  value,
  onChange,
  required,
  multiline,
  error,
  maxLength,
  textareaRef,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  required?: boolean
  multiline?: boolean
  error?: string
  maxLength?: number
  textareaRef?: Ref<HTMLTextAreaElement>
}) {
  const id = useId()
  const shared = {
    id,
    value,
    maxLength,
    'aria-required': required || undefined,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error ? `${id}-error` : undefined,
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(event.target.value),
  }
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id} className={required ? "after:ml-0.5 after:content-['*']" : undefined}>{label}</Label>
      {multiline ? <Textarea {...shared} ref={textareaRef} rows={3} /> : <Input {...shared} type="text" />}
      {error && <p id={`${id}-error`} role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
