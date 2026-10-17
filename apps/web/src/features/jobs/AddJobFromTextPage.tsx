/**
 * Description: Add a job by pasting the advertisement (/jobs/paste). Starts parsing, then moves
 * to the task page, where progress shows live.
 * Index:
 *   - AddJobFromTextPage: page component
 */
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { ErrorAlert } from '@/components/ErrorAlert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useParseJobPosting } from './useParseJobPosting'

/** A text form that calls parseJobPosting and opens the new task's page. */
export function AddJobFromTextPage() {
  const navigate = useNavigate()
  const { parseJobPosting, submitting, errors } = useParseJobPosting()
  const [text, setText] = useState('')

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const aiTaskId = await parseJobPosting(text)
    if (aiTaskId) navigate(`/jobs/paste/${aiTaskId}`)
  }

  return (
    <div className="mx-auto grid max-w-2xl gap-6">
      <div className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Add a job</h1>
        <p className="text-muted-foreground">
          Paste the full job ad. We copy the title, any named company, and requirements from that text and save the job.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Job advertisement</CardTitle>
          <CardDescription>Copy the posting from the job site and paste it here, including the title. The company can be unknown.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4" onSubmit={(event) => void handleSubmit(event)}>
            <ErrorAlert messages={errors} title="Couldn't add this job" />
            <div className="grid gap-2">
              <Label htmlFor="job-ad">Job ad</Label>
              <Textarea
                id="job-ad"
                required
                rows={12}
                placeholder="Paste the job title and description"
                value={text}
                onChange={(event) => setText(event.target.value)}
                className="min-h-48"
              />
            </div>
            <Button type="submit" disabled={submitting || text.trim() === ''} className="justify-self-start">
              {submitting ? 'Adding…' : 'Add job'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
