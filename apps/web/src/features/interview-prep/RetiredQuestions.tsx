/**
 * Description: Answers kept from questions that were replaced, so written work is never lost.
 * These copies are read-only: they keep the old question, answer, and any feedback as they were.
 */
import type { InterviewQuestionBankQuery } from '@/graphql/generated/graphql'
import { SectionCard } from '@/components/SectionCard'
import { InterviewFeedback } from './InterviewFeedback'
import { interviewSetDate } from './interviewSetDate'
import { hasFeedback } from './questionProgress'

type BankQuestion = InterviewQuestionBankQuery['interviewQuestions'][number]

/** Collapsed section listing replaced questions; each one opens to show its saved answer. */
export function RetiredQuestions({ questions }: { questions: BankQuestion[] }) {
  if (questions.length === 0) return null
  return <SectionCard tone="career_contexts" title="Answers from replaced questions" badge={<span className="question-filter-count">{questions.length}</span>}
    description="When you replace a question you already answered, your answer is kept here." sectionId="interview.retired">
    <ul className="record-list">
      {questions.map((question) => <li key={question.id}>
        <details className="retired-question">
          <summary>
            <span className="question-row-title">{question.questionText}</span>
            <span className="question-row-meta">Set {question.questionSet.number} · replaced {interviewSetDate(question.retiredAt ?? question.questionSet.createdAt)}</span>
          </summary>
          <div className="retired-question-body">
            <div className="grid min-w-0 content-start gap-2">
              <h3 className="text-sm font-bold">Your answer</h3>
              <p className="whitespace-pre-wrap break-words">{question.answerText}</p>
            </div>
            {hasFeedback(question.feedback) && <InterviewFeedback feedback={question.feedback} outdated={question.feedbackOutdated} />}
          </div>
        </details>
      </li>)}
    </ul>
  </SectionCard>
}
