/** The room for a live interview: the candidate and the interviewer talk in real time through
 * LiveKit (see useLiveInterviewRoom). It shows the connection state, then captions (which the
 * candidate can hide), "Question N of M" from the interviewer agent and a mute button. The
 * career references panel works exactly as in the turn-based room, for the prompt the agent
 * saved. If the interviewer hasn't joined within 15 seconds, or joining fails, it offers to
 * start a new turn-based interview with the same setup (a fresh preparation, so new questions).
 */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { Mic, MicOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useFocusMode } from '@/components/useFocusMode'
import { useAuth } from '@/features/auth/useAuth'
import { MutationErrorAlert } from '@/features/billing/PlanBillingLink'
import type { InterviewSnapshotFragment } from '@/graphql/generated/graphql'
import { currentInterviewPrompt } from './currentInterviewPrompt'
import { InterviewCareerReferences } from './InterviewCareerReferences'
import { LiveCaptions } from './LiveCaptions'
import { useLiveInterviewRoom, type LiveInterviewRoom as LiveRoom } from './useLiveInterviewRoom'
import { useStartInterview } from './useInterviewSession'

/** How long the room waits for the interviewer agent before offering the turn-based fallback. */
export const LIVE_AGENT_JOIN_TIMEOUT_MS = 15_000

export function LiveInterviewRoom({ interview }: { interview: InterviewSnapshotFragment }) {
  const room = useLiveInterviewRoom(interview.id)
  const { user } = useAuth()
  const [referenceVisitId] = useState(() => crypto.randomUUID())
  const [timedOut, setTimedOut] = useState(false)
  useFocusMode(true)
  useEffect(() => {
    if (room.agentJoined) return
    const timer = setTimeout(() => setTimedOut(true), LIVE_AGENT_JOIN_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [room.agentJoined])
  const message = room.status === 'joining' ? 'Joining the interview room…'
    : room.status === 'connecting' ? 'Connecting…'
    : room.status === 'connected' && room.agentJoined ? 'Connected. Your interviewer is here.'
    : room.status === 'connected' ? 'Waiting for your interviewer…'
    : 'Could not connect to the live room.'
  const showFallback = room.status === 'failed' || (timedOut && !room.agentJoined)
  const { reply } = currentInterviewPrompt(interview)
  return <section aria-labelledby="live-interview-title" className="interview-stage grid gap-4">
    <h2 id="live-interview-title" className="text-xl font-semibold">Live interview</h2>
    {!showFallback && <p role="status" className="text-sm">{message}</p>}
    {showFallback && <TurnBasedFallback interview={interview} reason={room.status === 'failed' ? room.error : null} />}
    {!showFallback && room.status === 'connected' && <LiveRoomControls room={room} />}
    {interview.status === 'active' && interview.executionMode === 'real' && (reply?.kind === 'opening' || reply?.kind === 'follow_up') && <InterviewCareerReferences key={`references:${reply.id}`} ownerId={user?.id ?? ''} interviewId={interview.id} visitId={referenceVisitId} message={reply} disabled={false} />}
  </section>
}

/** Progress from the agent's attributes (zero-based position shown as "Question N of M"), mute and captions. */
function LiveRoomControls({ room }: { room: LiveRoom }) {
  const { questionPosition, questionTotal } = room.progress
  return <div className="grid gap-3">
    <div className="flex flex-wrap items-center justify-center gap-3">
      {questionPosition !== null && questionTotal !== null && <p className="text-sm font-medium">Question {questionPosition + 1} of {questionTotal}</p>}
      <Button variant="outline" className="min-h-11" aria-pressed={room.muted} onClick={() => void room.mute(!room.muted)}>
        {room.muted ? <MicOff aria-hidden="true" /> : <Mic aria-hidden="true" />}Mute microphone
      </Button>
    </div>
    <LiveCaptions captions={room.captions} />
  </div>
}

/** Starts a turn-based preparation with this session's saved setup and opens it like a normal start. */
function TurnBasedFallback({ interview, reason }: { interview: InterviewSnapshotFragment; reason: string | null }) {
  const { start, loading, error, errorCode } = useStartInterview()
  const navigate = useNavigate()
  const [pending, setPending] = useState(false)
  async function startTurnBased() {
    setPending(true)
    try {
      const { questionCount, questionFormat, difficulty, interviewer, focusAreas } = interview.setup
      const id = await start('', { questionCount, questionFormat, difficulty, interviewer, focusAreas }, interview.jobContext?.id ?? undefined, 'turn_based')
      if (id) await navigate(`/practice/interviews/${id}`)
    } finally { setPending(false) }
  }
  const busy = loading || pending
  return <div className="grid gap-3">
    <p role="alert">{reason ?? 'Your live interviewer didn’t join.'} You can practice the same round as a turn-based interview instead.</p>
    <Button className="min-h-11 justify-self-start" disabled={busy} aria-busy={busy} onClick={() => void startTurnBased()}>{busy ? 'Starting…' : 'Start a turn-based interview with the same setup'}</Button>
    {error && <MutationErrorAlert errors={[error]} errorCode={errorCode} />}
  </div>
}
