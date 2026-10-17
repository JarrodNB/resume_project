/** Existing saved-editor page tests can model a resume that has no report yet. */
import { ATS_REPORT_QUERY, ATS_REPORT_UPDATED_SUBSCRIPTION } from '@/features/resume-tailoring/atsOperations'

export function emptyAtsReportMocks(resumeId: string) {
  return [
    { request: { query: ATS_REPORT_QUERY, variables: { id: resumeId } }, maxUsageCount: 3, result: { data: { resume: { __typename: 'Resume', id: resumeId, atsReport: null } } } },
    { request: { query: ATS_REPORT_UPDATED_SUBSCRIPTION, variables: { resumeId } }, result: { data: { atsReportUpdated: null } } },
  ]
}
