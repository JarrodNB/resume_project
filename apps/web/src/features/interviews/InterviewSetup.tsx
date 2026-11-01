/** Assemble a practice interview from career evidence and deliberate setup choices.
 * Round choices come first as a control panel (switches, interviewer tiles, a focus-area dropdown),
 * then a settings step for microphone and transcription preferences.
 * Preparation saves the round choices before review. Settings stay local to this account.
 */
import { useId, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { useNavigate } from 'react-router'
import { Button } from '@/components/ui/button'
import { MultiSelect } from '@/components/MultiSelect'
import { useAuth } from '@/features/auth/useAuth'
import { useStartInterview } from './useInterviewSession'
import { useInterviewMicSettings } from './useInterviewMicSettings'
import { InterviewMicrophoneSettings } from './InterviewMicrophoneSettings'
import { InterviewTranscriptionSettings } from './InterviewTranscriptionSettings'
import { useTranscriptionPreference } from './useTranscriptionPreference'
import { difficultyOptions, focusOptions, interviewerOptions, lengthOptions, typeOptions } from './interviewSetupOptions'
import type { InterviewJob } from './InterviewJobContext'

type Option = { value: string; label: string; description: string }
const focusChoices = Object.entries(focusOptions).map(([value, label]) => ({ value, label }))

/** One labelled row of the setup panel. The label column names the radio group for screen readers. */
function SetupRow({ title, children, group = true }: { title: ReactNode; children: ReactNode; group?: boolean }) {
  const id = useId()
  return <div className="interview-setup-row" role={group ? 'radiogroup' : undefined} aria-labelledby={group ? id : undefined}>
    <span id={id} className="interview-setup-label">{title}</span><div className="min-w-0">{children}</div>
  </div>
}

/** One pick from a short list, drawn as joined switch buttons over a native radio group. */
function Switch({ name, options, value, change }: { name: string; options: Option[]; value: string; change: (value: string) => void }) {
  return <div className="interview-setup-switch" style={{ '--switch-columns': options.length === 3 ? 3 : 2 } as CSSProperties}>
    {options.map((option) => <label key={option.value}>
      <input type="radio" name={name} value={option.value} checked={value === option.value} onChange={() => change(option.value)} />{option.label}
    </label>)}
  </div>
}

export function InterviewSetup({ notice, initialSetup, job }: { notice: ReactNode; initialSetup?: unknown; job?: InterviewJob & { id: string } }) {
  const { start, loading, error } = useStartInterview()
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
  const focusId = useId()
  const selected = {
    type: typeOptions.find((item) => item.value === questionFormat) ?? typeOptions[0],
    difficulty: difficultyOptions.find((item) => item.value === difficulty) ?? difficultyOptions[0],
    interviewer: interviewerOptions.find((item) => item.value === interviewer) ?? interviewerOptions[0],
    length: lengthOptions.find((item) => item.value === String(questionCount)) ?? lengthOptions[0],
  }
  const minutes = selected.length.description.split(' · ')[1]
  const busy = loading || pending
  async function prepare() {
    if (submitting.current) return
    submitting.current = true; setPending(true)
    try {
      const setup = { questionCount, questionFormat, difficulty, interviewer, focusAreas }
      const id = job ? await start('', setup, job.id) : await start('', setup)
      if (id) await navigate(`/practice/interviews/${id}`)
    } finally { submitting.current = false; setPending(false) }
  }
  const canRecord = typeof navigator.mediaDevices?.getUserMedia === 'function' && typeof MediaRecorder !== 'undefined'
  return <form className="interview-setup" onSubmit={(event) => { event.preventDefault(); if (step === 'round') setStep('settings'); else void prepare() }}>
    <div className="grid gap-2"><h2 className="text-xl font-extrabold tracking-tight">Set up your interview</h2><p className="max-w-prose text-sm leading-relaxed text-muted-foreground">{job ? 'Choose your round. We’ll prepare questions for this saved job using your career library.' : 'Choose the round you want to practise. We’ll prepare a fictional role from your career library for you to review before entering.'}</p></div>
    <fieldset disabled={busy} className="interview-setup-fields">
      {step === 'round' ? <div className="interview-setup-panel">
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
      <SetupRow title="Interview length"><div className="interview-setup-length"><Switch name="length" options={lengthOptions} value={String(questionCount)} change={(value) => setQuestionCount(Number(value))} />
        <span className="interview-setup-stops" aria-hidden="true">{Array.from({ length: questionCount + 1 }, (_, index) => <i key={index} />)}</span></div>
        <p className="interview-setup-help">{selected.length.description}. Follow-up questions may extend it.</p></SetupRow>
      <SetupRow group={false} title={<label htmlFor={`${focusId}-trigger`} id={focusId}>Focus areas <span>(optional)</span></label>}><div className="interview-setup-focus">
        <MultiSelect id={`${focusId}-trigger`} labelId={focusId} emptyLabel="None, a balanced round" options={focusChoices} selected={focusAreas} onChange={setFocusAreas} />
        {focusAreas.length > 0 && <div className="interview-setup-tags">{focusChoices.filter((option) => focusAreas.includes(option.value)).map((option) => <button type="button" key={option.value} aria-label={`Remove ${option.label}`} onClick={() => setFocusAreas((previous) => previous.filter((area) => area !== option.value))}>{option.label}<X size={14} aria-hidden /></button>)}</div>}
        <p className="interview-setup-help">Bias which questions you get. Leave this empty for a balanced round.</p>
      </div></SetupRow>
      </div> : <>
      <div className="interview-setup-section"><h3 className="font-medium">Microphone preferences</h3><InterviewMicrophoneSettings microphone={microphone} /><p className="text-sm text-muted-foreground">{canRecord ? 'Microphone recording is supported in this browser. Permission has not been checked.' : 'Microphone recording is unavailable in this browser. You can type every answer.'}</p></div>
      <div className="interview-setup-section"><h3 className="font-medium">Answer transcription</h3><InterviewTranscriptionSettings mode={transcriptionMode} change={setTranscriptionMode} /></div>
      </>}
    </fieldset>
    {step === 'round'
      ? <div className="interview-setup-footer"><p className="text-sm leading-relaxed"><span className="block text-[15px] font-bold">{selected.type.label} · {selected.difficulty.label} · {questionCount} core questions</span><span className="text-muted-foreground">With {selected.interviewer.label.split(' — ')[0]} · {minutes}. Next, check your microphone and transcription.</span></p><Button type="button" size="lg" className="min-h-11" onClick={() => setStep('settings')}>Continue to settings</Button></div>
      : <div className="interview-setup-summary"><h3 className="font-medium">Your round</h3><p className="text-sm leading-relaxed">{selected.type.label} · {selected.difficulty.label} · {questionCount} core questions</p><p className="text-sm text-muted-foreground">{selected.interviewer.label}. Follow-up questions may extend the interview.</p><div className="flex flex-wrap gap-3"><Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={() => setStep('round')}>Back to round</Button><Button type="submit" className="min-h-11" disabled={busy} aria-busy={busy}>{busy ? 'Preparing…' : 'Prepare interview'}</Button></div>{error && <p role="alert" className="text-destructive">{error}</p>}</div>}
    <details className="text-sm text-muted-foreground"><summary className="cursor-pointer py-3 font-medium text-foreground">How your details and audio are used</summary><div className="pt-2">{notice}</div></details>
  </form>
}
