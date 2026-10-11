/**
 * Description: Fetching and mutation state for persistent interview preparation.
 * Index: useInterviewSets, useInterviewSet, useGenerateInterviewSet, useDeleteInterviewSet
 */
import { useState } from 'react'
import { useMutation, useQuery } from '@apollo/client/react'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import { DELETE_INTERVIEW_SET, GENERATE_INTERVIEW_SET, INTERVIEW_SETS_QUERY, INTERVIEW_SET_QUERY } from './interviewPrepOperations'

/** Refreshes the persistent list whenever its page opens. */
export function useInterviewSets() {
  const query = useQuery(INTERVIEW_SETS_QUERY, { fetchPolicy: 'cache-and-network' })
  const sets = query.data?.interviewQuestionSets.slice().sort((a, b) => b.number - a.number)
  return { ...query, sets }
}

/** Loads one set, including its latest persisted task for reload restoration. */
export function useInterviewSet(id: string) {
  const query = useQuery(INTERVIEW_SET_QUERY, { variables: { id }, fetchPolicy: 'cache-and-network' })
  return { ...query, questionSet: query.data?.interviewQuestionSet }
}

/** Generates a set and returns its persistent id; preserves allowance/validation errors. */
export function useGenerateInterviewSet() {
  const [mutate, { loading }] = useMutation(GENERATE_INTERVIEW_SET)
  const [errors, setErrors] = useState<string[]>([])
  /** Queues generation and extracts the server-created set identity. */
  async function generate() {
    setErrors([])
    try {
      const { data } = await mutate()
      const payload = data?.generateInterviewQuestionSet
      if (!payload || payload.errors.length) {
        setErrors(payload?.errors ?? ['Could not start interview questions.'])
        return null
      }
      const input: unknown = payload.aiTask?.input
      if (input && typeof input === 'object' && 'question_set_id' in input && typeof input.question_set_id === 'string') return input.question_set_id
      setErrors(['The new set could not be opened. Refresh the list to find it.'])
    } catch (error) {
      setErrors([requestErrorMessage(error, 'Could not start interview questions.')])
    }
    return null
  }
  return { generate, loading, errors }
}

/** Deletes an explicitly confirmed set and reports errors without hiding it. */
export function useDeleteInterviewSet(id: string) {
  const [mutate, { loading }] = useMutation(DELETE_INTERVIEW_SET)
  const [errors, setErrors] = useState<string[]>([])
  /** Removes the set; the caller owns confirmation and post-success navigation. */
  async function remove() {
    setErrors([])
    try {
      const { data } = await mutate({ variables: { id } })
      const payload = data?.deleteInterviewQuestionSet
      if (!payload || payload.errors.length) {
        setErrors(payload?.errors ?? ['Could not delete this set.'])
        return false
      }
      return true
    } catch (error) {
      setErrors([requestErrorMessage(error, 'Could not delete this set.')])
      return false
    }
  }
  return { remove, loading, errors }
}
