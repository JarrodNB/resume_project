/** The one adapter between a live interview and LiveKit; no other module imports `livekit-client`.
 * It asks Rails to join (which starts a ready interview), connects to the room with the
 * short-lived token, turns on the microphone and plays the interviewer's audio. It reports
 * whether the interviewer agent has joined. Leaving the page disconnects the room.
 * Later tickets add captions, room state, mute, menu choices and ending the interview.
 */
import { useEffect, useState } from 'react'
import { useMutation } from '@apollo/client/react'
import { Room, RoomEvent, Track, type Participant, type RemoteTrack } from 'livekit-client'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import { INTERVIEW_QUERY, JOIN_LIVE_INTERVIEW } from './interviewOperations'

export type LiveRoomStatus = 'joining' | 'connecting' | 'connected' | 'failed'
export interface LiveInterviewRoom { status: LiveRoomStatus; agentJoined: boolean; error: string | null }

export function useLiveInterviewRoom(interviewId: string): LiveInterviewRoom {
  const [join] = useMutation(JOIN_LIVE_INTERVIEW)
  const [room, setRoom] = useState<LiveInterviewRoom>({ status: 'joining', agentJoined: false, error: null })
  useEffect(() => {
    let cancelled = false
    const livekit = new Room()
    const audio: HTMLMediaElement[] = []
    const update = (change: Partial<LiveInterviewRoom>) => { if (!cancelled) setRoom((previous) => ({ ...previous, ...change })) }
    const noticeAgent = (participant: Participant) => { if (participant.isAgent) update({ agentJoined: true }) }
    livekit.on(RoomEvent.ParticipantConnected, noticeAgent)
    livekit.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
      if (track.kind === Track.Kind.Audio) { const element = track.attach(); audio.push(element); document.body.append(element) }
    })
    livekit.on(RoomEvent.Disconnected, () => update({ status: 'failed', error: 'The live room disconnected.' }))
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
        update({ status: 'connecting' })
        await livekit.connect(payload.url, payload.token)
        if (cancelled) return
        update({ status: 'connected' })
        livekit.remoteParticipants.forEach(noticeAgent)
        await livekit.localParticipant.setMicrophoneEnabled(true)
      } catch (cause) {
        update({ status: 'failed', error: requestErrorMessage(cause, cause instanceof Error ? cause.message : 'Could not join the live interview.') })
      }
    }
    void connect()
    return () => {
      cancelled = true
      void livekit.disconnect()
      audio.forEach((element) => element.remove())
    }
  }, [interviewId, join])
  return room
}
