/** Save only the selected persisted prompt; changing prompts cannot transfer pending success. */
import { useRef, useState } from 'react'
import { useMutation } from '@apollo/client/react'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import { AVOID_INTERVIEW_PROMPT } from './interviewOperations'

export function useAvoidedInterviewPrompt(interviewId: string, messageId: string, persisted: boolean) {
  const [mutate] = useMutation(AVOID_INTERVIEW_PROMPT)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const pending = useRef(false)
  async function save() {
    if (pending.current || persisted || saved) return
    pending.current = true
    setSaving(true)
    setErrors([])
    try {
      const payload = (await mutate({ variables: { interviewId, messageId } })).data?.avoidInterviewPrompt
      if (payload?.saved && payload.errors.length === 0) setSaved(true)
      else setErrors(payload?.errors.length ? payload.errors : ['Could not save this preference. Try again.'])
    } catch (error) {
      setErrors([requestErrorMessage(error, 'Could not save this preference. Try again.')])
    } finally {
      pending.current = false
      setSaving(false)
    }
  }
  return { save, saved: persisted || saved, saving, errors }
}
