/**
 * Description: Page for one scrape_job task (/jobs/new/:aiTaskId).
 * Index:
 *   - JobScrapeTaskPage: page component
 */
import { JobImportTaskPage } from './JobImportTaskPage'

/** Follows a scrape and offers another link when it fails. */
export function JobScrapeTaskPage() {
  return (
    <JobImportTaskPage
      retryTo="/jobs/new"
      retryLabel="Try another link"
      progressTitle="Reading the job posting…"
      progressBody="This usually takes a few seconds. You can leave this page open; it updates by itself."
    />
  )
}
