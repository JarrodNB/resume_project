/** Follows the resume report even while scheduling has not created an AI task.
 * Reruns use saved server input and report failures separately from saving. */
import { useRef, useState } from 'react'
import { useMutation, useQuery, useSubscription } from '@apollo/client/react'
import type { AtsReportFieldsFragment } from '@/graphql/generated/graphql'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import { ATS_REPORT_QUERY, ATS_REPORT_UPDATED_SUBSCRIPTION, RERUN_ATS_CHECK_MUTATION } from './atsOperations'

export function useAtsReport(resumeId: string) {
  const query = useQuery(ATS_REPORT_QUERY, { variables: { id: resumeId }, fetchPolicy: 'network-only' })
  const [latest, setLatest] = useState<AtsReportFieldsFragment | null>(null)
  const latestRef = useRef<AtsReportFieldsFragment | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const [pending, setPending] = useState(false)
  const [stale, setStale] = useState(false)
  const inFlight = useRef(false)
  const eventCount = useRef(0)
  const [rerunMutation] = useMutation(RERUN_ATS_CHECK_MUTATION)

  function receive(report: AtsReportFieldsFragment | null) {
    if (report && latestRef.current && report.createdAt < latestRef.current.createdAt) return
    latestRef.current = report
    setLatest(report)
    setStale(false)
  }
  const subscription = useSubscription(ATS_REPORT_UPDATED_SUBSCRIPTION, {
    variables: { resumeId },
    onData: ({ data }) => {
      if (data.data?.atsReportUpdated) {
        eventCount.current += 1
        receive(data.data.atsReportUpdated)
      }
    },
  })

  async function refresh() {
    const before = eventCount.current
    setStale(true)
    try {
      const result = await query.refetch()
      const refreshed = result.data?.resume?.atsReport ?? null
      if (before === eventCount.current || refreshed?.runId !== latestRef.current?.runId) {
        receive(refreshed)
      }
    } catch (error) { setErrors([requestErrorMessage(error, "Couldn't refresh the ATS report. Please retry.")]) }
  }

  async function rerun() {
    if (inFlight.current) return
    inFlight.current = true
    setPending(true)
    setErrors([])
    const before = eventCount.current
    try {
      const { data } = await rerunMutation({ variables: { resumeId } })
      const payload = data?.rerunResumeAtsCheck
      if (payload?.errors.length || !payload?.report) setErrors(payload?.errors.length ? payload.errors : ["Couldn't start the check. Please retry."])
      else if (before === eventCount.current || payload.report.runId !== latestRef.current?.runId) receive(payload.report)
    } catch (error) { setErrors([requestErrorMessage(error, "Couldn't start the check. Please retry.")]) }
    finally { inFlight.current = false; setPending(false) }
  }

  const connectionErrors = [query.error, subscription.error].flatMap((error) => error ? [requestErrorMessage(error, "Couldn't follow the ATS report. Reload to reconnect.")] : [])
  const queried = query.data?.resume?.atsReport
  const report = latest && (!queried || latest.createdAt >= queried.createdAt) ? latest : queried ?? null
  const visible = report && stale ? {
    ...report, outdated: true,
    jobAlignment: { ...report.jobAlignment, status: report.jobAlignment.status === 'unavailable' ? 'unavailable' : 'outdated' },
    contentQuality: { ...report.contentQuality, status: 'outdated' },
    pdfReadability: { ...report.pdfReadability, status: report.pdfReadability.status === 'awaiting_export' ? 'awaiting_export' : 'outdated' },
  } : report
  return { report: visible, errors: [...errors, ...connectionErrors], pending, rerun, refresh }
}
