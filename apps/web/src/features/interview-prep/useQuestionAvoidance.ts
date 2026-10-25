/** Save a preference for the selected written question revision without touching its answer. */
import { useRef, useState } from 'react'
import { useMutation } from '@apollo/client/react'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import { AVOID_INTERVIEW_QUESTION } from './interviewPrepOperations'

export function useQuestionAvoidance(questionSetId: string, questionId: string, revision: number, persisted: boolean) {
  const [mutate] = useMutation(AVOID_INTERVIEW_QUESTION)
  const [savedIdentity, setSavedIdentity] = useState('')
  const [pendingIdentity, setPendingIdentity] = useState('')
  const [failure, setFailure] = useState<{ identity: string; messages: string[] } | null>(null)
  const pending = useRef(false)
  const identity = `${questionId}:${revision}`

  async function save() {
    if (pending.current || persisted || savedIdentity === identity) return
    pending.current = true
    setPendingIdentity(identity)
    setFailure(null)
    try {
      const payload = (await mutate({ variables: { questionSetId, questionId, expectedRevision: revision } })).data?.avoidInterviewQuestion
      if (payload?.saved && payload.errors.length === 0) setSavedIdentity(identity)
      else setFailure({ identity, messages: payload?.errors.length ? payload.errors : ['Could not save this preference. Try again.'] })
    } catch (error) {
      setFailure({ identity, messages: [requestErrorMessage(error, 'Could not save this preference. Try again.')] })
    } finally {
      pending.current = false
      setPendingIdentity('')
    }
  }

  return { save, saved: persisted || savedIdentity === identity, saving: pendingIdentity === identity, errors: failure?.identity === identity ? failure.messages : [] }
}
