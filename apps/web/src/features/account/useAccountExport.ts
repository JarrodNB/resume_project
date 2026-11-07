/** Fetches the account export and saves it as a JSON file. The export skips Apollo's cache
 * so a large copy of the user's data is not kept in memory after the download. */
import { useState } from 'react'
import { useApolloClient } from '@apollo/client/react'
import { ACCOUNT_EXPORT_QUERY } from './accountOperations'

export function useAccountExport() {
  const client = useApolloClient()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function downloadExport() {
    setPending(true); setError(null)
    try {
      const { data } = await client.query({ query: ACCOUNT_EXPORT_QUERY, fetchPolicy: 'no-cache' })
      if (!data) throw new Error('No export returned')
      saveJsonFile(data.accountExport, `careergrind-export-${new Date().toISOString().slice(0, 10)}.json`)
    } catch {
      setError('We couldn’t prepare your data. Try again in a moment.')
    } finally {
      setPending(false)
    }
  }

  return { downloadExport, pending, error }
}

function saveJsonFile(value: unknown, filename: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
