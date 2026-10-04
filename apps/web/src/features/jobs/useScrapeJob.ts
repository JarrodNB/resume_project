/**
 * Description: Hook that starts scraping a job posting URL.
 * Index:
 *   - useScrapeJob: returns scrapeJob(url) plus loading and error state
 */
import { useState } from 'react'
import { useMutation } from '@apollo/client/react'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import { SCRAPE_JOB_MUTATION } from './jobsOperations'

/** Calls the scrapeJob mutation; resolves to the new AI task id, or null on errors. */
export function useScrapeJob() {
  const [mutate, { loading }] = useMutation(SCRAPE_JOB_MUTATION)
  const [errors, setErrors] = useState<string[]>([])

  async function scrapeJob(url: string): Promise<string | null> {
    setErrors([])
    try {
      const { data } = await mutate({ variables: { url } })
      const payload = data?.scrapeJob
      if (payload?.aiTask && payload.errors.length === 0) return payload.aiTask.id
      setErrors(payload?.errors.length ? payload.errors : ["Couldn't add this job. Please try again."])
    } catch (error) {
      setErrors([requestErrorMessage(error, "Couldn't reach the server. Check your connection and try again.")])
    }
    return null
  }

  return { scrapeJob, submitting: loading, errors }
}
