/** Saved report reads and live updates share the same version-bound report fields. */
import { graphql } from '@/graphql/generated'

export const ATS_REPORT_FRAGMENT = graphql(`
  fragment AtsReportFields on AtsReport {
    id runId contentFingerprint jobFingerprint rubricVersion createdAt outdated overallScore
    jobAlignment { status score reason assessments deductions }
    contentQuality { status score reason assessments deductions }
    pdfReadability { status score reason assessments deductions }
  }
`)
export const ATS_REPORT_QUERY = graphql(`
  query ResumeAtsReport($id: ID!) { resume(id: $id) { id atsReport { ...AtsReportFields } } }
`)
export const ATS_REPORT_UPDATED_SUBSCRIPTION = graphql(`
  subscription ResumeAtsReportUpdated($resumeId: ID!) { atsReportUpdated(resumeId: $resumeId) { ...AtsReportFields } }
`)
export const RERUN_ATS_CHECK_MUTATION = graphql(`
  mutation RerunResumeAtsCheck($resumeId: ID!) { rerunResumeAtsCheck(input: {resumeId: $resumeId}) { report { ...AtsReportFields } errors } }
`)
