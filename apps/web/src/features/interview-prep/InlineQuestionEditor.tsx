/** Loads the existing answer editor inside the question bank, including its saved drafts and coaching. */
import { useCallback } from 'react'
import { useApolloClient } from '@apollo/client/react'
import { ContentSkeleton } from '@/components/ContentSkeleton'
import { ErrorAlert } from '@/components/ErrorAlert'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import { InterviewQuestionCard } from './InterviewQuestionCard'
import { INTERVIEW_QUESTION_BANK_QUERY, INTERVIEW_SETS_QUERY } from './interviewPrepOperations'
import { useInterviewSet } from './useInterviewPrep'

export function InlineQuestionEditor({ setId, questionId, onDirty, onDeleted }: {
  setId: string; questionId: string; onDirty: (id: string, dirty: boolean) => void; onDeleted: () => void
}) {
  const { questionSet, loading, error, refetch } = useInterviewSet(setId)
  const client = useApolloClient()
  const refresh = useCallback(() => Promise.all([
    refetch(), client.refetchQueries({ include: [INTERVIEW_QUESTION_BANK_QUERY, INTERVIEW_SETS_QUERY] }),
  ]), [refetch, client])
  const question = questionSet?.questions.find((item) => item.id === questionId)
  return <>
    {error && <ErrorAlert title="Couldn't load this question" messages={[requestErrorMessage(error, error.message)]} />}
    {!questionSet && loading && <ContentSkeleton label="Loading answer editor…" layout="detail" />}
    {question && <InterviewQuestionCard key={question.id} question={question} setId={setId}
      manual={questionSet?.origin === 'manual'} refetch={refresh} onDirty={onDirty} onDeleted={onDeleted} />}
  </>
}
