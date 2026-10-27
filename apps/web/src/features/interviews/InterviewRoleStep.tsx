/** Step one of mock interview setup: choose who the interview is for.
 *
 * A practice role continues to round setup on this page, using a fictional role built from the
 * career library. A saved job opens that job's Interview tab, where setup uses the job's details.
 * Rejected jobs are left out; every other saved job is offered, newest first.
 */
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Button } from '@/components/ui/button'
import { JOB_STAGE_LABELS } from '@/features/jobs/jobStageLabels'
import { useJobs } from '@/features/jobs/useJobs'

const PRACTICE_ROLE = 'practice-role'

export function InterviewRoleStep({ onPracticeRole }: { onPracticeRole: () => void }) {
  const { jobs, loading, error } = useJobs()
  const navigate = useNavigate()
  const [choice, setChoice] = useState(PRACTICE_ROLE)
  const openJobs = (jobs ?? []).filter((job) => job.stage !== 'REJECTED')

  function continueSetup() {
    if (choice === PRACTICE_ROLE) onPracticeRole()
    else void navigate(`/jobs/${choice}/interview`)
  }

  return (
    <form className="interview-setup" onSubmit={(event) => { event.preventDefault(); continueSetup() }}>
      <div className="grid gap-2">
        <h2 className="text-xl font-medium">Who is this interview for?</h2>
        <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">Practise for a job you saved, or for a practice role built from your career library. Next, you’ll choose the kind of round.</p>
      </div>
      <fieldset className="interview-setup-section">
        <legend>Interview for</legend>
        <div className="interview-setup-choices">
          <RoleChoice value={PRACTICE_ROLE} checked={choice === PRACTICE_ROLE} onChange={setChoice}
            label="A practice role" description="We’ll create a fictional role that fits your career library." />
          {openJobs.map((job) => (
            <RoleChoice key={job.id} value={job.id} checked={choice === job.id} onChange={setChoice}
              label={job.title}
              description={`${job.company ?? 'Unknown company'} · ${JOB_STAGE_LABELS[job.stage]}`} />
          ))}
        </div>
        {loading && !jobs && <p role="status" className="text-sm text-muted-foreground">Loading saved jobs…</p>}
        {error && <p role="alert" className="text-sm">Couldn’t load saved jobs. You can still practise with a practice role.</p>}
        {jobs && openJobs.length === 0 && (
          <p className="text-sm text-muted-foreground">No saved jobs to practise for yet. <Link to="/jobs/find" className="underline underline-offset-4">Find jobs</Link> to add one.</p>
        )}
      </fieldset>
      <Button type="submit" size="lg" className="justify-self-start">Continue</Button>
    </form>
  )
}

function RoleChoice({ value, checked, onChange, label, description }: { value: string; checked: boolean; onChange: (value: string) => void; label: string; description: string }) {
  return (
    <label className="interview-setup-choice">
      <input type="radio" name="interview-role" value={value} checked={checked} onChange={() => onChange(value)} />
      <span>
        <span className="block font-medium break-words">{label}</span>
        <span className="mt-1 block text-sm leading-relaxed text-muted-foreground break-words">{description}</span>
      </span>
    </label>
  )
}
