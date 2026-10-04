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
          Paste a LinkedIn job link. We read the posting directly from LinkedIn, so the requirements are
          copied word for word.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Job posting link</CardTitle>
          <CardDescription>
            On LinkedIn, open the job and use Share, then Copy link (or copy the address bar, even from a
            search page).
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
                required
                placeholder="https://www.linkedin.com/jobs/view/1234567890"
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
