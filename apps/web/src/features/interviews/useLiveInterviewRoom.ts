/** The one adapter between a live interview and LiveKit; no other module imports `livekit-client`.
 * It asks Rails to join (which starts a ready interview), connects to the room with the
 * short-lived token, turns on the microphone (unless the candidate muted it before a rejoin) and plays the interviewer's audio. It reports
 * whether the interviewer agent has joined (and `agentLeft` once it left again, clearing its
 * progress until an agent rejoins), live captions for both sides (from LiveKit's
 * `lk.transcription` text streams), the interview progress and counted time left (with the
 * two-minute warning flag) the agent publishes as participant attributes, and lets the candidate mute. Leaving the page disconnects the room.
 * `choose(option)` sends a coaching-menu button (Try again, Hear the question again, Get a hint,
 * Move on) or "How was that?" to the agent over the same RPC (`interview.choose`), with the
 * room state counter (`cd.state_seq`) the room showed for it; the agent then speaks the choice. A click
 * that landed after the interview moved on by voice answers `ignored`, which is not an error. `end()` asks the agent to end the interview (`{"option":"end"}`), then calls
 * Rails' `endLiveInterview`. With no agent in the room, or when the RPC fails with an error, that
 * call comes at once; otherwise it waits for the agent's own finish (at most 35 seconds, while
 * the page shows "Ending…"). `endLiveInterview` finishes the interview itself when the agent is
 * gone or failed, and otherwise just returns the finished snapshot.
 * When the connection drops, the status is `reconnecting` while LiveKit retries by itself, and
 * `disconnected` if it gives up. `rejoin()` then asks Rails to join again (the same room, with a
 * fresh token; the interviewer waits about 2 minutes for the candidate) and connects again. If
 * Rails refuses because the interview has meanwhile finished, the open interview query is
 * refetched so the page shows its review or abandoned state. (Switching to a turn-based interview
 * needs nothing here: Rails ends the live room when it starts that interview.) `roomOpened` says
 * whether Rails ever signed a join token, so whether there is a room End interview can finish.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useApolloClient, useMutation } from '@apollo/client/react'
import { Room, RoomEvent, Track, type Participant, type RemoteTrack } from 'livekit-client'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import { END_LIVE_INTERVIEW, INTERVIEW_QUERY, JOIN_LIVE_INTERVIEW } from './interviewOperations'

export type LiveRoomStatus = 'joining' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'failed'
/** One caption line. A segment's interim text is replaced by its later or final text. */
export interface LiveCaption { id: string; speaker: 'candidate' | 'interviewer'; text: string }
/** Where the interview stands, as the agent last published it. `questionPosition` is zero-based;
 * `menuOffered` is true while the interviewer waits for the candidate's coaching-menu choice.
 * `secondsLeft` is the lower of the session's counted time left (menu waits are free) and the
 * user's live allowance left, refreshed about every 5 seconds; `timeWarning` turns on once about
 * 2 minutes of either are left. */
export interface LiveRoomProgress { questionPosition: number | null; questionTotal: number | null; phase: string | null; stateSeq: number | null; menuOffered: boolean; secondsLeft: number | null; timeWarning: boolean }
/** A coaching-menu button or "How was that?" (`feedback`). */
export type LiveMenuOption = 'retry' | 'repeat' | 'hint' | 'next' | 'feedback'
interface LiveRoomState {
  status: LiveRoomStatus
  /** Rails opened a live room (signed a join token) at least once, so there is a room End interview can finish. */
  roomOpened: boolean
  agentJoined: boolean
  agentLeft: boolean
  error: string | null
  captions: LiveCaption[]
  progress: LiveRoomProgress
  muted: boolean
  ending: boolean
  endError: string | null
  choosing: boolean
  chooseError: string | null
}
export interface LiveInterviewRoom extends LiveRoomState {
  mute: (on: boolean) => Promise<void>
  /** Sends a menu choice to the interviewer; resolves true once the agent answered (accepted, or
   * ignored because the interview had already moved on). */
  choose: (option: LiveMenuOption) => Promise<boolean>
  /** Ends the interview; resolves true once Rails has finished it (completed or abandoned). */
  end: () => Promise<boolean>
  /** After a dropped connection, joins the same room again. */
  rejoin: () => Promise<void>
}

/** Keep the screen and memory bounded in a long interview. */
const MAX_CAPTIONS = 50
const NO_PROGRESS: LiveRoomProgress = { questionPosition: null, questionTotal: null, phase: null, stateSeq: null, menuOffered: false, secondsLeft: null, timeWarning: false }
/** How long End interview waits for the agent's answer. The agent may first spend up to 30 seconds
 * delivering the last answer, usage and its finish to Rails (`DELIVERY_WAIT_SECONDS` in
 * services/ai/live_interviews/agent.py), so this is that wait plus room for the round trip. Finishing
 * through Rails sooner could abandon an answered interview and drop its last usage. */
export const LIVE_END_AGENT_TIMEOUT_MS = 35_000
/** How long a menu choice waits for the agent before it is reported as not received. */
const LIVE_CHOICE_TIMEOUT_MS = 8_000
const CHOICE_FAILED = 'Your interviewer didn’t get that choice. Try again or say it out loud.'

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

/** The agent publishes `cd.question_position`, `cd.question_total`, `cd.phase`, `cd.state_seq`,
 * `cd.menu_offered`, `cd.seconds_left` and `cd.time_warning` as strings. */
function agentProgress(attributes: Record<string, string>): LiveRoomProgress {
  return { questionPosition: wholeNumber(attributes['cd.question_position']), questionTotal: wholeNumber(attributes['cd.question_total']), phase: attributes['cd.phase'] ?? null, stateSeq: wholeNumber(attributes['cd.state_seq']),
    menuOffered: attributes['cd.menu_offered'] === 'true', secondsLeft: wholeNumber(attributes['cd.seconds_left']), timeWarning: attributes['cd.time_warning'] === 'true' }
}

function agentIn(livekit: Room | null) {
  return livekit ? [...livekit.remoteParticipants.values()].find((participant) => participant.isAgent) : undefined
}

export function useLiveInterviewRoom(interviewId: string): LiveInterviewRoom {
  const [join] = useMutation(JOIN_LIVE_INTERVIEW)
  const [endLive] = useMutation(END_LIVE_INTERVIEW)
  const client = useApolloClient()
  const [room, setRoom] = useState<LiveRoomState>({ status: 'joining', roomOpened: false, agentJoined: false, agentLeft: false, error: null, captions: [], progress: NO_PROGRESS, muted: false, ending: false, endError: null, choosing: false, chooseError: null })
  const livekitRef = useRef<Room | null>(null)
  const connectRef = useRef<(() => Promise<boolean>) | null>(null)
  /** The candidate's mute choice, kept across a rejoin so the microphone matches the button. */
  const mutedRef = useRef(false)
  /** The progress the room last showed, whose state counter a choice echoes so the agent can ignore a stale click. */
  const shownProgressRef = useRef(NO_PROGRESS)
  useEffect(() => { shownProgressRef.current = room.progress }, [room.progress])
  useEffect(() => {
    let cancelled = false
    const livekit = new Room()
    livekitRef.current = livekit
    const audio: HTMLMediaElement[] = []
    const update = (change: (previous: LiveRoomState) => Partial<LiveRoomState>) => { if (!cancelled) setRoom((previous) => ({ ...previous, ...change(previous) })) }
    const noticeAgent = (participant: Participant) => {
      if (participant.isAgent) update(() => ({ agentJoined: true, agentLeft: false, progress: agentProgress(participant.attributes) }))
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
    livekit.on(RoomEvent.ParticipantDisconnected, (participant: Participant) => {
      if (participant.isAgent) update(() => ({ agentJoined: false, agentLeft: true, progress: NO_PROGRESS }))
    })
    livekit.on(RoomEvent.ParticipantAttributesChanged, (_changed: Record<string, string>, participant: Participant) => noticeAgent(participant))
    livekit.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
      if (track.kind === Track.Kind.Audio) { const element = track.attach(); audio.push(element); document.body.append(element) }
    })
    livekit.on(RoomEvent.Reconnecting, () => update(() => ({ status: 'reconnecting' })))
    livekit.on(RoomEvent.Reconnected, () => update(() => ({ status: 'connected' })))
    livekit.on(RoomEvent.Disconnected, () => {
      audio.splice(0).forEach((element) => element.remove())
      update(({ status }) => status === 'connected' || status === 'reconnecting'
        ? { status: 'disconnected', agentJoined: false, error: null }
        : { status: 'failed', error: 'The live room disconnected.' })
    })
    /** Joins through Rails and connects; resolves false when either step failed. */
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
        if (cancelled) return true
        update(() => ({ status: 'connecting', roomOpened: true }))
        await livekit.connect(payload.url, payload.token)
        if (cancelled) return true
        update(() => ({ status: 'connected' }))
        livekit.remoteParticipants.forEach(noticeAgent)
        await livekit.localParticipant.setMicrophoneEnabled(!mutedRef.current)
        return true
      } catch (cause) {
        update(() => ({ status: 'failed', error: requestErrorMessage(cause, cause instanceof Error ? cause.message : 'Could not join the live interview.') }))
        return false
      }
    }
    void connect()
    connectRef.current = connect
    return () => {
      cancelled = true
      livekitRef.current = null
      connectRef.current = null
      void livekit.disconnect()
      audio.forEach((element) => element.remove())
    }
  }, [interviewId, join])
  const mute = useCallback(async (on: boolean) => {
    const livekit = livekitRef.current
    if (!livekit) return
    await livekit.localParticipant.setMicrophoneEnabled(!on)
    mutedRef.current = on
    setRoom((previous) => ({ ...previous, muted: on }))
  }, [])
  const choose = useCallback(async (option: LiveMenuOption) => {
    setRoom((previous) => ({ ...previous, choosing: true, chooseError: null }))
    const livekit = livekitRef.current
    const agent = agentIn(livekit)
    let sent = false
    const { stateSeq } = shownProgressRef.current
    if (livekit && agent) {
      try {
        const payload = JSON.stringify({ option, state_seq: stateSeq })
        await within(livekit.localParticipant.performRpc({ destinationIdentity: agent.identity, method: 'interview.choose', payload }), LIVE_CHOICE_TIMEOUT_MS)
        sent = true
      } catch { /* Reported below; the candidate can retry or say the choice. */ }
    }
    setRoom((previous) => ({ ...previous, choosing: false, chooseError: sent ? null : CHOICE_FAILED }))
    return sent
  }, [])
  const end = useCallback(async () => {
    setRoom((previous) => ({ ...previous, ending: true, endError: null }))
    const livekit = livekitRef.current
    const agent = agentIn(livekit)
    if (livekit && agent) {
      try {
        await within(livekit.localParticipant.performRpc({ destinationIdentity: agent.identity, method: 'interview.choose', payload: JSON.stringify({ option: 'end' }),
          responseTimeout: LIVE_END_AGENT_TIMEOUT_MS }), LIVE_END_AGENT_TIMEOUT_MS)
      } catch { /* The agent is gone, failed or never answered; Rails finishes the interview below. */ }
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
  const rejoin = useCallback(async () => {
    const connect = connectRef.current
    if (!connect) return
    setRoom((previous) => ({ ...previous, status: 'joining', error: null }))
    if (await connect()) return
    // The interview may have finished meanwhile; the refreshed page then shows its outcome.
    void client.refetchQueries({ include: [INTERVIEW_QUERY] })
    setRoom((previous) => ({ ...previous, status: 'disconnected' }))
  }, [client])
  return { ...room, mute, choose, end, rejoin }
}
