/**
 * Description: Reads the scraper's warnings out of a scrape_job task result
 * (result.scraped_job, see services/ai/schemas/scraped_job_posting.py).
 * Index:
 *   - scrapedJobWarnings: the warnings, or an empty list
 */

/** Returns result.scraped_job.warnings, keeping only strings. */
export function scrapedJobWarnings(result: unknown): string[] {
  const scrapedJob = (result as { scraped_job?: { warnings?: unknown } } | null)?.scraped_job
  const warnings = scrapedJob?.warnings
  return Array.isArray(warnings) ? warnings.filter((warning): warning is string => typeof warning === 'string') : []
}
