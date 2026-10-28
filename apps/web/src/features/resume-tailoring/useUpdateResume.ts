/**
 * Description: Saves edits to a stored resume and reports whether the save succeeded.
 * Index:
 *   - useUpdateResume: saveSections, and its errors
 */
import { useState } from 'react'
import { useMutation } from '@apollo/client/react'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import { UPDATE_RESUME_MUTATION } from './tailorOperations'

/** Replaces the content of the resume's sections. */
export function useUpdateResume(resumeId: string) {
  const [update] = useMutation(UPDATE_RESUME_MUTATION)
  const [errors, setErrors] = useState<string[]>([])
  const [pending, setPending] = useState(false)

  async function saveSections(sections: { id: string; content: unknown }[], includeSummary?: boolean) {
    setErrors([])
    setPending(true)
    try {
      const { data } = await update({ variables: { id: resumeId, sections, ...(includeSummary === undefined ? {} : { includeSummary }) } })
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

  return { saveSections, errors, pending }
}
