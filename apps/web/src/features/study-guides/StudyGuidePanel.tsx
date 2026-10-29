/** Offers one saved job-question collection with explained answers and explicit five-question generation. */
import { useId, useRef, useState } from 'react'
import { ErrorAlert } from '@/components/ErrorAlert'
import { Button } from '@/components/ui/button'
import type { StudyGuide } from './parseStudyGuide'
import { useStudyGuide } from './useStudyGuide'

/** The job workspace's Study tab: saved questions and generation, always open. */
export function StudyGuidePanel({ jobId, description }: { jobId: string; description: string | null }) {
  return <section className="grid gap-5" aria-labelledby={`study-guides-${jobId}`}>
    <div className="grid gap-1">
      <h2 id={`study-guides-${jobId}`} className="text-base font-medium">Study guides</h2>
      <p className="text-sm text-muted-foreground">Study questions from this job's description, with explained answers and examples.</p>
    </div>
    <StudyGuideContent key={jobId} jobId={jobId} description={description} />
  </section>
}

function StudyGuideContent({ jobId, description }: { jobId: string; description: string | null }) {
  const state = useStudyGuide(jobId, description)
  const hasDescription = Boolean(description?.trim())
  return <div className="grid gap-5">
    <ErrorAlert messages={state.errors} title="Couldn't start study questions" />
    {state.loadError && <ErrorAlert messages={[state.loadError.message]} title="Couldn't load saved questions" />}
    {state.subscriptionError && <ErrorAlert messages={[state.subscriptionError.message]} title="Couldn't follow generation. Reload to reconnect." />}
    {state.loading && !state.questions.length && <p role="status" className="text-sm text-muted-foreground">Loading study questions…</p>}
    {state.task?.status === 'FAILED' && <ErrorAlert title="Question generation failed" messages={[state.task.errorMessage ?? 'Try generating again.']} />}
    {state.pageError && <ErrorAlert title="Couldn't update study questions" messages={[state.pageError]} />}
    {state.busy && <p role="status" className="text-sm text-muted-foreground">Generating five questions… You can keep reading saved questions.</p>}
    {state.retryReady && !state.starting && <p role="status" className="max-w-prose text-sm text-muted-foreground">This batch is taking longer than expected. You can retry without losing saved questions.</p>}
    {state.questions.length > 0 && <StudyGuideView guide={{ title: 'Study questions', version: 1, questions: state.questions }}
      totalQuestions={state.totalQuestions} loadMore={state.loadMore} loadingMore={state.loadingMore} freshness={state.questions.map((question) => question.outOfDate)} />}
    {!hasDescription && <p className="text-sm text-muted-foreground">Add a job description to generate study questions.</p>}
    <Button className="justify-self-start" variant={state.questions.length ? 'outline' : 'default'} disabled={!hasDescription || state.busy || state.loading || Boolean(state.loadError)}
      onClick={() => void state.start()}>{state.starting ? 'Starting…' : state.retryReady ? 'Retry 5 questions' : state.totalQuestions ? 'Generate 5 more' : 'Generate 5 questions'}</Button>
  </div>
}

/** One focused question, with its answer revealed only when the reader is ready. */
export function StudyGuideView({ guide, totalQuestions = guide.questions.length, loadMore, loadingMore = false, freshness = [] }: {
  guide: StudyGuide; totalQuestions?: number; loadMore?: () => Promise<boolean>; loadingMore?: boolean; freshness?: boolean[]
}) {
  const answerId = useId()
  const heading = useRef<HTMLHeadingElement>(null)
  const [index, setIndex] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const question = guide.questions[index]

  async function navigate(next: number) {
    if (next >= guide.questions.length && (!loadMore || !await loadMore())) return
    setIndex(next)
    setRevealed(false)
    heading.current?.focus()
  }

  return <article className="grid min-w-0 max-w-prose gap-6 break-words">
    <header className="grid gap-2">
      <h3 className="text-xl font-semibold leading-snug">{guide.title}</h3>
      <p className="text-sm text-muted-foreground">Think through each question, then reveal the explanation and worked example.</p>
    </header>
    <section className="grid gap-4 border-t-2 border-foreground pt-5">
      <p role="status" className="text-sm tabular-nums text-muted-foreground">Question {index + 1} of {totalQuestions}</p>
      <h4 ref={heading} tabIndex={-1} className="text-xl font-semibold leading-snug focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">{question.question}</h4>
      <p className="text-sm leading-relaxed text-muted-foreground">{question.why_it_matters}</p>
      {freshness[index] && <p role="status" className="text-sm text-muted-foreground">This question is out of date because the job description changed. Generate more questions when you’re ready.</p>}
      <Button variant="outline" className="justify-self-start" aria-expanded={revealed} aria-controls={answerId}
        onClick={() => setRevealed(!revealed)}>{revealed ? 'Hide answer' : 'Show answer'}</Button>
      <div id={answerId} hidden={!revealed} className="grid gap-4 border-t pt-5 text-base leading-relaxed">
        {revealed && <>
          <div className="grid gap-2"><h5 className="font-semibold">Answer explained</h5><p className="whitespace-pre-line">{question.answer}</p></div>
          <div className="grid gap-2"><h5 className="font-semibold">Worked example</h5><p className="whitespace-pre-line">{question.example}</p></div>
        </>}
      </div>
    </section>
    <nav aria-label="Study questions" className="flex flex-wrap justify-between gap-3 border-t pt-4">
      <Button variant="outline" disabled={index === 0 || loadingMore} onClick={() => void navigate(index - 1)}>Previous</Button>
      <Button variant="outline" disabled={index >= totalQuestions - 1 || loadingMore} onClick={() => void navigate(index + 1)}>{loadingMore ? 'Loading…' : 'Next'}</Button>
    </nav>
  </article>
}
