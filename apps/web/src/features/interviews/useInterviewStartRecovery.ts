/** Read the actual start blocker and resolve it only through explicit user actions.
 * Failed starts trigger a fresh owned read; this hook never retries preparation writes.
 */
import { useRef, useState } from 'react'
import { useMutation, useQuery } from '@apollo/client/react'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import { ABANDON_UNFINISHED_INTERVIEW, UNFINISHED_INTERVIEW } from './interviewOperations'

export function useInterviewStartRecovery(enabled: boolean) {
  const query = useQuery(UNFINISHED_INTERVIEW, { skip: !enabled, fetchPolicy: 'network-only' })
  const [mutate, mutation] = useMutation(ABANDON_UNFINISHED_INTERVIEW)
  const [actionError, setActionError] = useState<string | null>(null)
  const abandoning = useRef(false)
  const saved = query.data?.unfinishedInterviewSession
  const interview = saved && ['preparing', 'ready', 'active'].includes(saved.status) ? saved : null
  const checking = enabled && query.loading
  const readError = query.error ? requestErrorMessage(query.error, 'Could not check your saved interviews. Try again before preparing.') : null
  const checked = !enabled || Boolean(query.data && !query.error)

  async function refresh() {
    if (!enabled) return
    setActionError(null)
    try { await query.refetch() }
    catch { /* The query error keeps preparation disabled until a successful explicit check. */ }
  }

  async function abandon() {
    if (!interview || abandoning.current) return false
    abandoning.current = true
    setActionError(null)
    try {
      const payload = (await mutate({ variables: { interviewId: interview.id } })).data?.abandonInterview
      if (!payload || payload.errors.length || payload.interview?.status !== 'abandoned') {
        throw new Error(payload?.errors.join(' ') || 'No saved cancellation was received. Check saved interviews before trying again.')
      }
      await refresh()
      return true
    } catch (cause) {
      setActionError(requestErrorMessage(cause, 'Could not end the unfinished interview. Check saved interviews before trying again.'))
      return false
    } finally { abandoning.current = false }
  }

  return { interview, checking, error: readError ?? actionError, busy: mutation.loading,
    canPrepare: checked && !checking && !interview && !mutation.loading, refresh, abandon }
}
