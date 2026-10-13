/**
 * Description: Persistent interview question sets, newest first, with generation and deletion.
 * Index: InterviewPrepPage
 */
import { Link, useNavigate } from 'react-router'
import { useState } from 'react'
import type { InterviewQuestionSetTypeEnum } from '@/graphql/generated/graphql'
import { ErrorAlert } from '@/components/ErrorAlert'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import { interviewSetDate } from './interviewSetDate'
import { interviewSetTypeLabel } from './interviewSetTypeLabel'
import { DeleteInterviewSetButton } from './DeleteInterviewSetButton'
import { InterviewTaskStatus } from './InterviewTaskStatus'
import { useGenerateInterviewSet, useInterviewSets } from './useInterviewPrep'

const questionTypes: InterviewQuestionSetTypeEnum[] = ['GENERAL', 'TECHNICAL', 'KNOWLEDGE']
const questionDescriptions = {
  GENERAL: 'Practice general career questions about your experience, achievements, and goals.',
  TECHNICAL: 'Practice technical questions about your practical work and how you solve problems.',
  KNOWLEDGE: 'Test your understanding of subjects in your field.',
}

/** Generates and lists reusable sets based on the current career library. */
export function InterviewPrepPage() {
  const { sets, loading, error, refetch } = useInterviewSets()
  const generation = useGenerateInterviewSet()
  const navigate = useNavigate()
  const [setType, setSetType] = useState<InterviewQuestionSetTypeEnum>('GENERAL')
  /** Opens the persistent set as soon as generation is queued. */
  async function generate() {
    const id = await generation.generate(setType)
    if (id) void navigate(`/interview-prep/${id}`)
  }
  const visibleSets = sets?.filter((set) => set.setType === setType)
  return <div className="mx-auto grid max-w-3xl gap-6">
    <div className="grid gap-2">
      <h1 className="text-2xl font-semibold tracking-tight">Interview prep</h1>
      <p className="text-muted-foreground">Practice five personalized interview questions based on your career library. Saved sets stay as they are when your library changes.</p>
    </div>
    <Tabs value={setType} onValueChange={(value) => setSetType(value as InterviewQuestionSetTypeEnum)} className="gap-4">
      <TabsList aria-label="Question type" className="mx-auto h-12 w-full border border-primary/20 bg-primary/10 p-1 sm:w-fit">
        {questionTypes.map((type) => <TabsTrigger key={type} value={type} disabled={generation.loading} className="px-4 text-base font-semibold sm:px-7 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm dark:data-[state=active]:bg-primary dark:data-[state=active]:text-primary-foreground">{interviewSetTypeLabel(type)}</TabsTrigger>)}
      </TabsList>
      <TabsContent value={setType} className="grid gap-4">
        <p className="text-muted-foreground">{questionDescriptions[setType]}</p>
        <Button className="justify-self-start" disabled={generation.loading} onClick={() => void generate()}>{generation.loading ? 'Starting…' : 'Generate questions'}</Button>
        <ErrorAlert title="Couldn't generate questions" messages={generation.errors} />
        {error && <ErrorAlert title="Couldn't load your sets" messages={[requestErrorMessage(error, error.message)]} />}
        {!sets && loading && <p>Loading…</p>}
        {visibleSets?.length === 0 && <p className="text-muted-foreground">No {interviewSetTypeLabel(setType).toLowerCase()} question sets yet. Add your experience to the career library, then generate your first set.</p>}
        <ul className="grid gap-3">
          {visibleSets?.map((set) => <li key={set.id}><Card><CardContent className="grid gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Link className="font-medium underline underline-offset-4" to={`/interview-prep/${set.id}`}>Set {set.number} · {interviewSetTypeLabel(set.setType)} · {interviewSetDate(set.createdAt)}</Link>
              <DeleteInterviewSetButton id={set.id} number={set.number} onDeleted={refetch} />
            </div>
            {set.latestTask && <InterviewTaskStatus key={set.latestTask.id} task={set.latestTask} onFinished={refetch} />}
          </CardContent></Card></li>)}
        </ul>
      </TabsContent>
    </Tabs>
  </div>
}
