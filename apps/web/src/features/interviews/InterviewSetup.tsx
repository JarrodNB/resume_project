/** Assemble a practice interview from career evidence and deliberate setup choices.
 * Preparation saves these choices before role review. Microphone preferences stay local to this account.
 */
import { useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/features/auth/useAuth'
import { useStartInterview } from './useInterviewSession'
import { useInterviewMicSettings } from './useInterviewMicSettings'
import { InterviewMicrophoneSettings } from './InterviewMicrophoneSettings'
import { difficultyOptions, focusOptions, interviewerOptions, lengthOptions, typeOptions } from './interviewSetupOptions'

function Choices({ title, name, options, value, change }: { title: string; name: string; options: { value: string; label: string; description: string }[]; value: string; change: (value: string) => void }) {
  return <fieldset className="interview-setup-section"><legend>{title}</legend><div className="interview-setup-choices">
    {options.map((option) => <label className="interview-setup-choice" key={option.value}>
      <input type="radio" name={name} value={option.value} checked={value === option.value} onChange={() => change(option.value)} />
      <span><span className="block font-medium">{option.label}</span><span className="mt-1 block text-sm leading-relaxed text-muted-foreground">{option.description}</span></span>
    </label>)}
  </div></fieldset>
}

export function InterviewSetup({ notice }: { notice: ReactNode }) {
  const { start, loading, error } = useStartInterview()
  const { user } = useAuth()
  const microphone = useInterviewMicSettings(user?.id ?? '')
  const navigate = useNavigate()
  const submitting = useRef(false)
  const [pending, setPending] = useState(false)
  const [questionCount, setQuestionCount] = useState(8)
  const [questionFormat, setQuestionFormat] = useState('mixed')
  const [difficulty, setDifficulty] = useState('realistic')
  const [interviewer, setInterviewer] = useState('daniel')
  const [focusAreas, setFocusAreas] = useState<string[]>([])
  const busy = loading || pending
  async function prepare() {
    if (submitting.current) return
    submitting.current = true; setPending(true)
    try {
      const id = await start('', { questionCount, questionFormat, difficulty, interviewer, focusAreas })
      if (id) await navigate(`/interviews/${id}`)
    } finally { submitting.current = false; setPending(false) }
  }
  const canRecord = typeof navigator.mediaDevices?.getUserMedia === 'function' && typeof MediaRecorder !== 'undefined'
  return <form className="interview-setup" onSubmit={(event) => { event.preventDefault(); void prepare() }}>
    <div className="grid gap-2"><h2 className="text-xl font-medium">Set up your interview</h2><p className="max-w-prose text-sm leading-relaxed text-muted-foreground">Choose the round you want to practise. We’ll prepare a fictional role from your career library for you to review before entering.</p></div>
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
    <div className="interview-setup-summary"><h3 className="font-medium">Your round</h3><p className="text-sm leading-relaxed">{typeOptions.find((item) => item.value === questionFormat)?.label} · {difficultyOptions.find((item) => item.value === difficulty)?.label} · {questionCount} core questions</p><p className="text-sm text-muted-foreground">{interviewerOptions.find((item) => item.value === interviewer)?.label}. Follow-up questions may extend the interview.</p><Button type="submit" className="min-h-11 justify-self-start" disabled={busy} aria-busy={busy}>{busy ? 'Preparing…' : 'Prepare interview'}</Button>{error && <p role="alert" className="text-destructive">{error}</p>}</div>
    <details className="text-sm text-muted-foreground"><summary className="cursor-pointer py-3 font-medium text-foreground">How your details and audio are used</summary><div className="pt-2">{notice}</div></details>
  </form>
}
