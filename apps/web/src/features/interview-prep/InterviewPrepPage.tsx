/**
 * Description: Persistent interview question sets, newest first, with generation and deletion.
 * Index: InterviewPrepPage
 */
import { Link, useNavigate } from 'react-router'
import { useState } from 'react'
import type { InterviewQuestionSetTypeEnum } from '@/graphql/generated/graphql'
import { PageHeading } from '@/components/PageHeading'
import { ErrorAlert } from '@/components/ErrorAlert'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import { interviewSetDate } from './interviewSetDate'
import { interviewSetTypeLabel } from './interviewSetTypeLabel'
import { DeleteInterviewSetButton } from './DeleteInterviewSetButton'
import { InterviewTaskStatus } from './InterviewTaskStatus'
import { useGenerateInterviewSet, useInterviewSets } from './useInterviewPrep'
import { useCareerLibrary } from '@/features/career-library/useCareerLibrary'

/** Generates and lists reusable sets based on the current career library. */
export function InterviewPrepPage() {
  const { sets, loading, error, refetch } = useInterviewSets()
  const { library, loading: libraryLoading, error: libraryError } = useCareerLibrary()
  const generation = useGenerateInterviewSet()
  const navigate = useNavigate()
  const [setType, setSetType] = useState<InterviewQuestionSetTypeEnum>('GENERAL')
  const hasCareerContext = Boolean(library && (
    library.me.summary?.trim() || library.experiences.length || library.projects.length ||
    library.educations.length || library.certifications.length || library.skills.length || library.libraryFacts.length
  ))
  /** Opens the persistent set as soon as generation is queued. */
  async function generate() {
    const id = await generation.generate(setType)
    if (id) void navigate(`/interview-prep/${id}`)
  }
  return <div className="mx-auto grid max-w-3xl gap-6">
    <PageHeading title="Interview prep" description="Turn your experience into a conversation you’re ready for." />
    <div className="grid gap-5 rounded-xl border bg-card p-6">
      <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">Practice five personalized interview questions based on your career library. Choose general career questions, technical questions about your practical work, or knowledge questions that test your understanding of subjects in your field. Saved sets stay as they are when your library changes.</p>
      <RadioGroup aria-label="Question type" className="flex flex-wrap gap-5" value={setType} disabled={generation.loading} onValueChange={(value) => setSetType(value as InterviewQuestionSetTypeEnum)}>
        <div className="flex items-center gap-2"><RadioGroupItem id="general-questions" value="GENERAL" /><Label htmlFor="general-questions">General</Label></div>
        <div className="flex items-center gap-2"><RadioGroupItem id="technical-questions" value="TECHNICAL" /><Label htmlFor="technical-questions">Technical</Label></div>
        <div className="flex items-center gap-2"><RadioGroupItem id="knowledge-questions" value="KNOWLEDGE" /><Label htmlFor="knowledge-questions">Knowledge</Label></div>
      </RadioGroup>
      <Button className="justify-self-start" disabled={generation.loading || !hasCareerContext} onClick={() => void generate()}>{generation.loading ? 'Starting…' : 'Generate questions'}</Button>
      {!hasCareerContext && !libraryError && <div className="grid gap-2 text-sm text-muted-foreground" aria-live="polite">
        {libraryLoading ? <p>Checking your career library…</p> : <>
          <p>Add career details before generating interview questions.</p>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            <Link className="font-medium text-foreground underline underline-offset-4" to="/import">Import a resume</Link>
            <Link className="font-medium text-foreground underline underline-offset-4" to="/library">Add details in your career library</Link>
          </div>
        </>}
      </div>}
    </div>
    <ErrorAlert title="Couldn't generate questions" messages={generation.errors} />
    {error && <ErrorAlert title="Couldn't load your sets" messages={[requestErrorMessage(error, error.message)]} />}
    {libraryError && <ErrorAlert title="Couldn't check your career library" messages={[requestErrorMessage(libraryError, libraryError.message)]} />}
    {!sets && loading && <p>Loading…</p>}
    {sets?.length === 0 && hasCareerContext && <p className="text-muted-foreground">No question sets yet. Generate your first set when you’re ready to practice.</p>}
    <ul className="grid gap-3">
      {sets?.map((set) => <li key={set.id}><Card><CardContent className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link className="font-medium underline underline-offset-4" to={`/interview-prep/${set.id}`}>Set {set.number} · {interviewSetTypeLabel(set.setType)} · {interviewSetDate(set.createdAt)}</Link>
          <DeleteInterviewSetButton id={set.id} number={set.number} onDeleted={refetch} />
        </div>
        {set.latestTask && <InterviewTaskStatus key={set.latestTask.id} task={set.latestTask} onFinished={refetch} />}
      </CardContent></Card></li>)}
    </ul>
  </div>
}
