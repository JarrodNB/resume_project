/** Lets users archive a job directly from a Home tile or list row, keeping all saved data. */
import { useState } from 'react'
import { Archive } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ArchiveJobDialog } from '@/features/jobs/ArchiveJobDialog'
import { useArchiveJob } from '@/features/jobs/useArchiveJob'

export function ArchiveHomeJobButton({ jobId, title }: { jobId: string; title: string }) {
  const [open, setOpen] = useState(false)
  const { archive, busy, errors, clearErrors } = useArchiveJob()

  return (
    <div onPointerDown={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
      <Button
        variant="ghost"
        size="sm"
        aria-label={`Archive ${title}`}
        onClick={() => { clearErrors(); setOpen(true) }}
      >
        <Archive aria-hidden /> Archive
      </Button>
      <ArchiveJobDialog
        open={open}
        onOpenChange={setOpen}
        jobTitle={title}
        onConfirm={() => { void archive(jobId).then((ok) => { if (ok) setOpen(false) }) }}
        busy={busy}
        errors={errors}
      />
    </div>
  )
}
