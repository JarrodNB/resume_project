/** Deletes one question, retaining the draft and showing retryable errors on failure. */
import { useState } from 'react'
import { useMutation } from '@apollo/client/react'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import { DELETE_INTERVIEW_QUESTION } from './interviewPrepOperations'

export function useDeleteQuestion(questionSetId: string, questionId: string) {
  const [mutate, { loading, client }] = useMutation(DELETE_INTERVIEW_QUESTION)
  const [errors, setErrors] = useState<string[]>([])
  async function remove() {
    setErrors([])
    try {
      const payload = (await mutate({ variables: { questionSetId, questionId } })).data?.deleteInterviewQuestion
      if (!payload || payload.errors.length) {
        setErrors(payload?.errors ?? ['Could not delete this question. Try again.'])
        return false
      }
      client.cache.evict({ id: client.cache.identify({ __typename: 'InterviewQuestion', id: questionId }) })
      return true
    } catch (error) {
      setErrors([requestErrorMessage(error, 'Could not delete this question. Try again.')])
      return false
    }
  }
  return { remove, loading, errors }
}
