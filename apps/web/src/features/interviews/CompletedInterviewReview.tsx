/** Presents the saved interview as a read-only record, grouped by core question.
 * It uses retained text only; completion never starts speech or exposes live answer controls.
 */
import { Link } from 'react-router'
import type { InterviewSnapshotFragment } from '@/graphql/generated/graphql'
import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { useOpenSection } from '@/components/useOpenSection'
import './completedInterviewReview.css'
import { difficultyOptions, interviewerOptions, typeOptions } from './interviewSetupOptions'

export function CompletedInterviewReview({ interview }: { interview: InterviewSnapshotFragment }) {
  const role = interview.preparedRole && typeof interview.preparedRole === 'object' && !Array.isArray(interview.preparedRole)
    ? interview.preparedRole as Record<string, unknown> : null
  const answered = (question: InterviewSnapshotFragment['questions'][number]) => question.acceptedAnswerCount > 0 || interview.messages.some((message) => message.questionId === question.id && message.kind === 'answer')
  const answeredCount = interview.questions.filter(answered).length
  const skippedCount = interview.questions.filter((question) => question.skipped && !answered(question)).length
  const followUpsSkipped = interview.questions.filter((question) => question.skipped && answered(question)).length
  return <div className="interview-review grid min-w-0 gap-4">
    <nav aria-label="Review actions" className="flex flex-wrap gap-4"><Link className="text-sm underline underline-offset-4" to="/interviews">Back to interviews</Link>
    <Link className="justify-self-start text-sm underline underline-offset-4" to="/interviews" state={{ practiceSetup: interview.setup }}>Practice again</Link></nav>
    <header className="grid gap-2 border-b pb-4">
      <h2 className="text-2xl font-semibold">Interview complete</h2>
      <p className="max-w-prose text-sm text-muted-foreground">Review your saved questions and answers. Saved text lasts 7 days; this review does not require audio.</p>
      <p className="text-sm">{typeOptions.find((item) => item.value === interview.setup.questionFormat)?.label ?? 'Interview'} · {difficultyOptions.find((item) => item.value === interview.setup.difficulty)?.label ?? interview.setup.difficulty} · {interviewerOptions.find((item) => item.value === interview.setup.interviewer)?.label ?? interview.setup.interviewer} · {interview.questions.length} core questions</p>
    <p className="text-sm">{answeredCount} answered · {skippedCount} skipped without an answer · Remaining follow-ups skipped on {followUpsSkipped} {followUpsSkipped === 1 ? 'question' : 'questions'}</p>
    </header>
    <ReviewSection title="Fictional role" sectionId={`spoken:review:${interview.id}:role`}>
      {typeof role?.title === 'string' ? <div className="grid gap-4 text-sm">
        <h3 className="text-lg font-medium break-words">{role.title}</h3>
        {(['responsibilities', 'requirements'] as const).map((key) => <div key={key} className="grid gap-2">
          <h4 className="font-medium">{key === 'responsibilities' ? 'Responsibilities' : 'Requirements'}</h4>
          <ul className="list-disc space-y-2 pl-5">{Array.isArray(role[key]) && role[key].filter((item): item is string => typeof item === 'string').map((item, index) => <li key={index} className="max-w-prose break-words">{item}</li>)}</ul>
        </div>)}
      </div> : <p className="text-sm text-muted-foreground">Role details were not saved for this interview.</p>}
    </ReviewSection>
    <div className="divide-y border-y" aria-label="Saved questions and answers">
      {interview.questions.toSorted((a, b) => a.position - b.position).map((question) => {
        const dialogue = interview.messages.filter((message) => message.questionId === question.id && ['answer', 'follow_up'].includes(message.kind)).toSorted((a, b) => a.position - b.position)
        const hasAnswers = answered(question)
        return <ReviewSection key={question.id} title={`Core question ${question.position + 1}${question.skipped ? hasAnswers ? ' · Remaining follow-up skipped' : ' · Skipped' : ''}`} description={question.content || 'Question text is unavailable.'} sectionId={`spoken:review:${interview.id}:${question.id}`}>
          <div className="grid gap-3">
            {question.skipped && <p className="text-sm text-muted-foreground">{hasAnswers ? 'Remaining follow-up skipped. Your earlier answers are saved below.' : 'Skipped — no answer was submitted.'}</p>}
            {dialogue.length ? <ol className="review-dialogue grid gap-3">{dialogue.map((message) => <li key={message.id} className="review-message grid gap-1 border-t pt-3 first:border-0 first:pt-0">
              <p className="text-xs font-medium text-muted-foreground">{message.kind === 'answer' ? 'Your answer' : 'Follow-up'}</p>
              <p className="max-w-prose whitespace-pre-wrap break-words text-sm leading-relaxed">{message.content || 'Saved text is unavailable.'}</p>
            </li>)}</ol> : <p className="text-sm text-muted-foreground">No saved answer for this question.</p>}
          </div>
        </ReviewSection>
      })}
      {!interview.questions.length && <p className="text-sm text-muted-foreground">No question history is available for this interview.</p>}
    </div>
  </div>
}

/** Compact disclosure rows keep the question visible while remembering each saved choice. */
function ReviewSection({ title, description, sectionId, children }: {
  title: string
  description?: string
  sectionId: string
  children: ReactNode
}) {
  const { open, toggle, panelId } = useOpenSection(sectionId)
  return <section className="review-section min-w-0">
    <h3>
      <button type="button" aria-label={title} aria-expanded={open} aria-controls={panelId} aria-describedby={description ? `${panelId}-question` : undefined}
        onClick={toggle} className="review-toggle flex w-full min-w-0 items-start gap-3 rounded-md px-2 py-3 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
        <ChevronRight aria-hidden className={`mt-1 size-4 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`} />
        <span className="grid min-w-0 gap-1">
          <span className={description ? 'text-xs font-medium text-muted-foreground' : 'text-sm font-medium'}>{title}</span>
          {description && <span id={`${panelId}-question`} className="break-words text-sm font-medium leading-relaxed">{description}</span>}
        </span>
      </button>
    </h3>
    {open && <div id={panelId} className="review-panel pb-4 pl-9 pr-2">{children}</div>}
  </section>
}
