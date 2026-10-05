/**
 * Description: Submits one tailored section, or saves the finished draft as a resume.
 * Index:
 *   - useTailorActions: submitSection, saveResume, and their errors
 */
import { useState } from 'react'
import { useMutation } from '@apollo/client/react'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import { SAVE_TAILORED_RESUME_MUTATION, SUBMIT_TAILORED_SECTION_MUTATION } from './tailorOperations'
import type { TailorSectionType } from './sectionOrder'

/** Approve, omit, write anyway, or reopen one section, and save the finished resume. */
export function useTailorActions(aiTaskId: string, onSaved: () => void) {
  const [submit] = useMutation(SUBMIT_TAILORED_SECTION_MUTATION)
  const [save] = useMutation(SAVE_TAILORED_RESUME_MUTATION)
  const [errors, setErrors] = useState<string[]>([])
  const [pending, setPending] = useState(false)

  async function submitSection(sectionType: TailorSectionType, action: string, content: Record<string, unknown>) {
    setErrors([])
    setPending(true)
    try {
      const { data } = await submit({ variables: { aiTaskId, sectionType, action, content } })
      const payload = data?.submitTailoredSection
      if (payload && payload.errors.length > 0) setErrors(payload.errors)
    } catch (error) {
      setErrors([requestErrorMessage(error, "Couldn't save this section. Check your connection and try again.")])
    } finally {
      setPending(false)
    }
  }

  async function saveResume(sections: { section_type: string; title: string; content: unknown }[]) {
    setErrors([])
    setPending(true)
    try {
      const { data } = await save({ variables: { aiTaskId, sections } })
      const payload = data?.saveTailoredResume
      if (payload?.resume && payload.errors.length === 0) onSaved()
      else setErrors(payload?.errors.length ? payload.errors : ["Couldn't save this resume. Please try again."])
    } catch (error) {
      setErrors([requestErrorMessage(error, "Couldn't save this resume. Check your connection and try again.")])
    } finally {
      setPending(false)
    }
  }

  return { submitSection, saveResume, errors, pending }
}
