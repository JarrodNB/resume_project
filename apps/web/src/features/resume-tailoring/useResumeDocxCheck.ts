/** Retain one current Word export so the server checks the bytes users download.
 * Checks start on explicit preview/export actions. Edits discard the old count and stop
 * polling; checking failures never discard an already generated downloadable document.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useApolloClient } from '@apollo/client/react'
import { START_DOCX_CHECK, DOCX_CHECK } from './docxCheckOperations'
import type { ResumePdfModel } from './resumePdfModel'

type State = { status: 'idle' | 'checking' | 'completed' | 'unavailable'; pageCount?: number }
type Check = { id: string; status: string; contentDigest: string; pageCount?: number | null; expiresAt: string }
type Artifact = { token: object; blob?: Promise<Blob>; checking: boolean; attempted?: boolean; timer?: number; stopped: boolean }

export function useResumeDocxCheck(snapshot: string, resumeId?: string) {
  const client = useApolloClient()
  const key = `${resumeId ?? ''}:${snapshot}`
  const token = useMemo(() => ({ key }), [key])
  const current = useRef<Artifact | null>(null)
  const [reported, setReported] = useState<{ token: object; state: State } | null>(null)
  useEffect(() => {
    const artifact: Artifact = { token, checking: false, stopped: false }
    current.current = artifact
    return () => { artifact.stopped = true; window.clearTimeout(artifact.timer) }
  }, [token])

  function report(artifact: Artifact, state: State) {
    if (!artifact.stopped) setReported({ token: artifact.token, state })
  }
  async function check(artifact: Artifact, blob: Blob, retryFailed: boolean) {
    try {
      const bytes = await blob.arrayBuffer()
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) => byte.toString(16).padStart(2, '0')).join('')
      if (artifact.stopped) return
      const response = await client.mutate({ mutation: START_DOCX_CHECK, variables: { file: blob as File, contentDigest: digest, retryFailed, ...(resumeId ? { resumeId } : {}) } })
      const payload = response.data?.startResumeDocxPageCheck
      if (!payload?.check || payload.errors.length) throw new Error('Check unavailable')
      const accept = (result: Check) => {
        if (artifact.stopped) return
        const remaining = Date.parse(result.expiresAt) - Date.now()
        if (result.contentDigest !== digest || !(remaining > 0)) throw new Error('Outdated check')
        if (result.status === 'completed' && result.pageCount && result.pageCount > 0) {
          artifact.checking = false
          report(artifact, { status: 'completed', pageCount: result.pageCount })
          artifact.timer = window.setTimeout(() => report(artifact, { status: 'unavailable' }), Math.min(remaining, 2_147_483_647))
        } else if (result.status === 'queued' || result.status === 'running') {
          artifact.timer = window.setTimeout(() => { void poll(result.id) }, Math.min(1500, remaining))
        } else throw new Error('Check failed')
      }
      const poll = async (id: string) => {
        if (artifact.stopped) return
        try {
          const response = await client.query({ query: DOCX_CHECK, variables: { id }, fetchPolicy: 'no-cache' })
          const result = response.data?.resumeDocxPageCheck
          if (!result || result.id !== id) throw new Error('Check unavailable')
          accept(result)
        } catch { artifact.checking = false; report(artifact, { status: 'unavailable' }) }
      }
      accept(payload.check)
    } catch { artifact.checking = false; report(artifact, { status: 'unavailable' }) }
  }
  async function prepare(retryFailed = false): Promise<Blob> {
    const artifact = current.current
    if (!artifact || artifact.token !== token) throw new Error('Snapshot unavailable')
    if (!artifact.blob) {
      report(artifact, { status: 'checking' })
      artifact.blob = import('./resumeDocxDocument').then(({ generateResumeDocx }) => generateResumeDocx(JSON.parse(snapshot) as ResumePdfModel))
      // A generation failure can be retried, unlike a check failure which retains its bytes.
      void artifact.blob.catch(() => { artifact.blob = undefined; report(artifact, { status: 'unavailable' }) })
    }
    const blob = await artifact.blob
    if (!artifact.stopped && !artifact.checking && (retryFailed || !artifact.attempted)) {
      window.clearTimeout(artifact.timer)
      artifact.attempted = true
      artifact.checking = true
      report(artifact, { status: 'checking' })
      void check(artifact, blob, retryFailed)
    }
    return blob
  }
  return { state: reported?.token === token ? reported.state : { status: 'idle' as const }, prepare }
}
