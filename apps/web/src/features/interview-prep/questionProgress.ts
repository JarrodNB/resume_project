/**
 * Description: Works out how far along a practice question is, from its saved answer and feedback.
 * The question bank list and a set's question line all use these same steps,
 * so a question reads the same everywhere. Uses the server's saved-state decision, not unsaved drafts.
 */
import type { InterviewQuestionProgressEnum } from '@/graphql/generated/graphql'

export type QuestionProgress = 'unanswered' | 'answered' | 'reviewing' | 'reviewed' | 'outdated'

interface ProgressSource {
  progress: InterviewQuestionProgressEnum
}

export const PROGRESS_LABELS: Record<QuestionProgress, string> = {
  unanswered: 'Not answered',
  answered: 'No feedback yet',
  reviewing: 'Getting feedback',
  reviewed: 'Feedback ready',
  outdated: 'Feedback out of date',
}

/** True when saved coaching has something to show; empty `{}` means no feedback yet. */
export function hasFeedback(feedback: unknown) {
  if (!feedback || typeof feedback !== 'object') return false
  const value = feedback as Record<string, unknown>
  return (Array.isArray(value.strengths) && value.strengths.length > 0) ||
    (Array.isArray(value.improvements) && value.improvements.length > 0) || typeof value.example_answer === 'string'
}

/** Reads the server's decision (Rails InterviewPrep::ActiveAnswer.progress); nothing is re-derived here. */
export function questionProgress(question: ProgressSource): QuestionProgress {
  return question.progress.toLowerCase() as QuestionProgress
}
