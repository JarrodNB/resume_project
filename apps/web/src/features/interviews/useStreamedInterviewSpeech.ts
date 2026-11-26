/** Let the browser voice start on the interviewer's reply while the model is still writing it.
 * Only browser playback observes the running answer turn's provisional text; provider audio never does.
 * When the saved reply arrives and begins with everything streamed, the same playback finishes with the
 * saved text, so nothing is said twice. A failed stream, or a saved reply that differs, returns null and
 * leaves today's saved-text playback in charge. Observing never starts or retries model work.
 */
import { useEffect, useEffectEvent, useState } from 'react'
import { useMutation } from '@apollo/client/react'
import type { InterviewSnapshotFragment } from '@/graphql/generated/graphql'
import { observeAiOutput } from '@/lib/aiOutputStream'
import { currentInterviewPrompt } from './currentInterviewPrompt'
import { AUTHORIZE_INTERVIEW_OUTPUT } from './interviewOperations'
import { keyInterviewTiming } from './interviewLatency'

export type StreamedInterviewSpeech = { key: string; text: string; streaming: boolean }
type Stream = { operationId: string; baseReplyId: string | undefined; text: string }

export function useStreamedInterviewSpeech(interview: InterviewSnapshotFragment | null, consumeNewSpeech: (messageId: string) => void): StreamedInterviewSpeech | null {
  const [authorize] = useMutation(AUTHORIZE_INTERVIEW_OUTPUT)
  const [stream, setStream] = useState<Stream | null>(null)
  const turn = interview?.operations.filter((operation) => operation.kind === 'turn').at(-1)
  const reply = interview ? currentInterviewPrompt(interview).reply : undefined
  const currentReplyId = useEffectEvent(() => reply?.id)
  const runningTurnId = interview?.speechPlaybackMode === 'browser' && interview.status === 'active' && turn?.status === 'running' ? turn.id : null

  useEffect(() => {
    if (!runningTurnId) return
    // The reply on screen when the turn started; the saved reply for this turn is the next one.
    const baseReplyId = currentReplyId()
    keyInterviewTiming('submit-to-audio', `stream:${runningTurnId}`)
    return observeAiOutput({ feature: 'interviews', operation: { id: runningTurnId },
      authorize: async () => {
        const result = await authorize({ variables: { input: { feature: 'interviews', operationId: runningTurnId } } })
        const payload = result.data?.authorizeAiExecutionStream
        return payload && !payload.errors.length ? payload.token : null
      },
      onText: (text) => setStream({ operationId: runningTurnId, baseReplyId, text }),
      // The interview snapshot subscription delivers the saved reply.
      onReconcile: () => {},
    })
  }, [runningTurnId, authorize])

  let speech: StreamedInterviewSpeech | null = null
  let handedOffReplyId: string | null = null
  if (stream?.text && turn && stream.operationId === turn.id && interview?.speechPlaybackMode === 'browser') {
    const key = `stream:${turn.id}`
    if (turn.status === 'running') speech = { key, text: stream.text, streaming: true }
    else if (turn.status === 'accepted' && reply && reply.id !== stream.baseReplyId) {
      const saved = reply.spokenContent ?? reply.content
      if (saved.startsWith(stream.text)) {
        speech = { key, text: saved, streaming: false }
        handedOffReplyId = reply.id
      }
    }
  }
  useEffect(() => {
    if (handedOffReplyId) consumeNewSpeech(handedOffReplyId)
  }, [handedOffReplyId, consumeNewSpeech])
  return speech
}
