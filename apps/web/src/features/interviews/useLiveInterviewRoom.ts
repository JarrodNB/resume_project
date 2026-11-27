/** The one adapter between a live interview and LiveKit; no other module imports `livekit-client`.
 * It asks Rails to join (which starts a ready interview), connects to the room with the
 * short-lived token, turns on the microphone and plays the interviewer's audio. It reports
 * whether the interviewer agent has joined, live captions for both sides (from LiveKit's
 * `lk.transcription` text streams), the interview progress the agent publishes as participant
 * attributes, and lets the candidate mute. Leaving the page disconnects the room.
 * `end()` asks the agent to end the interview (RPC `interview.choose` with `{"option":"end"}`),
 * waiting at most 5 seconds, then calls Rails' `endLiveInterview`. That finishes the interview
 * itself when the agent is gone or failed, and otherwise just returns the finished snapshot.
 * Later tickets add the other menu choices.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation } from '@apollo/client/react'
import { Room, RoomEvent, Track, type Participant, type RemoteTrack } from 'livekit-client'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import { END_LIVE_INTERVIEW, INTERVIEW_QUERY, JOIN_LIVE_INTERVIEW } from './interviewOperations'

export type LiveRoomStatus = 'joining' | 'connecting' | 'connected' | 'failed'
/** One caption line. A segment's interim text is replaced by its later or final text. */
export interface LiveCaption { id: string; speaker: 'candidate' | 'interviewer'; text: string }
/** Where the interview stands, as the agent last published it. `questionPosition` is zero-based. */
export interface LiveRoomProgress { questionPosition: number | null; questionTotal: number | null; phase: string | null }
interface LiveRoomState { status: LiveRoomStatus; agentJoined: boolean; error: string | null; captions: LiveCaption[]; progress: LiveRoomProgress; muted: boolean; ending: boolean; endError: string | null }
export interface LiveInterviewRoom extends LiveRoomState {
  mute: (on: boolean) => Promise<void>
  /** Ends the interview; resolves true once Rails has finished it (completed or abandoned). */
  end: () => Promise<boolean>
}

/** Keep the screen and memory bounded in a long interview. */
const MAX_CAPTIONS = 50
const NO_PROGRESS: LiveRoomProgress = { questionPosition: null, questionTotal: null, phase: null }
/** How long End interview waits for the agent before finishing through Rails directly. */
export const LIVE_END_AGENT_TIMEOUT_MS = 5_000

/** Rejects if `promise` hasn't settled within `ms` (LiveKit clamps its own RPC timeout to 8 s or more). */
function within<T>(promise: Promise<T>, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('timed out')), ms) })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

function wholeNumber(value: string | undefined) {
  const number = value === undefined ? Number.NaN : Number(value)
  return Number.isInteger(number) && number >= 0 ? number : null
}

/** The agent publishes `cd.question_position`, `cd.question_total` and `cd.phase` as strings. */
function agentProgress(attributes: Record<string, string>): LiveRoomProgress {
  return { questionPosition: wholeNumber(attributes['cd.question_position']), questionTotal: wholeNumber(attributes['cd.question_total']), phase: attributes['cd.phase'] ?? null }
}

export function useLiveInterviewRoom(interviewId: string): LiveInterviewRoom {
  const [join] = useMutation(JOIN_LIVE_INTERVIEW)
  const [endLive] = useMutation(END_LIVE_INTERVIEW)
  const [room, setRoom] = useState<LiveRoomState>({ status: 'joining', agentJoined: false, error: null, captions: [], progress: NO_PROGRESS, muted: false, ending: false, endError: null })
  const livekitRef = useRef<Room | null>(null)
  useEffect(() => {
    let cancelled = false
    const livekit = new Room()
    livekitRef.current = livekit
    const audio: HTMLMediaElement[] = []
    const update = (change: (previous: LiveRoomState) => Partial<LiveRoomState>) => { if (!cancelled) setRoom((previous) => ({ ...previous, ...change(previous) })) }
    const noticeAgent = (participant: Participant) => {
      if (participant.isAgent) update(() => ({ agentJoined: true, progress: agentProgress(participant.attributes) }))
    }
    const showCaption = (caption: LiveCaption) => update(({ captions }) => {
      const index = captions.findIndex((item) => item.id === caption.id)
      const next = index === -1 ? [...captions, caption] : captions.map((item, at) => at === index ? caption : item)
      return { captions: next.slice(-MAX_CAPTIONS) }
    })
    livekit.registerTextStreamHandler('lk.transcription', (reader, participant) => {
      const id = reader.info.attributes?.['lk.segment_id'] ?? reader.info.id
      const speaker = participant.identity === livekit.localParticipant.identity ? 'candidate' : 'interviewer'
      void (async () => {
        let text = ''
        try {
          for await (const chunk of reader) {
            text += chunk
            showCaption({ id, speaker, text })
          }
        } catch { /* A dropped stream leaves the caption as far as it got. */ }
      })()
    })
    livekit.on(RoomEvent.ParticipantConnected, noticeAgent)
    livekit.on(RoomEvent.ParticipantAttributesChanged, (_changed: Record<string, string>, participant: Participant) => noticeAgent(participant))
    livekit.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
      if (track.kind === Track.Kind.Audio) { const element = track.attach(); audio.push(element); document.body.append(element) }
    })
    livekit.on(RoomEvent.Disconnected, () => update(() => ({ status: 'failed', error: 'The live room disconnected.' })))
    async function connect() {
      try {
        const result = await join({
          variables: { interviewId },
          update: (cache, { data }) => {
            const interviewSession = data?.joinLiveInterview?.interview
            if (interviewSession) cache.writeQuery({ query: INTERVIEW_QUERY, variables: { id: interviewId }, data: { interviewSession } })
          },
        })
        const payload = result.data?.joinLiveInterview
        if (!payload?.url || !payload.token) throw new Error(payload?.errors.join(' ') || 'Could not join the live interview.')
        if (cancelled) return
        update(() => ({ status: 'connecting' }))
        await livekit.connect(payload.url, payload.token)
        if (cancelled) return
        update(() => ({ status: 'connected' }))
        livekit.remoteParticipants.forEach(noticeAgent)
        await livekit.localParticipant.setMicrophoneEnabled(true)
      } catch (cause) {
        update(() => ({ status: 'failed', error: requestErrorMessage(cause, cause instanceof Error ? cause.message : 'Could not join the live interview.') }))
      }
    }
    void connect()
    return () => {
      cancelled = true
      livekitRef.current = null
      void livekit.disconnect()
      audio.forEach((element) => element.remove())
    }
  }, [interviewId, join])
  const mute = useCallback(async (on: boolean) => {
    const livekit = livekitRef.current
    if (!livekit) return
    await livekit.localParticipant.setMicrophoneEnabled(!on)
    setRoom((previous) => ({ ...previous, muted: on }))
  }, [])
  const end = useCallback(async () => {
    setRoom((previous) => ({ ...previous, ending: true, endError: null }))
    const livekit = livekitRef.current
    const agent = livekit ? [...livekit.remoteParticipants.values()].find((participant) => participant.isAgent) : undefined
    if (livekit && agent) {
      try {
        await within(livekit.localParticipant.performRpc({ destinationIdentity: agent.identity, method: 'interview.choose', payload: JSON.stringify({ option: 'end' }) }), LIVE_END_AGENT_TIMEOUT_MS)
      } catch { /* The agent is gone or failed; Rails finishes the interview below. */ }
    }
    let endError: string | null = null
    try {
      const result = await endLive({
        variables: { interviewId },
        update: (cache, { data }) => {
          const interviewSession = data?.endLiveInterview?.interview
          if (interviewSession) cache.writeQuery({ query: INTERVIEW_QUERY, variables: { id: interviewId }, data: { interviewSession } })
        },
      })
      const errors = result.data?.endLiveInterview?.errors ?? []
      if (!result.data?.endLiveInterview || errors.length) endError = errors.join(' ') || 'Could not end the interview.'
    } catch (cause) {
      endError = requestErrorMessage(cause, 'Could not end the interview.')
    }
    setRoom((previous) => ({ ...previous, ending: false, endError }))
    return endError === null
  }, [endLive, interviewId])
  return { ...room, mute, end }
}
