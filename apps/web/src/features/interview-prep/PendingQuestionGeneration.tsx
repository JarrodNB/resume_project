/**
 * Show unfinished question generation and recover live progress after reload.
 * Internal batch identities stay out of the interface; only empty requests can be dismissed.
 */
import type { InterviewSetsQuery } from '@/graphql/generated/graphql'
import { DismissQuestionGenerationButton } from './DismissQuestionGenerationButton'
import { InterviewTaskStatus } from './InterviewTaskStatus'
import { interviewSetDate } from './interviewSetDate'
import { interviewSetTypeLabel } from './interviewSetTypeLabel'

type QuestionSet = InterviewSetsQuery['interviewQuestionSets'][number]

export function PendingQuestionGeneration({ sets, onChanged }: { sets: QuestionSet[]; onChanged: () => unknown }) {
  if (sets.length === 0) return null
  return <ul className="question-pending" aria-label="Question generation">
    {sets.map((set) => <li key={set.id}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-bold">{interviewSetTypeLabel(set.setType)} questions · {interviewSetDate(set.createdAt)}</p>
        <DismissQuestionGenerationButton id={set.id} onDeleted={onChanged} />
      </div>
      {set.latestTask && <InterviewTaskStatus key={set.latestTask.id} task={set.latestTask} onFinished={onChanged} />}
    </li>)}
  </ul>
}
