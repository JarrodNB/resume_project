/** Works out what Home's Practice lane offers: pick up an unfinished interview, move the written
 * question bank along, or practice for a job that is ready for it.
 *
 * Pure functions over data the Practice pages already load. Question progress uses the same steps as
 * the question bank (see interview-prep/questionProgress.ts) so a question reads the same everywhere.
 */
import { questionProgress, type QuestionProgress } from '@/features/interview-prep/questionProgress'
import type { InterviewQuestionBankQuery, RecentInterviewSessionsQuery } from '@/graphql/generated/graphql'
import type { Signal } from './nextSteps'
import type { PipelineEntry } from './homeSummary'

export type BankQuestion = InterviewQuestionBankQuery['interviewQuestions'][number]
export type RecentInterview = RecentInterviewSessionsQuery['recentInterviewSessions'][number]

/** Sessions that can no longer be opened for practice or review. */
const CLOSED_SESSION_STATUSES = ['abandoned', 'expired']

/** The newest interview that was started but not finished, if any. */
export function unfinishedInterview(interviews: RecentInterview[]) {
  return interviews
    .filter((interview) => interview.status !== 'completed' && !CLOSED_SESSION_STATUSES.includes(interview.status))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
}

/** The newest finished interview, if any. */
export function lastCompletedInterview(interviews: RecentInterview[]) {
  return interviews.filter((interview) => interview.status === 'completed').sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
}

/** Saved jobs the user can practice an interview for right now, best-advanced first as Rails ordered them. */
export function jobsReadyForInterview(entries: PipelineEntry[]) {
  return entries.filter((entry) => entry.nextStep === 'PRACTICE_INTERVIEW')
}

export interface QuestionBankStep { label: string; signal: Signal; detail: string }

/** How far the written question bank has come and the one step that moves it forward. Retired copies are ignored. */
export function questionBankStep(questions: BankQuestion[]): QuestionBankStep {
  const active = questions.filter((question) => !question.retiredAt)
  if (active.length === 0) return { label: 'Generate practice questions', signal: 'action', detail: 'No written questions yet.' }
  const counts = new Map<QuestionProgress, number>()
  for (const question of active) {
    const progress = questionProgress(question)
    counts.set(progress, (counts.get(progress) ?? 0) + 1)
  }
  const count = (progress: QuestionProgress) => counts.get(progress) ?? 0
  const answered = active.length - count('unanswered')
  const detail = `${answered} of ${active.length} answered · ${count('reviewed')} with feedback`
  if (count('unanswered') > 0) return { label: 'Answer next question', signal: 'action', detail }
  if (count('answered') > 0) return { label: 'Get feedback', signal: 'action', detail }
  if (count('outdated') > 0) return { label: 'Refresh feedback', signal: 'action', detail }
  if (count('reviewing') > 0) return { label: 'Getting feedback', signal: 'ai', detail }
  return { label: 'Up to date', signal: 'done', detail }
}
