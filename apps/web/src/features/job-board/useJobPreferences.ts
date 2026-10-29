/** Load and explicitly save an owner's versioned preferences; no model work runs here. */
import { useRef, useState } from 'react'
import { useApolloClient, useQuery } from '@apollo/client/react'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import type { JobPreferenceCriterionInput } from '@/graphql/generated/graphql'
import { CLEAR_JOB_PREFERENCES, CONFIRM_JOB_PREFERENCES, JOB_PREFERENCES_QUERY, SAVE_JOB_PREFERENCE_DRAFT } from './jobPreferenceOperations'

export function useJobPreferences() {
  const client = useApolloClient()
  const query = useQuery(JOB_PREFERENCES_QUERY, { fetchPolicy: 'network-only' })
  const lock = useRef(false)
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<string[]>([])

  async function update(action: 'save' | 'confirm' | 'clear', criteria: JobPreferenceCriterionInput[] = []) {
    const profile = query.data?.jobPreferences
    if (!profile || lock.current) return
    lock.current = true
    setBusy(true)
    setErrors([])
    try {
      const variables = { expectedVersion: profile.version }
      const payload = action === 'save'
        ? (await client.mutate({ mutation: SAVE_JOB_PREFERENCE_DRAFT, variables: { ...variables, criteria } })).data?.saveJobPreferenceDraft
        : action === 'confirm'
          ? (await client.mutate({ mutation: CONFIRM_JOB_PREFERENCES, variables })).data?.confirmJobPreferences
          : (await client.mutate({ mutation: CLEAR_JOB_PREFERENCES, variables })).data?.clearJobPreferences
      if (!payload?.profile || payload.errors.length) {
        setErrors(payload?.errors.length ? payload.errors : ['Could not update preferences. Please try again.'])
        return
      }
      client.writeQuery({ query: JOB_PREFERENCES_QUERY, data: { jobPreferences: payload.profile } })
    } catch (error) {
      setErrors([requestErrorMessage(error, 'Could not update preferences. Please try again.')])
    } finally {
      lock.current = false
      setBusy(false)
    }
  }

  async function reload() {
    if (lock.current) return
    setErrors([])
    try { await query.refetch() } catch { /* useQuery exposes the read error below. */ }
  }

  return { profile: query.data?.jobPreferences, loading: query.loading, busy, update, reload,
    errors: query.error ? [requestErrorMessage(query.error, 'Could not load preferences. Please try again.'), ...errors] : errors }
}
