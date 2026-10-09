/**
 * Description: A completed gap analysis: summary, verdict counts for the requirements, then each
 * requirement, responsibility, and nice-to-have with its verdict and evidence.
 * Index:
 *   - GapAnalysisResultView: result component
 */
import { RequirementAssessmentItem } from './RequirementAssessmentItem'
import { VERDICT_LABELS, type AssessedRequirement, type GapAnalysisResult, type Verdict } from './parseGapAnalysisResult'
import type { SavedGapResponse } from './savedGapResponse'

const VERDICT_ORDER: Verdict[] = ['met', 'partial', 'missing']

/** Shows the summary and every assessed requirement, grouped by kind. */
export function GapAnalysisResultView({
  jobId,
  analysis,
  responses,
}: {
  jobId: string
  analysis: GapAnalysisResult
  responses: SavedGapResponse[]
}) {
  const requirements = analysis.assessments.filter((item) => item.kind === 'required')
  const responsibilities = analysis.assessments.filter((item) => item.kind === 'responsibility')
  const niceToHaves = analysis.assessments.filter((item) => item.kind === 'nice_to_have')

  return (
    <div className="grid gap-4">
      {analysis.warnings.map((warning) => (
        <p key={warning} className="text-sm text-muted-foreground">
          {warning}
        </p>
      ))}
      {analysis.summary && <p>{analysis.summary}</p>}
      {requirements.length > 0 && (
        <p className="text-sm text-muted-foreground">
          Requirements:{' '}
          {VERDICT_ORDER.map((verdict) => `${countVerdict(requirements, verdict)} ${VERDICT_LABELS[verdict].toLowerCase()}`).join(' · ')}
        </p>
      )}
      <AssessmentList title="Requirements" jobId={jobId} assessments={requirements} responses={responses} />
      <AssessmentList title="Responsibilities" jobId={jobId} assessments={responsibilities} responses={responses} />
      <AssessmentList title="Nice to have" jobId={jobId} assessments={niceToHaves} responses={responses} />
    </div>
  )
}

/** Counts assessments with the given verdict. */
function countVerdict(assessments: AssessedRequirement[], verdict: Verdict) {
  return assessments.filter((item) => item.verdict === verdict).length
}

/** A titled list of assessments; nothing when empty. */
function AssessmentList({
  title,
  jobId,
  assessments,
  responses,
}: {
  title: string
  jobId: string
  assessments: AssessedRequirement[]
  responses: SavedGapResponse[]
}) {
  if (assessments.length === 0) return null
  return (
    <section className="grid gap-1">
      <h3 className="text-sm font-semibold">{title}</h3>
      <ul className="divide-y">
        {assessments.map((assessment) => (
          <RequirementAssessmentItem
            key={assessment.requirement}
            jobId={jobId}
            assessment={assessment}
            response={responses.find((item) => item.requirement === assessment.requirement) ?? null}
          />
        ))}
      </ul>
    </section>
  )
}
