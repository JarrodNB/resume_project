/** Presents the saved interview as a read-only record, grouped by core question.
 * It uses retained text only; completion never starts speech or exposes live answer controls.
 */
import { Link } from 'react-router'
import type { InterviewSnapshotFragment } from '@/graphql/generated/graphql'
import { SectionCard } from '@/components/SectionCard'
import { difficultyOptions, interviewerOptions, typeOptions } from './interviewSetupOptions'

export function CompletedInterviewReview({ interview }: { interview: InterviewSnapshotFragment }) {
  const role = interview.preparedRole && typeof interview.preparedRole === 'object' && !Array.isArray(interview.preparedRole)
    ? interview.preparedRole as Record<string, unknown> : null
  const closing = interview.messages.filter((message) => message.kind === 'closing')
  return <div className="grid min-w-0 gap-6">
    <Link className="justify-self-start text-sm underline underline-offset-4" to="/interviews">Back to interviews</Link>
    <header className="grid gap-2">
      <h2 className="text-2xl font-semibold">Interview complete</h2>
      <p className="max-w-prose text-sm text-muted-foreground">Review your saved questions and answers. Saved text lasts 7 days; this review does not require audio.</p>
      <p className="text-sm">{typeOptions.find((item) => item.value === interview.setup.questionFormat)?.label ?? 'Interview'} · {difficultyOptions.find((item) => item.value === interview.setup.difficulty)?.label ?? interview.setup.difficulty} · {interviewerOptions.find((item) => item.value === interview.setup.interviewer)?.label ?? interview.setup.interviewer} · {interview.questions.length} core questions</p>
    </header>
    <SectionCard title="Fictional role" tone="facts" sectionId={`spoken:review:${interview.id}:role`}>
      {typeof role?.title === 'string' ? <div className="grid gap-4 text-sm">
        <h3 className="text-lg font-medium break-words">{role.title}</h3>
        {(['responsibilities', 'requirements'] as const).map((key) => <div key={key} className="grid gap-2">
          <h4 className="font-medium">{key === 'responsibilities' ? 'Responsibilities' : 'Requirements'}</h4>
          <ul className="list-disc space-y-2 pl-5">{Array.isArray(role[key]) && role[key].filter((item): item is string => typeof item === 'string').map((item, index) => <li key={index} className="max-w-prose break-words">{item}</li>)}</ul>
        </div>)}
      </div> : <p className="text-sm text-muted-foreground">Role details were not saved for this interview.</p>}
    </SectionCard>
    <div className="grid gap-3" aria-label="Saved questions and answers">
      {interview.questions.toSorted((a, b) => a.position - b.position).map((question) => {
        const dialogue = interview.messages.filter((message) => message.questionId === question.id && ['answer', 'follow_up'].includes(message.kind)).toSorted((a, b) => a.position - b.position)
        const hasAnswers = question.acceptedAnswerCount > 0 || dialogue.some((message) => message.kind === 'answer')
        return <SectionCard key={question.id} title={`Core question ${question.position + 1}${question.skipped ? hasAnswers ? ' · Remaining follow-up skipped' : ' · Skipped' : ''}`} description={question.content || 'Question text is unavailable.'} tone="facts" sectionId={`spoken:review:${interview.id}:${question.id}`}>
          <div className="grid gap-4">
            {question.skipped && <p className="text-sm text-muted-foreground">{hasAnswers ? 'Remaining follow-up skipped. Your earlier answers are saved below.' : 'Skipped — no answer was submitted.'}</p>}
            {dialogue.length ? <ol className="grid gap-4">{dialogue.map((message) => <li key={message.id} className="grid gap-2 border-t pt-4 first:border-0 first:pt-0">
              <p className="text-sm font-medium">{message.kind === 'answer' ? 'Your answer' : 'Follow-up'}</p>
              <p className="max-w-prose whitespace-pre-wrap break-words text-sm leading-relaxed">{message.content || 'Saved text is unavailable.'}</p>
            </li>)}</ol> : <p className="text-sm text-muted-foreground">No saved answer for this question.</p>}
          </div>
        </SectionCard>
      })}
      {!interview.questions.length && <p className="text-sm text-muted-foreground">No question history is available for this interview.</p>}
    </div>
    {closing.map((message) => <p key={message.id} className="max-w-prose whitespace-pre-wrap break-words text-sm leading-relaxed">{message.content}</p>)}
  </div>
}
