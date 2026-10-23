/**
 * Description: Saves edits to a stored resume and reports whether the save succeeded.
 * Index:
 *   - useUpdateResume: saveMarkdown, and its errors
 */
import { useState } from 'react'
import { useMutation } from '@apollo/client/react'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import { UPDATE_RESUME_MUTATION } from './tailorOperations'

/** Replaces the saved Markdown. */
export function useUpdateResume(resumeId: string) {
  const [update] = useMutation(UPDATE_RESUME_MUTATION)
  const [errors, setErrors] = useState<string[]>([])
  const [pending, setPending] = useState(false)

  async function saveMarkdown(markdown: string) {
    setErrors([])
    setPending(true)
    try {
      const { data } = await update({ variables: { id: resumeId, markdown } })
      const payload = data?.updateResume
      if (payload?.resume && payload.errors.length === 0) return true
      setErrors(payload?.errors.length ? payload.errors : ["Couldn't save this resume. Please try again."])
    } catch (error) {
      setErrors([requestErrorMessage(error, "Couldn't save this resume. Check your connection and try again.")])
    } finally {
      setPending(false)
    }
    return false
  }

  return { saveMarkdown, errors, pending }
}
