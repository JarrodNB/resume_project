/** The room for a live interview: the candidate and the interviewer talk in real time through
 * LiveKit (see useLiveInterviewRoom). It shows the connection state, then captions (which the
 * candidate can hide), "Question N of M" and the counted time left from the interviewer agent
 * (with an announced warning at about 2 minutes left) and a mute button. After the
 * interviewer's spoken feedback on a question, it shows the coaching choices (Try again, Hear the
 * question again, Get a hint, Move on) while the agent says the menu is offered; while the
 * candidate answers it offers "How was that?". Each button sends the same choice as saying it. The
 * career references panel works exactly as in the turn-based room, for the prompt the agent
 * saved. If the interviewer hasn't joined within 15 seconds, or joining fails, it offers to
 * start a new turn-based interview with the same setup (a fresh preparation, so new questions);
 * taking it ends the live room as failed so the live session doesn't stay active. If the
 * connection drops it shows "Reconnecting…" while LiveKit retries, and after a full disconnect a
 * Rejoin interview button (the interviewer waits about 2 minutes, then finishes the interview).
 * End interview (after a confirmation) finishes the session: completed with at least one saved
 * answer, so the page shows the usual review, or abandoned with none.
 */
import { useEffect, useId, useState } from 'react'
import { useNavigate } from 'react-router'
import { Mic, MicOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useFocusMode } from '@/components/useFocusMode'
import { useAuth } from '@/features/auth/useAuth'
import { MutationErrorAlert } from '@/features/billing/PlanBillingLink'
import type { InterviewSnapshotFragment } from '@/graphql/generated/graphql'
import { currentInterviewPrompt } from './currentInterviewPrompt'
import { InterviewCareerReferences } from './InterviewCareerReferences'
import { LiveCaptions } from './LiveCaptions'
import { useLiveInterviewRoom, type LiveInterviewRoom as LiveRoom, type LiveMenuOption } from './useLiveInterviewRoom'
import { useStartInterview } from './useInterviewSession'

/** How long the room waits for the interviewer agent before offering the turn-based fallback. */
export const LIVE_AGENT_JOIN_TIMEOUT_MS = 15_000

export function LiveInterviewRoom({ interview }: { interview: InterviewSnapshotFragment }) {
  const room = useLiveInterviewRoom(interview.id)
  const { user } = useAuth()
  const [referenceVisitId] = useState(() => crypto.randomUUID())
  const [timedOut, setTimedOut] = useState(false)
  useFocusMode(true)
  const dropped = room.status === 'reconnecting' || room.status === 'disconnected'
  const waitingForAgent = !room.agentJoined && !dropped
  useEffect(() => {
    if (!waitingForAgent) return
    const timer = setTimeout(() => setTimedOut(true), LIVE_AGENT_JOIN_TIMEOUT_MS)
    return () => { clearTimeout(timer); setTimedOut(false) }
  }, [waitingForAgent])
  const message = room.status === 'joining' ? 'Joining the interview room…'
    : room.status === 'connecting' ? 'Connecting…'
    : room.status === 'reconnecting' ? 'Reconnecting…'
    : room.status === 'disconnected' ? 'You were disconnected. Your interviewer waits about 2 minutes.'
    : room.status === 'connected' && room.agentJoined ? 'Connected. Your interviewer is here.'
    : room.status === 'connected' ? 'Waiting for your interviewer…'
    : 'Could not connect to the live room.'
  const showFallback = room.status === 'failed' || (timedOut && waitingForAgent)
  const { reply } = currentInterviewPrompt(interview)
  return <section aria-labelledby="live-interview-title" className="interview-stage grid gap-4">
    <h2 id="live-interview-title" className="text-xl font-semibold">Live interview</h2>
    {!showFallback && <p role="status" className="text-sm">{message}</p>}
    {showFallback && <TurnBasedFallback interview={interview} room={room} reason={room.status === 'failed' ? room.error : null} />}
    {room.status === 'disconnected' && <div className="grid gap-2">
      {room.error && <p role="alert" className="text-sm text-destructive">{room.error}</p>}
      <Button type="button" className="min-h-11 justify-self-start" onClick={() => void room.rejoin()}>Rejoin interview</Button>
    </div>}
    {!showFallback && (room.status === 'connected' || room.status === 'reconnecting') && <LiveRoomControls room={room} />}
    {room.status !== 'joining' && <EndLiveInterviewButton room={room} />}
    {interview.status === 'active' && interview.executionMode === 'real' && (reply?.kind === 'opening' || reply?.kind === 'follow_up') && <InterviewCareerReferences key={`references:${reply.id}`} ownerId={user?.id ?? ''} interviewId={interview.id} visitId={referenceVisitId} message={reply} disabled={false} />}
  </section>
}

/** Counted seconds as m:ss, such as 24:55 or 1:05. */
function minutesAndSeconds(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

/** Progress from the agent's attributes (zero-based position shown as "Question N of M"), the
 * time left and its warning, mute, the coaching choices and captions. */
function LiveRoomControls({ room }: { room: LiveRoom }) {
  const { questionPosition, questionTotal, phase, menuOffered, secondsLeft, timeWarning } = room.progress
  return <div className="grid gap-3">
    <div className="flex flex-wrap items-center justify-center gap-3">
      {questionPosition !== null && questionTotal !== null && <p className="text-sm font-medium">Question {questionPosition + 1} of {questionTotal}</p>}
      {secondsLeft !== null && <p className={timeWarning ? 'text-sm font-semibold tabular-nums text-destructive' : 'text-sm font-medium tabular-nums'}>{minutesAndSeconds(secondsLeft)} left</p>}
      <Button variant="outline" className="min-h-11" aria-pressed={room.muted} onClick={() => void room.mute(!room.muted)}>
        {room.muted ? <MicOff aria-hidden="true" /> : <Mic aria-hidden="true" />}Mute microphone
      </Button>
      {phase === 'answering' && <Button variant="outline" className="min-h-11" disabled={room.choosing} onClick={() => void room.choose('feedback')}>How was that?</Button>}
    </div>
    {timeWarning && <p role="alert" className="text-center text-sm font-semibold">About 2 minutes left. Start wrapping up.</p>}
    {menuOffered && <CoachingMenu room={room} />}
    {room.chooseError && <p role="alert" className="text-sm text-destructive">{room.chooseError}</p>}
    <LiveCaptions captions={room.captions} />
  </div>
}

const MENU_CHOICES: { option: LiveMenuOption; label: string }[] = [
  { option: 'retry', label: 'Try again' },
  { option: 'repeat', label: 'Hear the question again' },
  { option: 'hint', label: 'Get a hint' },
  { option: 'next', label: 'Move on' },
]

/** The choices after the interviewer's feedback; the interviewer waits until one is made. */
function CoachingMenu({ room }: { room: LiveRoom }) {
  const headingId = useId()
  return <div role="group" aria-labelledby={headingId} className="grid justify-items-center gap-2">
    <p id={headingId} className="text-sm font-medium">What would you like to do next?</p>
    <div className="flex flex-wrap justify-center gap-2">
      {MENU_CHOICES.map(({ option, label }) => <Button key={option} type="button" className="min-h-11" variant={option === 'next' ? 'default' : 'outline'} disabled={room.choosing} onClick={() => void room.choose(option)}>{label}</Button>)}
    </div>
  </div>
}

/** Confirms, then ends the interview through the room hook (the agent, or Rails if the agent is gone). */
function EndLiveInterviewButton({ room }: { room: LiveRoom }) {
  const [open, setOpen] = useState(false)
  const descriptionId = useId()
  async function confirm() {
    if (await room.end()) setOpen(false)
  }
  return <>
    <Button type="button" variant="outline" className="min-h-11 justify-self-start" disabled={room.ending} onClick={() => setOpen(true)}>{room.ending ? 'Ending…' : 'End interview'}</Button>
    {room.endError && !open && <p role="alert" className="text-sm text-destructive">{room.endError}</p>}
    <Dialog open={open} onOpenChange={(value) => { if (!room.ending) setOpen(value) }}>
      <DialogContent aria-describedby={descriptionId}>
        <DialogHeader>
          <DialogTitle>End this interview?</DialogTitle>
          <DialogDescription id={descriptionId}>You cannot continue it afterward. Your saved answers stay, and you’ll see your review. If you haven’t answered any question yet, the interview is abandoned.</DialogDescription>
        </DialogHeader>
        {room.endError && <p role="alert" className="text-sm text-destructive">{room.endError}</p>}
        <DialogFooter>
          <Button type="button" autoFocus variant="outline" disabled={room.ending} onClick={() => setOpen(false)}>Keep interview</Button>
          <Button type="button" variant="destructive" disabled={room.ending} onClick={() => void confirm()}>{room.ending ? 'Ending…' : 'Confirm end'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>
}

/** Starts a turn-based preparation with this session's saved setup and opens it like a normal
 * start, then ends the live room as failed (not awaited, so the page moves on at once). */
function TurnBasedFallback({ interview, room, reason }: { interview: InterviewSnapshotFragment; room: LiveRoom; reason: string | null }) {
  const { start, loading, error, errorCode } = useStartInterview()
  const navigate = useNavigate()
  const [pending, setPending] = useState(false)
  async function startTurnBased() {
    setPending(true)
    try {
      const { questionCount, questionFormat, difficulty, interviewer, focusAreas } = interview.setup
      const id = await start('', { questionCount, questionFormat, difficulty, interviewer, focusAreas }, interview.jobContext?.id ?? undefined, 'turn_based')
      if (!id) return
      void room.leaveForTurnBased()
      await navigate(`/practice/interviews/${id}`)
    } finally { setPending(false) }
  }
  const busy = loading || pending
  return <div className="grid gap-3">
    <p role="alert">{reason ?? 'Your live interviewer didn’t join.'} You can practice the same round as a turn-based interview instead.</p>
    <Button className="min-h-11 justify-self-start" disabled={busy} aria-busy={busy} onClick={() => void startTurnBased()}>{busy ? 'Starting…' : 'Start a turn-based interview with the same setup'}</Button>
    {error && <MutationErrorAlert errors={[error]} errorCode={errorCode} />}
  </div>
}
