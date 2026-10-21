/** Notice newly accepted speech without treating a reload as a new interviewer turn.
 * The first owned snapshot is a baseline; stale revisions and repeated receipts never replay it.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { InterviewSnapshotFragment } from '@/graphql/generated/graphql'

export function useNewInterviewSpeech(interview: InterviewSnapshotFragment | null) {
  const seen = useRef(new Set<string>())
  const revision = useRef<number | null>(null)
  const [messageId, setMessageId] = useState<string | null>(null)
  useEffect(() => {
    if (!interview || (revision.current !== null && interview.revision < revision.current)) return
    const accepted = interview.operations.filter((operation) => operation.kind === 'speech' && operation.status === 'accepted')
    const current = interview.messages.filter((message) => message.kind !== 'answer').at(-1)
    const fresh = revision.current !== null && current && accepted.some((operation) => operation.messageId === current.id) && !seen.current.has(current.id)
    for (const operation of accepted) if (operation.messageId) seen.current.add(operation.messageId)
    revision.current = interview.revision
    setMessageId((pending) => fresh ? current.id : pending === current?.id ? pending : null)
  }, [interview])
  const consume = useCallback((id: string) => setMessageId((pending) => pending === id ? null : pending), [])
  return { messageId, consume }
}
