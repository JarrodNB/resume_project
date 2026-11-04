/**
 * Sorts a finished comparison into the groups the Fit tab shows, so what needs the user comes first.
 *
 * An answer or a dismissal only moves a requirement between groups; it never changes the AI's
 * verdict. A "met" verdict beats a dismissal, because a later comparison may find new evidence.
 */
import type { AssessedRequirement } from './parseGapAnalysisResult'

export interface AssessmentGroups {
  gaps: AssessedRequirement[]
  couldBeStronger: AssessedRequirement[]
  answered: AssessedRequirement[]
  met: AssessedRequirement[]
  niceToHave: AssessedRequirement[]
  dismissed: AssessedRequirement[]
}

/** Puts each requirement in exactly one group, keeping the posting's order inside a group. */
export function groupAssessments(
  assessments: AssessedRequirement[],
  answeredRequirements: string[],
  dismissedRequirements: string[],
): AssessmentGroups {
  const groups: AssessmentGroups = { gaps: [], couldBeStronger: [], answered: [], met: [], niceToHave: [], dismissed: [] }
  for (const assessment of assessments) {
    const { requirement, verdict, kind } = assessment
    const hasAnswer = answeredRequirements.includes(requirement)
    if (verdict !== 'met' && !hasAnswer && dismissedRequirements.includes(requirement)) groups.dismissed.push(assessment)
    else if (kind === 'nice_to_have') groups.niceToHave.push(assessment)
    else if (verdict === 'met') groups.met.push(assessment)
    else if (hasAnswer) groups.answered.push(assessment)
    else if (verdict === 'missing') groups.gaps.push(assessment)
    else groups.couldBeStronger.push(assessment)
  }
  return groups
}
