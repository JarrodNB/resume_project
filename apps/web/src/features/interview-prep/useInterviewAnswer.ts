/**
 * Description: Explicit answer saving and queued feedback/replacement mutation state.
 * Index: useInterviewAnswer
 */
import { useState } from 'react'
import { useMutation } from '@apollo/client/react'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import { SAVE_INTERVIEW_ANSWER, REQUEST_INTERVIEW_FEEDBACK, REGENERATE_INTERVIEW_QUESTION } from './interviewPrepOperations'

/** Runs question operations and retains actionable server/network errors. */
export function useInterviewAnswer(questionSetId: string, questionId: string) {
  const [saveMutation] = useMutation(SAVE_INTERVIEW_ANSWER)
  const [feedbackMutation] = useMutation(REQUEST_INTERVIEW_FEEDBACK)
  const [replaceMutation] = useMutation(REGENERATE_INTERVIEW_QUESTION)
  const [busy, setBusy] = useState('')
  const [errors, setErrors] = useState<string[]>([])
  /** Executes one operation; feedback can persist the answer even when queueing fails. */
  async function run(operation: 'save' | 'feedback' | 'replace', answerText: string) {
    setBusy(operation)
    setErrors([])
    try {
      const variables = { questionSetId, questionId, answerText }
      const payload = operation === 'save'
        ? (await saveMutation({ variables })).data?.saveInterviewAnswer
        : operation === 'feedback'
          ? (await feedbackMutation({ variables })).data?.requestInterviewAnswerFeedback
          : (await replaceMutation({ variables: { questionSetId, questionId, confirmed: true } })).data?.regenerateInterviewQuestion
      const messages = payload?.errors ?? ['Could not complete this action.']
      setErrors(messages)
      return { ok: messages.length === 0, task: payload && 'aiTask' in payload ? payload.aiTask : null }
    } catch (error) {
      setErrors([requestErrorMessage(error, 'Could not complete this action. Try again.')])
      return { ok: false, task: null }
    } finally { setBusy('') }
  }
  return { run, busy, errors }
}
