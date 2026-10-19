/** Saves the reviewed complete draft once and keeps save errors visible for retry. */
import { useState } from 'react'
import { useMutation } from '@apollo/client/react'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import { SAVE_TAILORED_RESUME_MUTATION } from './tailorOperations'

/** Persists the selected edited sections without changing the career library. */
export function useTailorActions(aiTaskId: string, onSaved: () => void) {
  const [save] = useMutation(SAVE_TAILORED_RESUME_MUTATION)
  const [errors, setErrors] = useState<string[]>([])
  const [pending, setPending] = useState(false)

  async function saveResume(sections: { section_type: string; title: string; content: unknown }[]) {
    setErrors([])
    setPending(true)
    try {
      const { data } = await save({ variables: { aiTaskId, sections } })
      const payload = data?.saveTailoredResume
      if (payload?.resume && payload.errors.length === 0) {
        onSaved()
        return true
      }
      else setErrors(payload?.errors.length ? payload.errors : ["Couldn't save this resume. Please try again."])
    } catch (error) {
      setErrors([requestErrorMessage(error, "Couldn't save this resume. Check your connection and try again.")])
    } finally {
      setPending(false)
    }
    return false
  }

  return { saveResume, errors, pending }
}
