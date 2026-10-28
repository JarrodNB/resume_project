/** Offers saved, description-based reference guides beside a job, with links between their topics. */
import { useId } from 'react'
import { ErrorAlert } from '@/components/ErrorAlert'
import { Button } from '@/components/ui/button'
import { parseStudyGuide, type StudyGuide } from './parseStudyGuide'
import { useStudyGuide } from './useStudyGuide'

/** The job workspace's Study tab: saved guides and generation, always open. */
export function StudyGuidePanel({ jobId, description }: { jobId: string; description: string | null }) {
  return <section className="grid gap-5" aria-labelledby={`study-guides-${jobId}`}>
    <div className="grid gap-1">
      <h2 id={`study-guides-${jobId}`} className="text-base font-medium">Study guides</h2>
      <p className="text-sm text-muted-foreground">Learn and practice topics from this job's description.</p>
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
    {guide && <StudyGuideView guide={guide} />}
    {state.guideTask && !guide && <p className="text-sm text-muted-foreground">This guide couldn't be displayed. Generate another guide.</p>}
    {!hasDescription && <p className="text-sm text-muted-foreground">Add a job description to generate a study guide.</p>}
    <Button className="justify-self-start" variant={guide ? 'outline' : 'default'} disabled={!hasDescription || state.busy || state.loading || Boolean(state.loadError)}
      onClick={() => void state.start()}>{state.starting ? 'Starting…' : state.retryReady ? 'Retry study guide' : guide ? 'Generate another guide' : 'Generate study guide'}</Button>
  </div>
}

export function StudyGuideView({ guide }: { guide: StudyGuide }) {
  const guideId = useId()
  const contentsId = `${guideId}-topics`
  const topicId = (index: number) => `${guideId}-topic-${index}`
  const linkStyle = 'rounded-sm text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring'

  return <article className="grid min-w-0 max-w-prose gap-8 break-words">
    <header className="grid gap-3"><h3 className="text-xl font-semibold leading-snug">{guide.title}</h3>
      <p className="text-sm leading-relaxed text-muted-foreground">Jump to a topic, or read from start to finish. Use your own notes for the practice exercises and self-checks.</p></header>
    <nav aria-labelledby={contentsId} className="grid gap-2">
      <h4 id={contentsId} tabIndex={-1} className="scroll-mt-40 min-[900px]:scroll-mt-24 text-base font-semibold focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">Topics in this guide</h4>
      <ol className="list-decimal pl-5 text-sm marker:text-muted-foreground">
        {guide.topics.map((topic, index) => <li key={index} className="pl-1">
          <a href={`#${topicId(index)}`} className={`${linkStyle} flex min-h-11 items-center py-2 leading-relaxed`}>{topic.title}</a>
        </li>)}
      </ol>
    </nav>
    {guide.topics.map((topic, index) => <section key={index} aria-labelledby={topicId(index)} className="grid gap-3 border-t pt-8 text-sm leading-relaxed">
      <h4 id={topicId(index)} tabIndex={-1} className="scroll-mt-40 min-[900px]:scroll-mt-24 text-lg font-semibold leading-snug focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">{index + 1}. {topic.title}</h4>
      <p className="text-muted-foreground">{topic.why_it_matters}</p>
      <p className="whitespace-pre-line">{topic.explanation}</p>
      <h5 className="font-medium">Practice</h5>
      <ul className="grid list-disc gap-2 pl-5">{topic.exercises.map((exercise, i) => <li key={i}>{exercise}</li>)}</ul>
      <h5 className="font-medium">Check your understanding</h5>
      <ul className="grid list-disc gap-2 pl-5">{topic.self_check_questions.map((question, i) => <li key={i}>{question}</li>)}</ul>
      <a href={`#${contentsId}`} className={`${linkStyle} mt-2 flex min-h-11 items-center justify-self-start py-2`}>Back to topics</a>
    </section>)}
  </article>
}

function formatGuideDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', timeZoneName: 'short' }).format(new Date(value))
}
