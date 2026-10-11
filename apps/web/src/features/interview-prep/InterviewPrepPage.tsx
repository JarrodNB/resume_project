/**
 * Description: Persistent interview question sets, newest first, with generation and deletion.
 * Index: InterviewPrepPage
 */
import { Link, useNavigate } from 'react-router'
import { ErrorAlert } from '@/components/ErrorAlert'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import { interviewSetDate } from './interviewSetDate'
import { DeleteInterviewSetButton } from './DeleteInterviewSetButton'
import { InterviewTaskStatus } from './InterviewTaskStatus'
import { useGenerateInterviewSet, useInterviewSets } from './useInterviewPrep'

/** Generates and lists reusable sets based on the current career library. */
export function InterviewPrepPage() {
  const { sets, loading, error, refetch } = useInterviewSets()
  const generation = useGenerateInterviewSet()
  const navigate = useNavigate()
  /** Opens the persistent set as soon as generation is queued. */
  async function generate() {
    const id = await generation.generate()
    if (id) void navigate(`/interview-prep/${id}`)
  }
  return <div className="mx-auto grid max-w-3xl gap-6">
    <div className="grid gap-2">
      <h1 className="text-2xl font-semibold tracking-tight">Interview prep</h1>
      <p className="text-muted-foreground">Practice five personalized, non-technical interview questions based on your career library. Saved sets stay as they are when your library changes.</p>
      <Button className="justify-self-start" disabled={generation.loading} onClick={() => void generate()}>{generation.loading ? 'Starting…' : 'Generate questions'}</Button>
    </div>
    <ErrorAlert title="Couldn't generate questions" messages={generation.errors} />
    {error && <ErrorAlert title="Couldn't load your sets" messages={[requestErrorMessage(error, error.message)]} />}
    {!sets && loading && <p>Loading…</p>}
    {sets?.length === 0 && <p className="text-muted-foreground">No question sets yet. Add your experience to the career library, then generate your first set.</p>}
    <ul className="grid gap-3">
      {sets?.map((set) => <li key={set.id}><Card><CardContent className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link className="font-medium underline underline-offset-4" to={`/interview-prep/${set.id}`}>Set {set.number} · {interviewSetDate(set.createdAt)}</Link>
          <DeleteInterviewSetButton id={set.id} number={set.number} onDeleted={refetch} />
        </div>
        {set.latestTask && <InterviewTaskStatus key={set.latestTask.id} task={set.latestTask} onFinished={refetch} />}
      </CardContent></Card></li>)}
    </ul>
  </div>
}
