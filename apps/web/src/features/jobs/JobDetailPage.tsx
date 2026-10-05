/**
 * Description: One saved job (/jobs/:id), read-only: how the career library matches it (gap
 * analysis), requirements, nice-to-haves, the full description, and a link to the original posting.
 * Requirements, nice-to-haves, and the description start collapsed.
 * Index:
 *   - JobDetailPage: page component
 *   - CollapsibleJobCard: a titled card that stays collapsed until opened
 *   - BulletCard: a collapsible list of bullet points
 */
import type { ReactNode } from 'react'
import { ArrowLeft, ExternalLink } from 'lucide-react'
import { Link, useParams } from 'react-router'
import { CollapseToggle } from '@/components/CollapseToggle'
import { ErrorAlert } from '@/components/ErrorAlert'
import { useOpenSection } from '@/components/useOpenSection'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { GapAnalysisCard } from '@/features/gap-analysis/GapAnalysisCard'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import { JOB_STAGE_LABELS } from './jobStageLabels'
import { useJob } from './useJobs'

/** Shows everything saved about one job. */
export function JobDetailPage() {
  const { id = '' } = useParams()
  const { job, loading, error } = useJob(id)

  return (
    <div className="mx-auto grid max-w-3xl gap-6">
      <Button asChild variant="ghost" size="sm" className="justify-self-start">
        <Link to="/jobs">
          <ArrowLeft /> All jobs
        </Link>
      </Button>
      {error && <ErrorAlert title="Couldn't load this job" messages={[requestErrorMessage(error, error.message)]} />}
      {!job && loading && <p className="text-muted-foreground">Loading…</p>}
      {job && (
        <>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="grid gap-1">
              <h1 className="text-2xl font-semibold tracking-tight">{job.title}</h1>
              <p className="text-muted-foreground">{[job.company, job.location].filter(Boolean).join(' · ')}</p>
            </div>
            <div className="flex items-center gap-2">
              {job.latestGapAnalysis?.status === 'COMPLETED' && (
                <Button asChild size="sm">
                  <Link to={`/jobs/${job.id}/tailor`}>{job.resume ? 'Open resume' : 'Write resume'}</Link>
                </Button>
              )}
              <Badge variant="secondary">{JOB_STAGE_LABELS[job.stage]}</Badge>
              {job.url && (
                <Button asChild variant="outline" size="sm">
                  <a href={job.url} target="_blank" rel="noreferrer">
                    <ExternalLink /> Original posting
                  </a>
                </Button>
              )}
            </div>
          </div>
          <GapAnalysisCard jobId={job.id} latestGapAnalysis={job.latestGapAnalysis ?? null} gapResponses={job.gapResponses} />
          <BulletCard
            sectionId={`job.${job.id}.requirements`}
            title="Requirements"
            items={job.requirements}
            emptyText="No requirements were found in the posting."
          />
          {job.niceToHaves.length > 0 && (
            <BulletCard sectionId={`job.${job.id}.nice-to-have`} title="Nice to have" items={job.niceToHaves} />
          )}
          {job.description && (
            <CollapsibleJobCard sectionId={`job.${job.id}.description`} title="Full description">
              <p className="text-sm whitespace-pre-line text-muted-foreground">{job.description}</p>
            </CollapsibleJobCard>
          )}
        </>
      )}
    </div>
  )
}

/** A titled card whose body unmounts until the user opens it. */
function CollapsibleJobCard({ sectionId, title, children }: { sectionId: string; title: string; children: ReactNode }) {
  const { open, toggle, panelId } = useOpenSection(sectionId)

  return (
    <Card>
      <CardHeader>
        <CollapseToggle open={open} panelId={panelId} onToggle={toggle}>
          <CardTitle>{title}</CardTitle>
        </CollapseToggle>
      </CardHeader>
      {open && <CardContent id={panelId}>{children}</CardContent>}
    </Card>
  )
}

/** A titled card listing bullet points. */
function BulletCard({ sectionId, title, items, emptyText }: { sectionId: string; title: string; items: string[]; emptyText?: string }) {
  return (
    <CollapsibleJobCard sectionId={sectionId} title={title}>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <ul className="grid list-disc gap-1.5 pl-5 text-sm">
          {items.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      )}
    </CollapsibleJobCard>
  )
}
