/** Authorize one live microphone capture using the current owned interview revision.
 * The opaque capability stays in memory and the audio adapter owns cancellation and fallback.
 */
import { useCallback } from 'react'
import { useMutation } from '@apollo/client/react'
import { graphql } from '@/graphql/generated'
import { startStreamingTranscription } from './streamingTranscription'
import type { TranscriptionCallbacks } from './transcriptionCapture'

export const AUTHORIZE_TRANSCRIPTION = graphql(`
  mutation AuthorizeInterviewTranscription($input: AuthorizeInterviewTranscriptionInput!) {
    authorizeInterviewTranscription(input: $input) { captureId token errors }
  }
`)
type Snapshot = { id: string; revision: number; currentQuestionPosition: number; questions: ReadonlyArray<{id: string; position: number}> }

export function useInterviewStreaming(interview: Snapshot | null) {
  const [authorize] = useMutation(AUTHORIZE_TRANSCRIPTION)
  return useCallback((stream: MediaStream, callbacks: TranscriptionCallbacks) => startStreamingTranscription(stream, callbacks, async () => {
    const question = interview?.questions.find(item => item.position === interview.currentQuestionPosition)
    if (!interview || !question) throw new Error('This interview has no current question.')
    const payload = (await authorize({ variables: { input: {
      interviewId: interview.id, questionId: question.id, expectedRevision: interview.revision,
    } } })).data?.authorizeInterviewTranscription
    if (payload?.errors.length) throw new Error(payload.errors.join(' '))
    if (!payload?.captureId || !payload.token) throw new Error('Streaming authorization was not received.')
    return { captureId: payload.captureId, token: payload.token }
  }), [authorize, interview])
}
