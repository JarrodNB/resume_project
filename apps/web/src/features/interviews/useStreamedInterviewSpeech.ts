/** Let the browser voice start on the interviewer's reply while the model is still writing it.
 * Only browser playback observes the running answer turn's provisional text; provider audio never does.
 * When the saved reply arrives and begins with everything streamed, the same playback finishes with the
 * saved text, so nothing is said twice (this also covers an acknowledgement followed by the next question).
 * If the stream fails, the turn fails, or the saved reply differs, the streamed voice stops. Once any
 * streamed sentence was heard, the saved reply is then shown but not spoken again automatically; if none
 * was heard, the saved reply plays as usual. Only the reply the turn saved is handled; any later reply,
 * such as the next question after Skip, plays normally. The last question never streams, because finishing
 * the interview replaces the room at once. Observing never starts or retries model work.
 */
import { useCallback, useEffect, useEffectEvent, useState } from 'react'
import { useMutation } from '@apollo/client/react'
import type { InterviewSnapshotFragment } from '@/graphql/generated/graphql'
import { observeAiOutput } from '@/lib/aiOutputStream'
import { currentInterviewPrompt } from './currentInterviewPrompt'
import { AUTHORIZE_INTERVIEW_OUTPUT } from './interviewOperations'
import { keyInterviewTiming, STREAMED_SPEECH_TIMING } from './interviewLatency'

export type StreamedInterviewSpeech = { key: string; text: string; streaming: boolean }
/** `observation` tells one attempt to observe a turn apart from a retry of the same turn. */
type Stream = { observation: object; operationId: string; baseReplyId: string | undefined; text: string; heard: boolean
  /** The reply this turn saved. Later replies (for example the next question after Skip) are left alone. */
  replyId?: string }

export function useStreamedInterviewSpeech(interview: InterviewSnapshotFragment | null, consumeNewSpeech: (messageId: string) => void): {
  speech: StreamedInterviewSpeech | null
  /** Pass to the browser player: records that the streamed voice has actually started speaking. */
  speechStarted: (key: string) => void
} {
  const [authorize] = useMutation(AUTHORIZE_INTERVIEW_OUTPUT)
  const [stream, setStream] = useState<Stream | null>(null)
  const turn = interview?.operations.filter((operation) => operation.kind === 'turn').at(-1)
  const reply = interview ? currentInterviewPrompt(interview).reply : undefined
  const currentReplyId = useEffectEvent(() => reply?.id)
  // An answer to the last question can complete the interview, and the completed review replaces the room
  // (and its voice) at once, so streamed speech there would be cut off mid-sentence.
  const lastQuestion = interview ? interview.currentQuestionPosition >= Math.max(...interview.questions.map((question) => question.position)) : true
  const runningTurnId = interview?.speechPlaybackMode === 'browser' && interview.status === 'active' && !lastQuestion && turn?.status === 'running' ? turn.id : null

  useEffect(() => {
    if (!runningTurnId) return
    // The reply on screen when the turn started; the saved reply for this turn is the next one.
    const baseReplyId = currentReplyId()
    const observation = {}
    keyInterviewTiming('submit-to-audio', `stream:${runningTurnId}`, STREAMED_SPEECH_TIMING)
    return observeAiOutput({ feature: 'interviews', operation: { id: runningTurnId },
      authorize: async () => {
        const result = await authorize({ variables: { input: { feature: 'interviews', operationId: runningTurnId } } })
        const payload = result.data?.authorizeAiExecutionStream
        return payload && !payload.errors.length ? payload.token : null
      },
      // A failed or unavailable stream reports empty text, which stops the streamed voice.
      onText: (text) => setStream((current) => ({ observation, operationId: runningTurnId, baseReplyId, text,
        heard: current?.observation === observation && current.heard })),
      // The interview snapshot subscription delivers the saved reply.
      onReconcile: () => {},
    })
  }, [runningTurnId, authorize])

  const speechStarted = useCallback((key: string) => {
    setStream((current) => current && !current.heard && key === `stream:${current.operationId}` ? { ...current, heard: true } : current)
  }, [])

  // A failed or waiting turn can be retried under the same id: forget what its earlier attempt streamed.
  if (stream && turn?.id === stream.operationId && turn.status !== 'running' && turn.status !== 'accepted') setStream(null)

  let speech: StreamedInterviewSpeech | null = null
  let quietReplyId: string | null = null
  if (stream && turn && stream.operationId === turn.id && interview?.speechPlaybackMode === 'browser') {
    const key = `stream:${turn.id}`
    if (turn.status === 'running' && stream.text) speech = { key, text: stream.text, streaming: true }
    else if (turn.status === 'accepted' && reply && reply.id !== stream.baseReplyId && (stream.replyId ?? reply.id) === reply.id) {
      // Remember the first reply seen after acceptance; it is the one this turn produced.
      if (!stream.replyId) setStream({ ...stream, replyId: reply.id })
      const saved = reply.spokenContent ?? reply.content
      if (stream.text && saved.startsWith(stream.text)) {
        speech = { key, text: saved, streaming: false }
        quietReplyId = reply.id
      } else if (stream.heard) {
        // Rare: the saved reply differs from speech already heard. Show it, but never re-speak it.
        quietReplyId = reply.id
      }
    }
  }
  useEffect(() => {
    if (quietReplyId) consumeNewSpeech(quietReplyId)
  }, [quietReplyId, consumeNewSpeech])
  return { speech, speechStarted }
}
