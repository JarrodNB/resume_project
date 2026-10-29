/**
 * Description: Works out how far along a practice question is, from its saved answer and feedback.
 * The question bank list, its filters, and a set's question line all use these same steps,
 * so a question reads the same everywhere. Uses saved server state, not unsaved drafts.
 */

export type QuestionProgress = 'unanswered' | 'answered' | 'reviewing' | 'reviewed' | 'outdated'
export type QuestionFilter = 'all' | 'todo' | 'feedback' | 'ready'

interface ProgressSource {
  answerText: string
  feedback: unknown
  feedbackOutdated: boolean
  latestTask?: { status: string; taskType: string } | null
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

/** Places one saved question on its answer → feedback line. */
export function questionProgress(question: ProgressSource): QuestionProgress {
  if (question.latestTask?.status === 'QUEUED' && question.latestTask.taskType === 'REVIEW_INTERVIEW_ANSWER') return 'reviewing'
  if (!question.answerText.trim()) return 'unanswered'
  if (!hasFeedback(question.feedback)) return 'answered'
  return question.feedbackOutdated ? 'outdated' : 'reviewed'
}

/** Groups progress into the bank's filters: still to write, waiting on feedback, or ready to rehearse. */
export function matchesFilter(progress: QuestionProgress, filter: QuestionFilter) {
  if (filter === 'all') return true
  if (filter === 'todo') return progress === 'unanswered'
  if (filter === 'ready') return progress === 'reviewed'
  return progress === 'answered' || progress === 'reviewing' || progress === 'outdated'
}
