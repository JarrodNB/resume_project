/** Assemble a practice interview from career evidence and deliberate setup choices.
 * Saved-state recovery keeps these choices while resolving an unfinished interview, without replaying starts.
 * Preparation saves the choices before review. Microphone preferences stay local to this account.
 */
import { useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/features/auth/useAuth'
import { useStartInterview } from './useInterviewSession'
import { useInterviewMicSettings } from './useInterviewMicSettings'
import { InterviewMicrophoneSettings } from './InterviewMicrophoneSettings'
import { difficultyOptions, focusOptions, interviewerOptions, lengthOptions, typeOptions } from './interviewSetupOptions'
import { InterviewJobContext, type InterviewJob } from './InterviewJobContext'
import { useInterviewStartRecovery } from './useInterviewStartRecovery'
import { InterviewStartRecovery } from './InterviewStartRecovery'

function Choices({ title, name, options, value, change }: { title: string; name: string; options: { value: string; label: string; description: string }[]; value: string; change: (value: string) => void }) {
  return <fieldset className="interview-setup-section"><legend>{title}</legend><div className="interview-setup-choices">
    {options.map((option) => <label className="interview-setup-choice" key={option.value}>
      <input type="radio" name={name} value={option.value} checked={value === option.value} onChange={() => change(option.value)} />
      <span><span className="block font-medium">{option.label}</span><span className="mt-1 block text-sm leading-relaxed text-muted-foreground">{option.description}</span></span>
    </label>)}
  </div></fieldset>
}

export function InterviewSetup({ notice, initialSetup, job }: { notice: ReactNode; initialSetup?: unknown; job?: InterviewJob & { id: string } }) {
  const { start, loading, error } = useStartInterview()
  const recovery = useInterviewStartRecovery(Boolean(job))
  const { user } = useAuth()
  const microphone = useInterviewMicSettings(user?.id ?? '')
  const navigate = useNavigate()
  const submitting = useRef(false)
  const [pending, setPending] = useState(false)
  const saved = initialSetup && typeof initialSetup === 'object' ? initialSetup as Record<string, unknown> : {}
  const choice = (value: unknown, options: { value: string }[], fallback: string) => options.some((option) => option.value === value) ? value as string : fallback
  const [questionCount, setQuestionCount] = useState(Number(choice(String(saved.questionCount), lengthOptions, '8')))
  const [questionFormat, setQuestionFormat] = useState(choice(saved.questionFormat, typeOptions, 'mixed'))
  const [difficulty, setDifficulty] = useState(choice(saved.difficulty, difficultyOptions, 'realistic'))
  const [interviewer, setInterviewer] = useState(choice(saved.interviewer, interviewerOptions, 'daniel'))
  const [focusAreas, setFocusAreas] = useState<string[]>(Array.isArray(saved.focusAreas) ? [...new Set(saved.focusAreas.filter((value): value is string => typeof value === 'string' && Object.hasOwn(focusOptions, value)))] : [])
  const busy = loading || pending
  async function prepare() {
    if (submitting.current || !recovery.canPrepare) return
    submitting.current = true; setPending(true)
    try {
      const setup = { questionCount, questionFormat, difficulty, interviewer, focusAreas }
      const id = job ? await start('', setup, job.id) : await start('', setup)
      if (id) await navigate(`/practice/interviews/${id}`)
      else if (job) await recovery.refresh()
    } finally { submitting.current = false; setPending(false) }
  }
  const canRecord = typeof navigator.mediaDevices?.getUserMedia === 'function' && typeof MediaRecorder !== 'undefined'
  return <form className="interview-setup" onSubmit={(event) => { event.preventDefault(); void prepare() }}>
    <div className="grid gap-2"><h2 className="text-xl font-medium">Set up your interview</h2><p className="max-w-prose text-sm leading-relaxed text-muted-foreground">{job ? 'Choose your round. We’ll prepare questions for this saved job using your career library. Review the job context before entering the room.' : 'Choose the round you want to practise. We’ll prepare a fictional role from your career library for you to review before entering.'}</p></div>
    {job && <InterviewJobContext job={job} sectionId={`job.${job.id}.interview-details`} />}
    {job && <InterviewStartRecovery recovery={recovery} busy={busy} failedStart={Boolean(error)} />}
    <fieldset disabled={busy} className="interview-setup-fields">
      <Choices title="Interview type" name="type" options={typeOptions} value={questionFormat} change={setQuestionFormat} />
      <Choices title="Difficulty" name="difficulty" options={difficultyOptions} value={difficulty} change={setDifficulty} />
      <Choices title="Your interviewer" name="interviewer" options={interviewerOptions} value={interviewer} change={setInterviewer} />
      <Choices title="Interview length" name="length" options={lengthOptions} value={String(questionCount)} change={(value) => setQuestionCount(Number(value))} />
      <fieldset className="interview-setup-section"><legend>Focus areas <span className="font-normal text-muted-foreground">(optional)</span></legend><p className="text-sm text-muted-foreground">Bias which questions you get. Leave these clear for a balanced round.</p><div className="flex flex-wrap gap-2">
        {Object.entries(focusOptions).map(([value, label]) => <label className="interview-focus-choice" key={value}><input type="checkbox" checked={focusAreas.includes(value)} onChange={(event) => setFocusAreas((previous) => event.target.checked ? [...previous, value] : previous.filter((area) => area !== value))} />{label}</label>)}
      </div></fieldset>
      <div className="interview-setup-section"><h3 className="font-medium">Microphone preferences</h3><InterviewMicrophoneSettings microphone={microphone} /><p className="text-sm text-muted-foreground">{canRecord ? 'Microphone recording is supported in this browser. Permission has not been checked.' : 'Microphone recording is unavailable in this browser. You can type every answer.'}</p></div>
    </fieldset>
    <div className="interview-setup-summary"><h3 className="font-medium">Your round</h3><p className="text-sm leading-relaxed">{typeOptions.find((item) => item.value === questionFormat)?.label} · {difficultyOptions.find((item) => item.value === difficulty)?.label} · {questionCount} core questions</p><p className="text-sm text-muted-foreground">{interviewerOptions.find((item) => item.value === interviewer)?.label}. Follow-up questions may extend the interview.</p><Button type="submit" className="min-h-11 justify-self-start" disabled={busy || !recovery.canPrepare} aria-busy={busy}>{busy ? 'Preparing…' : 'Prepare interview'}</Button>{error && <p role="alert" className="text-destructive">{error}</p>}</div>
    <details className="text-sm text-muted-foreground"><summary className="cursor-pointer py-3 font-medium text-foreground">How your details and audio are used</summary><div className="pt-2">{notice}</div></details>
  </form>
}
