/**
 * Description: Add a job from a posting link (/jobs/new). Starts scraping, then moves to the task
 * page, where progress shows live.
 * Index:
 *   - AddJobFromUrlPage: page component
 */
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { ErrorAlert } from '@/components/ErrorAlert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { JOB_URL_TEXT } from '@/lib/textLimits'
import { useScrapeJob } from './useScrapeJob'

/** A URL form that calls scrapeJob and opens the new task's page. */
export function AddJobFromUrlPage() {
  const navigate = useNavigate()
  const { scrapeJob, submitting, errors } = useScrapeJob()
  const [url, setUrl] = useState('')

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const aiTaskId = await scrapeJob(url.trim())
    if (aiTaskId) navigate(`/jobs/new/${aiTaskId}`)
  }

  return (
    <div className="mx-auto grid max-w-2xl gap-6">
      <div className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Add a job</h1>
        <p className="text-muted-foreground">
          Paste a link to a public job posting. We read the page and copy its job details into your saved jobs.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Job posting link</CardTitle>
          <CardDescription>
            Open the specific job and copy its address. If the website requires login or blocks access,
            you can paste the job description instead.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4" onSubmit={(event) => void handleSubmit(event)}>
            <ErrorAlert messages={errors} title="Couldn't add this job" />
            <div className="grid gap-2">
              <Label htmlFor="job-url">Link</Label>
              <Input
                id="job-url"
                type="url"
                maxLength={JOB_URL_TEXT}
                required
                placeholder="https://company.com/careers/job-title"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
              />
            </div>
            <Button type="submit" disabled={submitting || url.trim() === ''} className="justify-self-start">
              {submitting ? 'Adding…' : 'Add job'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
