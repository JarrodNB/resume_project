/**
 * Description: Page for one parse_job_posting task (/jobs/paste/:aiTaskId).
 * Index:
 *   - JobPasteTaskPage: page component
 */
import { JobImportTaskPage } from './JobImportTaskPage'

/** Follows a pasted-ad parse and offers another paste when it fails. */
export function JobPasteTaskPage() {
  return (
    <JobImportTaskPage
      retryTo="/jobs/paste"
      retryLabel="Try another ad"
      progressTitle="Reading the job ad…"
      progressBody="This usually takes a few seconds. You can leave this page open; it updates by itself."
    />
  )
}
