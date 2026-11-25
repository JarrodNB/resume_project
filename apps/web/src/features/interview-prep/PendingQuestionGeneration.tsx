/**
 * Show unfinished question generation and recover live progress after reload.
 * Internal batch identities stay out of the interface; only empty requests can be dismissed.
 */
import type { InterviewSetsQuery } from '@/graphql/generated/graphql'
import { DismissQuestionGenerationButton } from './DismissQuestionGenerationButton'
import { InterviewTaskStatus } from './InterviewTaskStatus'

type QuestionSet = InterviewSetsQuery['interviewQuestionSets'][number]

export function PendingQuestionGeneration({ sets, onChanged }: { sets: QuestionSet[]; onChanged: () => unknown }) {
  if (sets.length === 0) return null
  // Keep completed followers mounted until their live-update effect refreshes the bank.
  return <ul className="question-pending" aria-label="Question generation" hidden={sets.every((set) => set.latestTask?.status === 'COMPLETED')}>
    {sets.map((set) => <li key={set.id} hidden={set.latestTask?.status === 'COMPLETED'}>
      {set.latestTask && <InterviewTaskStatus key={set.latestTask.id} task={set.latestTask} onFinished={onChanged} />}
      {set.latestTask?.status !== 'COMPLETED' && <DismissQuestionGenerationButton id={set.id} onDeleted={onChanged} />}
    </li>)}
  </ul>
}
