/**
 * Description: The job page's resume action. A saved resume opens directly. A finished
 * comparison goes straight to tailoring. Otherwise a dialog recommends comparing first.
 * Index:
 *   - WriteResumeAction: the header button
 */
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Button } from '@/components/ui/button'
import { ConfirmWriteResumeDialog } from './ConfirmWriteResumeDialog'

interface WriteResumeActionProps {
  jobId: string
  resumeId: string | null
  comparisonFinished: boolean
}

/** Opens the saved resume, or starts writing one, asking first when no comparison has finished. */
export function WriteResumeAction({ jobId, resumeId, comparisonFinished }: WriteResumeActionProps) {
  const navigate = useNavigate()
  const [confirming, setConfirming] = useState(false)

  if (resumeId) {
    return (
      <Button asChild size="sm">
        <Link to={`/resumes/${resumeId}`} state={{ fromJobId: jobId }}>
          Open resume
        </Link>
      </Button>
    )
  }

  if (comparisonFinished) {
    return (
      <Button asChild size="sm">
        <Link to={`/jobs/${jobId}/tailor`}>Write resume</Link>
      </Button>
    )
  }

  return (
    <>
      <Button size="sm" onClick={() => setConfirming(true)}>
        Write resume
      </Button>
      <ConfirmWriteResumeDialog
        open={confirming}
        onOpenChange={setConfirming}
        onWriteAnyway={() => navigate(`/jobs/${jobId}/tailor`)}
      />
    </>
  )
}
