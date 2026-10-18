/** Delete an owned resume and remove its cached links without refetching the removed page. */
import { useRef, useState } from 'react'
import type { Reference } from '@apollo/client'
import { useMutation } from '@apollo/client/react'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import { DELETE_RESUME_MUTATION } from './resumesOperations'

export function useDeleteResume(resumeId: string, jobId?: string) {
  const [mutate] = useMutation(DELETE_RESUME_MUTATION)
  const busy = useRef(false)
  const [pending, setPending] = useState(false)
  const [errors, setErrors] = useState<string[]>([])

  async function deleteResume() {
    if (busy.current) return false
    busy.current = true
    setPending(true)
    setErrors([])
    try {
      const { data } = await mutate({
        variables: { id: resumeId },
        update(cache, { data: result }) {
          if (!result?.deleteResume?.resume || result.deleteResume.errors.length) return
          if (jobId) cache.modify({ id: cache.identify({ __typename: 'Job', id: jobId }), fields: { resume: () => null } })
          cache.modify({ fields: {
            resumes(existing: readonly Reference[] = [], { readField }) { return existing.filter((entry) => readField('id', entry) !== resumeId) },
            resume(existing, { readField }) { return existing && readField('id', existing) === resumeId ? null : existing },
          } })
          cache.evict({ id: cache.identify({ __typename: 'Resume', id: resumeId }) })
          cache.gc()
        },
      })
      const payload = data?.deleteResume
      if (payload?.resume && !payload.errors.length) return true
      setErrors(payload?.errors.length ? payload.errors : ["Couldn't delete this resume. Please try again."])
    } catch (error) {
      setErrors([requestErrorMessage(error, "Couldn't delete this resume. Check your connection and try again.")])
    } finally {
      busy.current = false
      setPending(false)
    }
    return false
  }
  return { deleteResume, pending, errors }
}
