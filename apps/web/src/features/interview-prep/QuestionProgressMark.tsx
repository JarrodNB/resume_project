/**
 * Description: The small stop or signal dot that shows a question's progress.
 * Hollow gray means not answered, filled ink means answered, ringed ink means feedback is ready.
 * Blue (AI working) and red (needs you: out-of-date feedback) follow the app's signal rules.
 */
import type { QuestionProgress } from './questionProgress'

const MARK_CLASS: Record<QuestionProgress, string> = {
  unanswered: 'stop',
  answered: 'stop is-done',
  reviewed: 'stop is-now',
  reviewing: 'signal-dot is-ai',
  outdated: 'signal-dot is-action',
}

/** Decorative mark; callers always show or announce the matching label beside it. */
export function QuestionProgressMark({ progress }: { progress: QuestionProgress }) {
  return <span aria-hidden="true" className={`question-mark ${MARK_CLASS[progress]}`} data-progress={progress} />
}
