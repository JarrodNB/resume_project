/** Displays saved assessments and suggestions. Scores are supplied by Rails; this
 * view never calculates scores, changes resume content, or creates PDF files. */
import { SectionCard } from '@/components/SectionCard'
import { ErrorAlert } from '@/components/ErrorAlert'
import { Button } from '@/components/ui/button'

interface Category { status: string; score?: number | null; reason?: string | null; assessments: unknown; deductions: unknown }
export interface AtsReportData {
  runId: string; outdated: boolean; rubricVersion: string; overallScore?: number | null
  jobAlignment: Category; contentQuality: Category; pdfReadability: Category
}

export function AtsReport({ resumeId, dirty, report, pending, errors, onRerun }: {
  resumeId: string; dirty: boolean; report: AtsReportData | null; pending: boolean; errors: string[]; onRerun: () => void
}) {
  const outdated = dirty || report?.outdated
  const busy = pending || [report?.jobAlignment.status, report?.contentQuality.status].some((status) => status === 'queued' || status === 'running')
  return <SectionCard tone="summary" title="ATS check" sectionId={`resume.${resumeId}.ats`} description={outdated ? 'Outdated feedback' : 'Feedback on your saved resume'}>
    <div className="grid gap-4">
      <p>Careergrind scores are our assessment, not an employer ATS score or a prediction of selection.</p>
      {dirty && <p role="status">Unsaved edits make this feedback outdated. Save resume before rerunning the check.</p>}
      {report?.outdated && <p role="status">This report is outdated. Rerun to check the saved version.</p>}
      {!report && <p>No assessment yet. Run a check on the saved resume.</p>}
      {report && <>
        <p>Rubric: {report.rubricVersion}. Job requirements and responsibilities have weight 2; preferred requirements have weight 1. Covered / partial / missing earn 100% / 50% / 0%. Applicable content checks have equal weight. The overall score averages applicable categories after all checks finish.</p>
        <p>{outdated ? 'Previous overall score' : 'Overall score'}: {outdated || report.overallScore == null ? 'pending' : `${report.overallScore}/100`}</p>
        <CategoryReport title="Job alignment" category={report.jobAlignment} outdated={dirty || report.jobAlignment.status === 'outdated'} />
        <CategoryReport title="Content quality" category={report.contentQuality} outdated={dirty || report.contentQuality.status === 'outdated'} />
        <CategoryReport title="PDF readability" category={report.pdfReadability} outdated={dirty || report.pdfReadability.status === 'outdated'} />
      </>}
      <ErrorAlert title="Couldn't check this resume" messages={errors} />
      <Button type="button" variant="outline" disabled={dirty || busy} onClick={onRerun}>{busy ? 'Checking saved resume…' : 'Rerun content check'}</Button>
    </div>
  </SectionCard>
}

function CategoryReport({ title, category, outdated }: { title: string; category: Category; outdated: boolean }) {
  const findings = records(category.assessments).sort((a, b) => priority(a.severity) - priority(b.severity))
  return <section className="grid gap-2 border-t pt-3">
    <h3 className="font-medium">{title}: {category.status === 'awaiting_export' ? 'Awaiting PDF export' : category.status.replaceAll('_', ' ')}{category.score != null && ` — ${outdated ? 'previous score ' : ''}${category.score}/100`}</h3>
    {category.reason && <p>{category.reason}</p>}
    {category.status === 'awaiting_export' && <p>PDF checks run only when you export a saved resume.</p>}
    {findings.map((finding, index) => <article key={index} className="grid gap-1 rounded border p-3">
      <h4>{label(finding.key ?? finding.requirement_id)} — {label(finding.severity)} ({label(finding.status)})</h4>
      <p>{label(finding.explanation)}</p>
      {records(finding.evidence).map((evidence, position) => <blockquote key={position}>Section {label(evidence.section_id)}: “{label(evidence.excerpt)}”</blockquote>)}
      {finding.absence_reason != null && <p>{label(finding.absence_reason)}</p>}
      {finding.suggested_action != null && <p>{label(finding.suggested_action)}</p>}
    </article>)}
    {records(category.deductions).length > 0 && <ul aria-label={`${title} deductions`}>{records(category.deductions).map((deduction, index) => <li key={index}>{label(deduction.key)}: −{label(deduction.points)} percentage points</li>)}</ul>}
  </section>
}

function records(value: unknown): Record<string, unknown>[] { return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null) : [] }
function label(value: unknown) { return typeof value === 'string' || typeof value === 'number' ? String(value) : '' }
function priority(value: unknown) { return value === 'error' ? 0 : value === 'warning' ? 1 : 2 }
