/**
 * Description: The sets of five that questions were generated in, newest first.
 * Sets still generating (or that failed) show their status so the user sees and can clear them;
 * finished sets sit in a collapsed section with progress and deletion.
 */
import { Link } from 'react-router'
import type { InterviewSetsQuery } from '@/graphql/generated/graphql'
import { SectionCard } from '@/components/SectionCard'
import { DeleteInterviewSetButton } from './DeleteInterviewSetButton'
import { InterviewTaskStatus } from './InterviewTaskStatus'
import { interviewSetDate } from './interviewSetDate'
import { interviewSetTypeLabel } from './interviewSetTypeLabel'

type QuestionSet = InterviewSetsQuery['interviewQuestionSets'][number]

/** "Set 3 · Technical · Oct 29", shared by both lists. */
function setLabel(set: QuestionSet) {
  return `Set ${set.number} · ${interviewSetTypeLabel(set.setType)} · ${interviewSetDate(set.createdAt)}`
}

/** Sets with no questions yet: generation is queued or failed. Shown above the bank. */
export function PendingQuestionSets({ sets, onChanged }: { sets: QuestionSet[]; onChanged: () => unknown }) {
  if (sets.length === 0) return null
  return <ul className="question-pending">
    {sets.map((set) => <li key={set.id}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link className="font-bold underline underline-offset-4" to={`/practice/questions/${set.id}`}>{setLabel(set)}</Link>
        <DeleteInterviewSetButton id={set.id} number={set.number} onDeleted={onChanged} />
      </div>
      {set.latestTask && <InterviewTaskStatus key={set.latestTask.id} task={set.latestTask} onFinished={onChanged} />}
    </li>)}
  </ul>
}

/** Finished sets with answered counts, collapsed by default. */
export function QuestionSetList({ sets, onChanged }: { sets: QuestionSet[]; onChanged: () => unknown }) {
  if (sets.length === 0) return null
  return <SectionCard tone="career_contexts" title="Question sets" badge={<span className="question-filter-count">{sets.length}</span>}
    description="Each time you get new questions they arrive as a set of five." sectionId="interview.sets">
    <ul className="record-list">
      {sets.map((set) => <li key={set.id} className="question-set-row">
        <div className="min-w-0">
          <Link className="font-bold underline underline-offset-4" to={`/practice/questions/${set.id}`}>{setLabel(set)}</Link>
          <p className="question-row-meta">{set.questions.filter((question) => question.answerText.trim()).length} of {set.questions.length} answered</p>
        </div>
        <DeleteInterviewSetButton id={set.id} number={set.number} onDeleted={onChanged} />
      </li>)}
    </ul>
  </SectionCard>
}
