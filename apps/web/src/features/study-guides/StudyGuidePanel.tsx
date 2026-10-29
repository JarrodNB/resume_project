/** Offers saved, description-based reference guides beside a job, as individual questions with explained answers. */
import { useId, useRef, useState } from 'react'
import { ErrorAlert } from '@/components/ErrorAlert'
import { Button } from '@/components/ui/button'
import { parseStudyGuide, type StudyGuide } from './parseStudyGuide'
import { useStudyGuide } from './useStudyGuide'

/** The job workspace's Study tab: saved guides and generation, always open. */
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
  const guide = parseStudyGuide(state.guideTask?.result)
  return <div className="grid gap-5">
    <ErrorAlert messages={state.errors} title="Couldn't start the study guide" />
    {state.loadError && <ErrorAlert messages={[state.loadError.message]} title="Couldn't load saved guides" />}
    {state.subscriptionError && <ErrorAlert messages={[state.subscriptionError.message]} title="Couldn't follow generation. Reload to reconnect." />}
    {state.loading && !state.guideTask && <p className="text-sm text-muted-foreground">Loading study guides…</p>}
    {state.task?.status === 'FAILED' && <ErrorAlert title="The study guide failed" messages={[state.task.errorMessage ?? 'Try generating again.']} />}
    {state.historyError && <ErrorAlert title="Couldn't load guide history" messages={[state.historyError]} />}
    {state.history.length > 0 && <div className="grid gap-3">
      <h3 className="text-sm font-medium">Saved guides</h3>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Saved study guides">
        {state.history.map((entry) => <Button key={entry.id} variant={state.selectedId === entry.id ? 'secondary' : 'outline'}
          className="h-auto min-h-8 whitespace-normal text-left" aria-pressed={state.selectedId === entry.id}
          aria-label={`Read guide from ${formatGuideDate(entry.createdAt)}${entry.outOfDate ? ' — Out of date' : ''}`} onClick={() => state.select(entry.id)}>
          <time dateTime={entry.createdAt}>{formatGuideDate(entry.createdAt)}</time>
          {entry.outOfDate && <span className="text-muted-foreground">Out of date</span>}
        </Button>)}
      </div>
      {state.nextCursor && <Button className="justify-self-start" variant="ghost" disabled={state.loadingMore}
        onClick={() => void state.loadMore()}>{state.loadingMore ? 'Loading older guides…' : 'Load older guides'}</Button>}
    </div>}
    {state.contentLoading && <p role="status" className="text-sm text-muted-foreground">Loading selected guide…</p>}
    {state.contentError && <div className="grid gap-2"><ErrorAlert title="Couldn't load this guide" messages={[state.contentError.message]} />
      <Button className="justify-self-start" variant="outline" onClick={() => void state.retryContent().catch(() => {})}>Retry guide</Button></div>}
    {state.busy && <p role="status" className="text-sm text-muted-foreground">Generating your study guide… You can keep reading saved material.</p>}
    {state.retryReady && !state.starting && <p role="status" className="max-w-prose text-sm text-muted-foreground">This study guide is taking longer than expected. You can retry without losing saved guides.</p>}
    {guide && state.guideOutOfDate && <p role="status" className="max-w-prose text-sm text-muted-foreground">This guide is out of date because the job description changed. Generate another guide when you’re ready.</p>}
    {guide && <StudyGuideView key={state.guideTask?.id} guide={guide} />}
    {state.guideTask && !guide && <p className="text-sm text-muted-foreground">This guide couldn't be displayed. Generate another guide.</p>}
    {!hasDescription && <p className="text-sm text-muted-foreground">Add a job description to generate a study guide.</p>}
    <Button className="justify-self-start" variant={guide ? 'outline' : 'default'} disabled={!hasDescription || state.busy || state.loading || Boolean(state.loadError)}
      onClick={() => void state.start()}>{state.starting ? 'Starting…' : state.retryReady ? 'Retry study guide' : guide ? 'Generate another guide' : 'Generate study guide'}</Button>
  </div>
}

/** One focused question, with its answer revealed only when the reader is ready. */
export function StudyGuideView({ guide }: { guide: StudyGuide }) {
  const answerId = useId()
  const heading = useRef<HTMLHeadingElement>(null)
  const [index, setIndex] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const question = guide.questions[index]

  function navigate(next: number) {
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
      <p role="status" className="text-sm tabular-nums text-muted-foreground">Question {index + 1} of {guide.questions.length}</p>
      <h4 ref={heading} tabIndex={-1} className="text-xl font-semibold leading-snug focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">{question.question}</h4>
      <p className="text-sm leading-relaxed text-muted-foreground">{question.why_it_matters}</p>
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
      <Button variant="outline" disabled={index === 0} onClick={() => navigate(index - 1)}>Previous</Button>
      <Button variant="outline" disabled={index === guide.questions.length - 1} onClick={() => navigate(index + 1)}>Next</Button>
    </nav>
  </article>
}

function formatGuideDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', timeZoneName: 'short' }).format(new Date(value))
}
