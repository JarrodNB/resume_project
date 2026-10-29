/**
 * Description: A set's five questions drawn as stops on one line, like a short transit route.
 * Each stop links to its question and shows saved progress; the open question is marked current.
 */
import { Link } from 'react-router'
import type { InterviewSetQuery } from '@/graphql/generated/graphql'
import { PROGRESS_LABELS, questionProgress } from './questionProgress'
import { QuestionProgressMark } from './QuestionProgressMark'

type Question = InterviewSetQuery['interviewQuestionSet']['questions'][number]

/** Ordered question stops; the active one carries aria-current. */
export function QuestionLine({ setId, questions, activeId }: { setId: string; questions: Question[]; activeId: string }) {
  return <nav aria-label="Questions in this set">
    <ol className="question-line">
      {questions.map((question, index) => {
        const progress = questionProgress(question)
        return <li key={question.id}>
          <Link to={`/practice/questions/${setId}/${question.id}`} aria-current={question.id === activeId ? 'step' : undefined}
            aria-label={`Question ${index + 1}, ${PROGRESS_LABELS[progress]}`}>
            <QuestionProgressMark progress={progress} />
            <span className="question-line-label"><span className="question-line-word">Question </span>{index + 1}</span>
            <span className="question-line-status">{PROGRESS_LABELS[progress]}</span>
          </Link>
        </li>
      })}
    </ol>
  </nav>
}
