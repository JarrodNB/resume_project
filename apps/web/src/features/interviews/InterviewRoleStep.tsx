/** Step one of mock interview setup: choose who the interview is for.
 *
 * A practice role continues to round setup on this page, using a fictional role built from the
 * career library. A saved job opens that job's Interview tab, where setup uses the job's details.
 * Rejected jobs are left out. Only the few newest jobs show at first so the page stays short;
 * when there are more, a search box finds the rest by title, company or location. A job the
 * user already picked stays in the list while they search.
 */
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { JOB_STAGE_LABELS } from '@/features/jobs/jobStageLabels'
import { useJobs } from '@/features/jobs/useJobs'

const PRACTICE_ROLE = 'practice-role'
const SHOWN_JOB_LIMIT = 5

type SavedJob = NonNullable<ReturnType<typeof useJobs>['jobs']>[number]

function jobMatchesSearch(job: SavedJob, search: string) {
  return [job.title, job.company, job.location].some((text) => text?.toLowerCase().includes(search))
}

export function InterviewRoleStep({ onPracticeRole }: { onPracticeRole: () => void }) {
  const { jobs, loading, error } = useJobs()
  const navigate = useNavigate()
  const [choice, setChoice] = useState(PRACTICE_ROLE)
  const [search, setSearch] = useState('')
  const openJobs = (jobs ?? []).filter((job) => job.stage !== 'REJECTED')
  const searchText = search.trim().toLowerCase()
  const matchingJobs = searchText ? openJobs.filter((job) => jobMatchesSearch(job, searchText)) : openJobs
  const shownJobs = matchingJobs.slice(0, SHOWN_JOB_LIMIT)
  const chosenJob = openJobs.find((job) => job.id === choice)
  if (chosenJob && !shownJobs.includes(chosenJob)) shownJobs.unshift(chosenJob)
  const canSearch = openJobs.length > SHOWN_JOB_LIMIT

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
        {canSearch && (
          <div className="grid gap-1.5">
            <label htmlFor="interview-job-search" className="text-sm font-medium">Search saved jobs</label>
            <Input id="interview-job-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') event.preventDefault() }}
              placeholder="Title, company or location" className="h-11 max-w-md" autoComplete="off" />
          </div>
        )}
        <div className="interview-setup-choices">
          <RoleChoice value={PRACTICE_ROLE} checked={choice === PRACTICE_ROLE} onChange={setChoice}
            label="A practice role" description="We’ll create a fictional role that fits your career library." />
          {shownJobs.map((job) => (
            <RoleChoice key={job.id} value={job.id} checked={choice === job.id} onChange={setChoice}
              label={job.title}
              description={`${job.company ?? 'Unknown company'} · ${JOB_STAGE_LABELS[job.stage]}`} />
          ))}
        </div>
        {canSearch && (
          <p role="status" className="text-sm text-muted-foreground">
            {jobListSummary({ searchText, matchCount: matchingJobs.length, openCount: openJobs.length })}
          </p>
        )}
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

function jobListSummary({ searchText, matchCount, openCount }: { searchText: string; matchCount: number; openCount: number }) {
  if (!searchText) return `Showing your ${SHOWN_JOB_LIMIT} newest of ${openCount} saved jobs. Search to find the others.`
  if (matchCount === 0) return 'No saved jobs match your search.'
  if (matchCount > SHOWN_JOB_LIMIT) return `Showing ${SHOWN_JOB_LIMIT} of ${matchCount} matching jobs. Keep typing to narrow the list.`
  return matchCount === 1 ? '1 saved job matches.' : `${matchCount} saved jobs match.`
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
