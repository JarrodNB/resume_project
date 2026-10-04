/**
 * Description: Reads a completed analyze_gaps task result (result.gap_analysis), mirroring
 * GapAnalysisResult in services/ai/schemas/gap_analysis.py.
 * Index:
 *   - Verdict / EvidenceItem / AssessedRequirement / GapAnalysisResult: the result's shape
 *   - VERDICT_LABELS: display labels per verdict
 *   - parseGapAnalysisResult: the typed result, or null when it isn't one
 */

export type Verdict = 'met' | 'partial' | 'missing'

export const VERDICT_LABELS: Record<Verdict, string> = {
  met: 'Met',
  partial: 'Partly met',
  missing: 'Gap',
}

export interface EvidenceItem {
  kind: string
  id: string | null
  text: string
  context: string | null
}

export interface AssessedRequirement {
  kind: 'required' | 'nice_to_have'
  requirement: string
  verdict: Verdict
  explanation: string
  evidence: EvidenceItem[]
}

export interface GapAnalysisResult {
  summary: string
  assessments: AssessedRequirement[]
}

const VERDICTS: readonly string[] = ['met', 'partial', 'missing']

/** True for plain objects (JSON objects). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** One evidence entry, or null when it has no text. */
function parseEvidence(value: unknown): EvidenceItem | null {
  if (!isRecord(value) || typeof value.text !== 'string') return null
  return {
    kind: typeof value.kind === 'string' ? value.kind : 'entry',
    id: typeof value.id === 'string' ? value.id : null,
    text: value.text,
    context: typeof value.context === 'string' ? value.context : null,
  }
}

/** One assessed requirement, or null when its requirement or verdict is unusable. */
function parseAssessment(value: unknown): AssessedRequirement | null {
  if (!isRecord(value) || typeof value.requirement !== 'string') return null
  if (typeof value.verdict !== 'string' || !VERDICTS.includes(value.verdict)) return null
  const evidence = Array.isArray(value.evidence) ? value.evidence.map(parseEvidence) : []
  return {
    kind: value.kind === 'nice_to_have' ? 'nice_to_have' : 'required',
    requirement: value.requirement,
    verdict: value.verdict as Verdict,
    explanation: typeof value.explanation === 'string' ? value.explanation : '',
    evidence: evidence.filter((item): item is EvidenceItem => item !== null),
  }
}

/** Returns result.gap_analysis with malformed entries dropped, or null if there is none. */
export function parseGapAnalysisResult(result: unknown): GapAnalysisResult | null {
  const analysis = isRecord(result) ? result.gap_analysis : null
  if (!isRecord(analysis) || !Array.isArray(analysis.assessments)) return null
  return {
    summary: typeof analysis.summary === 'string' ? analysis.summary : '',
    assessments: analysis.assessments
      .map(parseAssessment)
      .filter((item): item is AssessedRequirement => item !== null),
  }
}
