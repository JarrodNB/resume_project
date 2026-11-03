/**
 * Description: The written practice home: a bank of every interview question and your answer to it.
 * The bank shows every question together with its progress.
 * Answers from replaced questions are kept in their own section. Spoken practice lives elsewhere.
 */
import { ContentSkeleton } from '@/components/ContentSkeleton'
import { useCallback } from 'react'
import { PageHeading } from '@/components/PageHeading'
import { ErrorAlert } from '@/components/ErrorAlert'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import { GenerateQuestionSet } from './GenerateQuestionSet'
import { QuestionBankList } from './QuestionBankList'
import { PendingQuestionGeneration } from './PendingQuestionGeneration'
import { RetiredQuestions } from './RetiredQuestions'
import { useInterviewSets, useQuestionBank } from './useInterviewPrep'

/** Generation, the question bank, and replaced answers on one page. */
export function InterviewPrepPage() {
  const bank = useQuestionBank()
  const { sets, error: setsError, refetch: refetchSets } = useInterviewSets()
  const { refetch: refetchBank } = bank
  const refresh = useCallback(() => Promise.all([refetchSets(), refetchBank()]), [refetchSets, refetchBank])
  const pending = sets?.filter((set) => set.questions.length === 0) ?? []

  return <div className="question-bank-page">
    <PageHeading title="Practice questions" description="Write answers to interview questions drawn from your career library, get coaching, and keep improving them here." />
    <GenerateQuestionSet />
    <PendingQuestionGeneration sets={pending} onChanged={refresh} />
    {bank.error && <ErrorAlert title="Couldn't load your questions" messages={[requestErrorMessage(bank.error, bank.error.message)]} />}
    {setsError && <ErrorAlert title="Couldn't check question generation" messages={[requestErrorMessage(setsError, setsError.message)]} />}
    {!bank.questions && bank.loading && <ContentSkeleton label="Loading your questions…" />}
    {bank.questions?.length === 0 && pending.length === 0 && <div className="empty-records">
      <h2>No questions yet</h2>
      <p>Pick a question type above and get your first five. Questions come from your career library, so the more detail it holds, the more specific they get. Your answers and feedback will collect here.</p>
    </div>}
    {bank.questions && bank.questions.length > 0 && <QuestionBankList questions={bank.questions} />}
    <div className="library-sections">
      <RetiredQuestions questions={bank.retired ?? []} />
    </div>
  </div>
}
