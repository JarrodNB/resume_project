/** Assemble a practice interview from career evidence and deliberate setup choices.
 * Round choices come first as a control panel (switches, interviewer tiles, a focus-area dropdown),
 * including Turn-based or Live; Live offers only the 5 and 8 question lengths and shows the live
 * minutes left (10 over the trial, 60 a day on a paid plan); with fewer than 5 it can't start,
 * then a settings step for how answers are captured, with the round summary beside Start interview.
 * Preparation saves the round choices before review. Settings stay local to this account.
 */
import { useId, useRef, useState, type ReactNode } from 'react'
import { useQuery } from '@apollo/client/react'
import { ArrowLeft, X } from 'lucide-react'
import { useNavigate } from 'react-router'
import { Button } from '@/components/ui/button'
import { MultiSelect } from '@/components/MultiSelect'
import { useAuth } from '@/features/auth/useAuth'
import { MutationErrorAlert } from '@/features/billing/PlanBillingLink'
import { useStartInterview } from './useInterviewSession'
import { useInterviewMicSettings } from './useInterviewMicSettings'
import { InterviewAnswerSettings } from './InterviewAnswerSettings'
import { SetupRow, Switch } from './InterviewSetupControls'
import { useTranscriptionPreference } from './useTranscriptionPreference'
import { conversationModeChoice, conversationModeOptions, difficultyOptions, focusOptions, interviewerOptions, lengthOptions, LIVE_MIN_START_SECONDS, LIVE_QUESTION_COUNTS, typeOptions } from './interviewSetupOptions'
import { LIVE_INTERVIEW_ALLOWANCE } from './interviewOperations'
import type { InterviewJob } from './InterviewJobContext'

const focusChoices = Object.entries(focusOptions).map(([value, label]) => ({ value, label }))

export function InterviewSetup({ notice, initialSetup, job, onChangeRole }: { notice?: ReactNode; onChangeRole?: () => void; initialSetup?: unknown; job?: InterviewJob & { id: string } }) {
  const { start, loading, error, errorCode } = useStartInterview()
  const { user } = useAuth()
  const microphone = useInterviewMicSettings(user?.id ?? '')
  const [transcriptionMode, setTranscriptionMode] = useTranscriptionPreference(user?.id ?? '')
  const navigate = useNavigate()
  const [step, setStep] = useState<'round' | 'settings'>('round')
  const submitting = useRef(false)
  const [pending, setPending] = useState(false)
  const saved = initialSetup && typeof initialSetup === 'object' ? initialSetup as Record<string, unknown> : {}
  const choice = (value: unknown, options: { value: string }[], fallback: string) => options.some((option) => option.value === value) ? value as string : fallback
  const [questionCount, setQuestionCount] = useState(Number(choice(String(saved.questionCount), lengthOptions, '8')))
  const [questionFormat, setQuestionFormat] = useState(choice(saved.questionFormat, typeOptions, 'mixed'))
  const [difficulty, setDifficulty] = useState(choice(saved.difficulty, difficultyOptions, 'realistic'))
  const [interviewer, setInterviewer] = useState(choice(saved.interviewer, interviewerOptions, 'daniel'))
  const [focusAreas, setFocusAreas] = useState<string[]>(Array.isArray(saved.focusAreas) ? [...new Set(saved.focusAreas.filter((value): value is string => typeof value === 'string' && Object.hasOwn(focusOptions, value)))] : [])
  const [conversationMode, setConversationMode] = useState(conversationModeChoice(saved.conversationMode))
  const focusId = useId()
  const liveMinutesId = useId()
  const live = conversationMode === 'LIVE'
  const allowance = useQuery(LIVE_INTERVIEW_ALLOWANCE, { skip: !live, fetchPolicy: 'network-only' })
  const liveSeconds = live ? allowance.data?.me.liveInterviewSecondsLeft ?? null : null
  const liveMinutes = liveSeconds === null ? null : Math.floor(liveSeconds / 60)
  const liveBlocked = liveSeconds !== null && liveSeconds < LIVE_MIN_START_SECONDS
  const lengthChoices = live ? lengthOptions.filter((option) => LIVE_QUESTION_COUNTS.includes(Number(option.value))) : lengthOptions
  function changeConversationMode(value: string) {
    const mode = conversationModeChoice(value)
    setConversationMode(mode)
    if (mode === 'LIVE' && !LIVE_QUESTION_COUNTS.includes(questionCount)) setQuestionCount(8)
  }
  const selected = {
    type: typeOptions.find((item) => item.value === questionFormat) ?? typeOptions[0],
    difficulty: difficultyOptions.find((item) => item.value === difficulty) ?? difficultyOptions[0],
    interviewer: interviewerOptions.find((item) => item.value === interviewer) ?? interviewerOptions[0],
    length: lengthOptions.find((item) => item.value === String(questionCount)) ?? lengthOptions[0],
    conversationMode: conversationModeOptions.find((item) => item.value === conversationMode) ?? conversationModeOptions[0],
  }
  const minutes = selected.length.description.split(' · ')[1]
  const busy = loading || pending
  async function prepare() {
    if (submitting.current) return
    submitting.current = true; setPending(true)
    try {
      const setup = { questionCount, questionFormat, difficulty, interviewer, focusAreas }
      const id = await start('', setup, job?.id, conversationMode)
      if (id) await navigate(`/practice/interviews/${id}`)
    } finally { submitting.current = false; setPending(false) }
  }
  const canRecord = typeof navigator.mediaDevices?.getUserMedia === 'function' && typeof MediaRecorder !== 'undefined'
  const roundSummary = `${selected.type.label} · ${selected.difficulty.label} · ${questionCount} core questions`
  const interviewerName = selected.interviewer.label.split(' — ')[0]
  return <form className={step === 'round' ? 'interview-setup' : 'interview-setup interview-setup-settings'} onSubmit={(event) => { event.preventDefault(); if (liveBlocked) return; if (step === 'round') setStep('settings'); else void prepare() }}>
    {onChangeRole && step === 'round' && <Button type="button" variant="ghost" size="sm" className="justify-self-start" onClick={onChangeRole}><ArrowLeft aria-hidden /> Change role</Button>}
    {step === 'round'
      ? <div className="grid gap-2"><h2 className="text-xl font-extrabold tracking-tight">Set up your interview</h2><p className="max-w-prose text-sm leading-relaxed text-muted-foreground">{job ? 'Choose your round for this saved job.' : 'Choose the round you want to practice.'}</p></div>
      : <h2 className="text-xl font-extrabold tracking-tight">How you’ll answer</h2>}
    <fieldset disabled={busy} className="interview-setup-fields">
      {step === 'round' ? <div className="interview-setup-panel">
      <SetupRow title="Conversation"><Switch name="conversation" options={conversationModeOptions} value={conversationMode} change={changeConversationMode} /><p className="interview-setup-help">{selected.conversationMode.description}</p>
        {liveMinutes !== null && <p className="interview-setup-help">You have {liveMinutes} live {liveMinutes === 1 ? 'minute' : 'minutes'} left.</p>}</SetupRow>
      <SetupRow title="Interview type"><Switch name="type" options={typeOptions} value={questionFormat} change={setQuestionFormat} /><p className="interview-setup-help">{selected.type.description}</p></SetupRow>
      <SetupRow title="Difficulty"><Switch name="difficulty" options={difficultyOptions} value={difficulty} change={setDifficulty} /><p className="interview-setup-help">{selected.difficulty.description}</p></SetupRow>
      <SetupRow title="Your interviewer"><div className="interview-setup-people">
        {interviewerOptions.map((option) => {
          const [name, role] = option.label.split(' — ')
          return <label className="interview-setup-person" key={option.value}>
            <input type="radio" name="interviewer" value={option.value} checked={interviewer === option.value} onChange={() => setInterviewer(option.value)} />
            <span className="interview-setup-who"><span className="interview-setup-initial" aria-hidden="true">{name[0]}</span><span><span className="block font-bold leading-snug">{name}</span><span className="block text-xs font-semibold text-muted-foreground">{role}</span></span></span>
            <span className="text-sm leading-relaxed text-muted-foreground">{option.description}</span>
            <span className="interview-setup-sample"><span className="block text-xs font-semibold text-muted-foreground">Sounds like</span>“{option.sample}”</span>
          </label>
        })}
      </div></SetupRow>
      <SetupRow title="Interview length"><div className="interview-setup-length"><Switch name="length" options={lengthChoices} value={String(questionCount)} change={(value) => setQuestionCount(Number(value))} />
        <span className="interview-setup-stops" aria-hidden="true">{Array.from({ length: questionCount + 1 }, (_, index) => <i key={index} />)}</span></div>
        <p className="interview-setup-help">{selected.length.description}. Follow-up questions may extend it.</p></SetupRow>
      <SetupRow group={false} title={<label htmlFor={`${focusId}-trigger`} id={focusId}>Focus areas <span>(optional)</span></label>}><div className="interview-setup-focus">
        <MultiSelect id={`${focusId}-trigger`} labelId={focusId} emptyLabel="None, a balanced round" options={focusChoices} selected={focusAreas} onChange={setFocusAreas} />
        {focusAreas.length > 0 && <div className="interview-setup-tags">{focusChoices.filter((option) => focusAreas.includes(option.value)).map((option) => <button type="button" key={option.value} aria-label={`Remove ${option.label}`} onClick={() => setFocusAreas((previous) => previous.filter((area) => area !== option.value))}>{option.label}<X size={14} aria-hidden /></button>)}</div>}
        <p className="interview-setup-help">Bias which questions you get. Leave this empty for a balanced round.</p>
      </div></SetupRow>
      </div> : <>
      <InterviewAnswerSettings microphone={microphone} canRecord={canRecord} mode={transcriptionMode} changeMode={setTranscriptionMode} live={live} />
      {canRecord && !live && <p className="interview-setup-help">You can always type or correct your answers. Mic access is requested only when an answer starts.</p>}
      </>}
    </fieldset>
    <div className="interview-setup-footer">
      <p className="text-sm leading-relaxed"><span className="block text-[15px] font-bold">{roundSummary}</span><span className="text-muted-foreground">With {interviewerName} · {minutes}. {step === 'round' ? (live ? 'Next, choose how long a pause ends your turn.' : 'Next, check your microphone and transcription.') : 'Follow-ups may extend it.'}</span></p>
      {/* Distinct keys matter: React would otherwise reuse one DOM button and flip its type to
          "submit" mid-click, so the Continue click would also submit the form and start preparation. */}
      {step === 'round'
        ? <Button key="continue" type="button" size="lg" className="min-h-11" disabled={liveBlocked} aria-describedby={liveBlocked ? liveMinutesId : undefined} onClick={() => setStep('settings')}>Continue to settings</Button>
        : <Button key="start" type="submit" size="lg" className="min-h-11" disabled={busy || liveBlocked} aria-busy={busy} aria-describedby={liveBlocked ? liveMinutesId : undefined}>{busy ? 'Starting…' : 'Start interview'}</Button>}
    </div>
    {liveBlocked && <p id={liveMinutesId} className="text-sm font-semibold text-destructive">You need at least {LIVE_MIN_START_SECONDS / 60} live minutes to start a live interview. You have {liveMinutes} {liveMinutes === 1 ? 'minute' : 'minutes'} left.</p>}
    {step === 'settings' && error && <MutationErrorAlert errors={[error]} errorCode={errorCode} />}
    {notice && <details className="text-sm text-muted-foreground"><summary className="cursor-pointer py-3 font-medium text-foreground">How your details and audio are used</summary><div className="pt-2">{notice}</div></details>}
  </form>
}
