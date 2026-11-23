/**
 * Description: The small stop or signal dot that shows a question's progress.
 * Hollow gray means not answered, filled ink means answered, ringed ink means feedback is ready.
 * Blue means AI is working. Older optional feedback keeps the normal answered marker.
 */
import type { QuestionProgress } from './questionProgress'

const MARK_CLASS: Record<QuestionProgress, string> = {
  unanswered: 'stop',
  answered: 'stop is-done',
  reviewed: 'stop is-now',
  reviewing: 'signal-dot is-ai',
  outdated: 'stop is-done',
}

/** Decorative mark; callers always show or announce the matching label beside it. */
export function QuestionProgressMark({ progress }: { progress: QuestionProgress }) {
  return <span aria-hidden="true" className={`question-mark ${MARK_CLASS[progress]}`} data-progress={progress} />
}
