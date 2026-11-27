/** The one adapter between a live interview and LiveKit; no other module imports `livekit-client`.
 * It asks Rails to join (which starts a ready interview), connects to the room with the
 * short-lived token, turns on the microphone and plays the interviewer's audio. It reports
 * whether the interviewer agent has joined, live captions for both sides (from LiveKit's
 * `lk.transcription` text streams), the interview progress the agent publishes as participant
 * attributes, and lets the candidate mute. Leaving the page disconnects the room.
 * Later tickets add menu choices and ending the interview.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation } from '@apollo/client/react'
import { Room, RoomEvent, Track, type Participant, type RemoteTrack } from 'livekit-client'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import { INTERVIEW_QUERY, JOIN_LIVE_INTERVIEW } from './interviewOperations'

export type LiveRoomStatus = 'joining' | 'connecting' | 'connected' | 'failed'
/** One caption line. A segment's interim text is replaced by its later or final text. */
export interface LiveCaption { id: string; speaker: 'candidate' | 'interviewer'; text: string }
/** Where the interview stands, as the agent last published it. `questionPosition` is zero-based. */
export interface LiveRoomProgress { questionPosition: number | null; questionTotal: number | null; phase: string | null }
interface LiveRoomState { status: LiveRoomStatus; agentJoined: boolean; error: string | null; captions: LiveCaption[]; progress: LiveRoomProgress; muted: boolean }
export interface LiveInterviewRoom extends LiveRoomState { mute: (on: boolean) => Promise<void> }

/** Keep the screen and memory bounded in a long interview. */
const MAX_CAPTIONS = 50
const NO_PROGRESS: LiveRoomProgress = { questionPosition: null, questionTotal: null, phase: null }

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
  const [room, setRoom] = useState<LiveRoomState>({ status: 'joining', agentJoined: false, error: null, captions: [], progress: NO_PROGRESS, muted: false })
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
  return { ...room, mute }
}
