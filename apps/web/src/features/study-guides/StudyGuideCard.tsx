/** Offers description-based learning beside a saved job, with remembered disclosure and readable topics. */
import { ErrorAlert } from '@/components/ErrorAlert'
import { SectionCard } from '@/components/SectionCard'
import { Button } from '@/components/ui/button'
import { parseStudyGuide, type StudyGuide } from './parseStudyGuide'
import { useStudyGuide } from './useStudyGuide'

export function StudyGuideCard({ jobId, hasDescription }: { jobId: string; hasDescription: boolean }) {
  return <SectionCard sectionId={`job.${jobId}.study-guides`} tone="education" title="Study guides"
    description="Learn and practice topics from this job's description.">
    <StudyGuideContent key={jobId} jobId={jobId} hasDescription={hasDescription} />
  </SectionCard>
}

function StudyGuideContent({ jobId, hasDescription }: { jobId: string; hasDescription: boolean }) {
  const state = useStudyGuide(jobId)
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
          aria-label={`Read guide from ${formatGuideDate(entry.createdAt)}`} onClick={() => state.select(entry.id)}>
          <time dateTime={entry.createdAt}>{formatGuideDate(entry.createdAt)}</time>
        </Button>)}
      </div>
      {state.nextCursor && <Button className="justify-self-start" variant="ghost" disabled={state.loadingMore}
        onClick={() => void state.loadMore()}>{state.loadingMore ? 'Loading older guides…' : 'Load older guides'}</Button>}
    </div>}
    {state.contentLoading && <p role="status" className="text-sm text-muted-foreground">Loading selected guide…</p>}
    {state.contentError && <div className="grid gap-2"><ErrorAlert title="Couldn't load this guide" messages={[state.contentError.message]} />
      <Button className="justify-self-start" variant="outline" onClick={() => void state.retryContent().catch(() => {})}>Retry guide</Button></div>}
    {state.busy && <p role="status" className="text-sm text-muted-foreground">Generating your study guide… You can keep reading saved material.</p>}
    {guide && <StudyGuideView guide={guide} />}
    {state.guideTask && !guide && <p className="text-sm text-muted-foreground">This guide couldn't be displayed. Generate another guide.</p>}
    {!hasDescription && <p className="text-sm text-muted-foreground">Add a job description to generate a study guide.</p>}
    <Button className="justify-self-start" variant={guide ? 'outline' : 'default'} disabled={!hasDescription || state.busy || state.loading || Boolean(state.loadError)}
      onClick={() => void state.start()}>{state.starting ? 'Starting…' : guide ? 'Generate another guide' : 'Generate study guide'}</Button>
  </div>
}

export function StudyGuideView({ guide }: { guide: StudyGuide }) {
  return <article className="grid min-w-0 max-w-prose gap-5 break-words">
    <header className="grid gap-1"><h3 className="text-lg font-semibold">{guide.title}</h3>
      <p className="text-sm text-muted-foreground">Start with the first topic, then work through the exercises and self-checks.</p></header>
    {guide.topics.map((topic, index) => <section key={index} className="grid gap-3 border-t pt-5 text-sm leading-relaxed">
      <h4 className="font-semibold">{index + 1}. {topic.title}</h4>
      <p className="text-muted-foreground">{topic.why_it_matters}</p>
      <p className="whitespace-pre-line">{topic.explanation}</p>
      <h5 className="font-medium">Practice</h5>
      <ul className="grid list-disc gap-2 pl-5">{topic.exercises.map((exercise, i) => <li key={i}>{exercise}</li>)}</ul>
      <h5 className="font-medium">Check your understanding</h5>
      <ul className="grid list-disc gap-2 pl-5">{topic.self_check_questions.map((question, i) => <li key={i}>{question}</li>)}</ul>
    </section>)}
  </article>
}

function formatGuideDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', timeZoneName: 'short' }).format(new Date(value))
}
