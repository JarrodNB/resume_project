/**
 * Description: Dialog that adds a job by hand or edits one.
 * Index:
 *   - JobFormDialog: opens the form for a job, or a blank one when job is null
 */
import { useId, useState, type ChangeEvent } from 'react'
import { ErrorAlert } from '@/components/ErrorAlert'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { JOB_DESCRIPTION_TEXT, PROSE_TEXT, SHORT_TEXT } from '@/lib/textLimits'
import { jobAttributes, type JobDraft } from './jobFormValues'
import { CREATE_JOB_MUTATION, UPDATE_JOB_MUTATION } from './jobsOperations'
import { StringListField } from './StringListField'
import { useSaveJob } from './useSaveJob'

interface JobFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  job: JobDraft | null
  onCreated?: (jobId: string) => void
}

/** Shows the job form while `open` is true. Closing throws away unsaved edits. */
export function JobFormDialog({ open, onOpenChange, job, onCreated }: JobFormDialogProps) {
  if (!open) return null
  return <JobForm key={job?.id ?? 'new'} job={job} onClose={() => onOpenChange(false)} onCreated={onCreated} />
}

/** The job fields and the save action. Every field is sent. */
function JobForm({ job, onClose, onCreated }: { job: JobDraft | null; onClose: () => void; onCreated?: (jobId: string) => void }) {
  const { save, busy, errors } = useSaveJob()
  const [title, setTitle] = useState(job?.title ?? '')
  const [company, setCompany] = useState(job?.company ?? '')
  const [location, setLocation] = useState(job?.location ?? '')
  const [url, setUrl] = useState(job?.url ?? '')
  const [notes, setNotes] = useState(job?.notes ?? '')
  const [description, setDescription] = useState(job?.description ?? '')
  const [requirements, setRequirements] = useState(job?.requirements ?? [])
  const [niceToHaves, setNiceToHaves] = useState(job?.niceToHaves ?? [])

  /** Creates or updates the job. A new job opens its page. */
  async function submit() {
    const attributes = jobAttributes({ title, company, location, url, notes, description, requirements, niceToHaves })
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
      <DialogContent className="max-h-[calc(100%-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{job ? 'Edit job' : 'Add a job'}</DialogTitle>
          <DialogDescription>
            {job
              ? 'Requirement answers stay tied to the wording already saved.'
              : 'Title and company are required. You can fill in the posting yourself.'}
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <JobField label="Title" value={title} onChange={setTitle} required maxLength={SHORT_TEXT} />
          <JobField label="Company" value={company} onChange={setCompany} required maxLength={SHORT_TEXT} />
          <JobField label="Location" value={location} onChange={setLocation} maxLength={SHORT_TEXT} />
          <JobField label="Link" value={url} onChange={setUrl} type="url" maxLength={SHORT_TEXT} />
          <JobField label="Notes" value={notes} onChange={setNotes} multiline maxLength={PROSE_TEXT} />
          <JobField label="Description" value={description} onChange={setDescription} multiline maxLength={JOB_DESCRIPTION_TEXT} />
          <StringListField legend="Requirements" addLabel="Add requirement" itemLabel="Requirement" items={requirements} onChange={setRequirements} />
          <StringListField legend="Nice to have" addLabel="Add nice to have" itemLabel="Nice to have" items={niceToHaves} onChange={setNiceToHaves} />
          <ErrorAlert title="Couldn't save" messages={errors} />
          <DialogFooter>
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
  type = 'text',
  maxLength,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  required?: boolean
  multiline?: boolean
  type?: 'text' | 'url'
  maxLength?: number
}) {
  const id = useId()
  const shared = {
    id,
    value,
    required,
    maxLength,
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(event.target.value),
  }
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {multiline ? <Textarea {...shared} rows={3} /> : <Input {...shared} type={type} />}
    </div>
  )
}
