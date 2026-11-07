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
      progressBody="Reading and saving the job can take a little while. This page updates automatically when it is ready."
    />
  )
}
